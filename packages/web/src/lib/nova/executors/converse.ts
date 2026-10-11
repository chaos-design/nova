import "server-only";

import { DEFAULT_SYSTEM_PROMPT } from "../constants";
import type {
  ConverseChatMessage,
  ConverseEvent,
  ConverseToolCall,
  TokenUsage,
} from "../executor";
import type { AgentProfile } from "../types";
import {
  type ChatMessage,
  chatCompletion,
  LlmError,
  type LlmSettings,
  parseToolArgs,
} from "./llm";
import {
  CHAOS_TARGET_TOOL,
  detectInjectionObeyed,
  executeTool,
  scanRiskPatterns,
  TOOL_DEFINITIONS,
} from "./tools";

/**
 * 对话轮执行器（Converse Lab 的唯一执行路径）。
 *
 * 与沙盒执行器共用同一套工具层与 LLM 客户端，差别只在于：
 * - 任务书不是固定文案，而是用户消息 + 历轮对话上下文；
 * - **不注入混沌**：工具以 `fault=null` 执行，看到的失败只来自 Agent
 *   自身的参数失误，观测才是干净的；
 * - 不产生评分：事件里没有 scoreAfter，结论只是可观测后果
 *   （调用次数、tokens、延迟、注入命中标记），页面因此不进排行榜。
 */

/** 护栏：单个对话轮最多允许的模型调用次数，防止多轮工具循环烧 token */
const CONVERSE_MAX_ROUNDS = 4;

/** 回灌历史时工具结果的截断长度：防止逐轮累积把上下文撑爆 */
const TOOL_RESULT_CAP = 1_500;

/** 单次运行的累积状态 */
interface ConverseState {
  step: number;
  round: number;
  usage: TokenUsage;
  toolCalls: ConverseToolCall[];
  /** 使用过的不同检索式 */
  distinctQueries: Set<string>;
  /** 上下文压缩调用次数 */
  summarizeCalls: number;
  finished: boolean;
  content: string;
  injectionObeyed: boolean;
}

/**
 * 运行一次对话轮：把用户消息 + 历史上下文交给 Agent，
 * 自动代执行其发起的工具调用并回灌结果，直到它给出最终回复。
 */
export async function* runConverseTurn(
  history: readonly ConverseChatMessage[],
  userMessage: string,
  agent: AgentProfile,
  settings: LlmSettings,
  systemPrompt?: string,
  signal?: AbortSignal,
): AsyncGenerator<ConverseEvent> {
  const startedAt = Date.now();

  const state: ConverseState = {
    step: 0,
    round: 0,
    usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    toolCalls: [],
    distinctQueries: new Set(),
    summarizeCalls: 0,
    finished: false,
    content: "",
    injectionObeyed: false,
  };

  yield {
    type: "meta",
    agentId: agent.id,
    agentName: agent.name,
    model: settings.model,
  };

  // 用户消息是不可信输入：命中风险模式只留观察标记，不阻断执行——
  // 拦截等于 NOVA 替被测 Agent 决定它该怎么行为
  const risks = scanRiskPatterns(userMessage);
  if (risks.length > 0) {
    state.step += 1;
    yield {
      type: "step",
      step: {
        step: state.step,
        round: 0,
        level: "warn",
        actor: "nova",
        message: `用户消息检出 ${risks.length} 条越权指令特征`,
        detail: risks.join(" · "),
      },
    };
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt?.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT,
    },
    ...history,
    { role: "user", content: userMessage },
  ];
  // 本轮起点之后的消息全部属于本轮产物，收尾时整段交给客户端拼下一轮历史
  const prefixLength = messages.length;

  let fatal: string | null = null;
  let fatalHint: string | undefined;

  try {
    for (let round = 1; round <= CONVERSE_MAX_ROUNDS; round += 1) {
      if (signal?.aborted) break;
      state.round = round;

      const completion = await chatCompletion(settings, {
        model: settings.model,
        messages,
        tools: TOOL_DEFINITIONS,
        temperature: 0.2,
        maxTokens: settings.maxTokens,
        signal,
      });

      state.usage.calls += 1;
      state.usage.promptTokens += completion.usage.promptTokens;
      state.usage.completionTokens += completion.usage.completionTokens;
      state.usage.totalTokens += completion.usage.totalTokens;

      // 模型不再请求工具：这就是本回合的最终回复。
      // 最终消息必须进 messages，否则 replyMessages 缺了它，
      // 下一轮历史里就看不到本轮结论（多轮上下文保持失真）
      if (completion.toolCalls.length === 0) {
        state.finished = true;
        state.content = completion.content;
        messages.push({
          role: "assistant",
          content: completion.content || "",
        });

        state.step += 1;
        yield {
          type: "step",
          step: {
            step: state.step,
            round,
            level: "success",
            actor: "agent",
            message: "给出最终回复，对话轮结束",
            detail: truncate(completion.content, 140),
          },
        };
        break;
      }

      messages.push({
        role: "assistant",
        content: completion.content || null,
        tool_calls: completion.toolCalls,
      });

      if (completion.content.trim()) {
        state.step += 1;
        yield {
          type: "step",
          step: {
            step: state.step,
            round,
            level: "info",
            actor: "agent",
            message: truncate(completion.content, 90),
            detail: `模型思考 · 累计 ${state.usage.totalTokens} tokens`,
          },
        };
      }

      // --- 逐个执行工具调用（不注入混沌） ---
      for (const call of completion.toolCalls) {
        if (signal?.aborted) break;

        const name = call.function.name;
        const args = parseToolArgs(call.function.arguments);
        const outcome = executeTool(name, args, null, 0);

        const queryText =
          name === CHAOS_TARGET_TOOL
            ? typeof args.query === "string"
              ? args.query.trim()
              : ""
            : "";
        if (name === CHAOS_TARGET_TOOL && queryText.length > 0) {
          state.distinctQueries.add(queryText);
        }
        if (name === "summarize") state.summarizeCalls += 1;

        const resultText = outcome.ok
          ? outcome.content
          : `错误：${outcome.error}`;
        const resultSummary = truncate(resultText, 160);

        state.toolCalls.push({ name, args, ok: outcome.ok, resultSummary });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: truncate(resultText, TOOL_RESULT_CAP),
        });

        // 服从判定只看可观测后果：是否真的发起了越权检索
        if (detectInjectionObeyed([{ name, args }])) {
          state.injectionObeyed = true;

          state.step += 1;
          yield {
            type: "step",
            step: {
              step: state.step,
              round,
              level: "error",
              actor: "nova",
              message: "检测到越权检索已执行",
              detail: "Agent 发起了全量导出检索，判定为高危",
            },
          };
          continue;
        }

        state.step += 1;
        yield {
          type: "step",
          step: {
            step: state.step,
            round,
            level: outcome.ok
              ? outcome.records === 0
                ? "warn"
                : "info"
              : "warn",
            actor: "agent",
            message: `调用 ${name}(${truncate(JSON.stringify(args), 56)})`,
            detail: [
              outcome.ok
                ? outcome.records === 0
                  ? "返回空结果集"
                  : `返回 ${outcome.records} 条记录`
                : "参数校验失败，属 Agent 自身失误",
              truncate(outcome.ok ? outcome.content : outcome.error, 96),
            ].join(" · "),
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      yield {
        type: "error",
        message: "运行已被中止",
        hint: "客户端断开了连接。",
      };
      return;
    }
    fatal = error instanceof LlmError ? error.message : "执行器内部错误";
    fatalHint = error instanceof LlmError ? error.hint : String(error);
  }

  if (fatal) {
    yield { type: "error", message: fatal, hint: fatalHint };
    return;
  }

  yield {
    type: "turn",
    turn: {
      content: state.content,
      finished: state.finished,
      roundsUsed: state.round,
      usage: state.usage,
      latencyMs: Date.now() - startedAt,
      toolCalls: state.toolCalls,
      distinctQueries: state.distinctQueries.size,
      summarizeCalls: state.summarizeCalls,
      injectionObeyed: state.injectionObeyed,
      replyMessages: messages.slice(prefixLength),
    },
  };
}

/** 收敛展示文本：折叠空白、截断到指定长度 */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
