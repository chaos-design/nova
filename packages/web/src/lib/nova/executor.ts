import type { ScriptStep } from "./simulation";
import type {
  ChaosKind,
  SimulationConfig,
  SimulationLog,
  SimulationLogLevel,
  VerificationStageResult,
} from "./types";

/**
 * 沙盒执行器契约。
 *
 * 这是**前后端唯一的协议**：无论剧本来自本地仿真还是真实 LLM 执行器，
 * 对外都只吐出一串 `SandboxEvent`。界面因此不需要知道自己看的是哪一种，
 * 也不需要在渲染层写任何分支。
 */

/** 执行器标识 */
export type ExecutorId = "simulation" | "live";

/** 真实执行器的 token 用量 */
export interface TokenUsage {
  /** 模型调用次数 */
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 单次运行的观测计数。
 *
 * 每一项都是**可观测后果**：调用次数、参数是否有效、失败后是否恢复、
 * 用了几个不同检索式、有没有真的发起越权检索。评分只从这些计数派生，
 * 因此不同 Agent 跑出来的分数是可比的（标准 §3.5）。
 */
export interface RunObservations {
  /** 模型调用轮次 */
  modelCalls: number;
  /** 工具调用总次数 */
  toolCalls: number;
  /** 参数校验通过的工具调用次数 */
  validArgCalls: number;
  /** 被注入故障的调用次数 */
  injected: number;
  /** 失败后恢复成功的次数（自愈） */
  recoveries: number;
  /** 使用过的不同检索式数量 */
  distinctQueries: number;
  /** 上下文压缩（summarize）调用次数 */
  summarizeCalls: number;
  /** 是否在步数预算内给出最终结论 */
  finished: boolean;
  /** 是否发起越权检索（服从注入） */
  injectionObeyed: boolean;
  /** 已用步数 */
  stepsUsed: number;
  /** 本次运行的步数上限 */
  maxSteps: number;
  /** token 用量 */
  usage: TokenUsage;
}

/** 执行结论 */
export interface ExecutorResult {
  /** 任务是否达成 */
  success: boolean;
  /** 实际执行步数 */
  steps: number;
  /** 自我纠错次数 */
  reflections: number;
  /** 成功自愈的故障类型 */
  recoveredFrom: ChaosKind[];
  /** 本次评分（0 ~ 100） */
  score: number;
  /** 一句话结论，直接用于界面展示 */
  summary: string;
  /** token 用量 */
  usage: TokenUsage;
  /** 生命周期各阶段的实测状态与耗时 */
  stages: readonly VerificationStageResult[];
  /** 本次运行的可观测计数 */
  observations: RunObservations;
}

/**
 * 执行过程事件。
 *
 * 用判别联合而不是可选字段，是为了让消费方在类型层面穷尽所有分支 ——
 * 新增一种事件时，所有处理它的地方都会在编译期报错。
 */
export type SandboxEvent =
  | {
      type: "meta";
      executor: ExecutorId;
      agentId: string;
      agentName: string;
      /** 实际使用的模型标识 */
      model: string;
      /** 预计总步数；真实执行器可能为 null（步数由模型决定） */
      totalSteps: number | null;
    }
  | { type: "step"; step: ScriptStep }
  | { type: "done"; result: ExecutorResult }
  | { type: "error"; message: string; hint?: string };

/**
 * 剧本步骤 → 日志。
 *
 * `atMs` 由调用方按**真实经过时间**填充，而不是按预设节奏累加：
 * 两种执行器的时间基准必须都是"用户实际等了多久"，不能有一个是编的。
 */
export function stepToLog(step: ScriptStep, atMs: number): SimulationLog {
  return {
    id: `log-${String(step.step).padStart(3, "0")}`,
    step: step.step,
    atMs,
    level: step.level,
    actor: step.actor,
    message: step.message,
    detail: step.detail,
  };
}

/** 等待若干毫秒 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 真实执行器请求体。
 *
 * 只接受可序列化的最小字段集：Agent 档案由服务端按 id 反查，
 * 绝不接受客户端传入的档案内容 —— 否则评分就成了让客户端自己给自己打分。
 */
export type LiveRunRequest = Pick<
  SimulationConfig,
  "systemPrompt" | "environment" | "chaos" | "maxSteps"
> & {
  agentId: string;
};

/* -------------------------------------------------------------------------- */
/* 对话验证执行器契约                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 对话验证（Converse Lab）的事件契约。
 *
 * 对话轮是**观测路径而不是评分运行**：它不产生分数、不写 run-store、
 * 不进排行榜（AGENTS.md 约束 5：不编造指标）。因此这里的事件没有任何
 * 得分字段，客户端拿到的只有可观测后果 —— 工具调用、token、延迟、
 * 注入命中标记。
 */

/** 对话消息（OpenAI 兼容结构镜像，与 server-only 的 llm.ts 保持同形） */
export interface ConverseChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** assistant 侧的原生 tool_calls 回传，保证工具调用上下文连续 */
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  /** tool 侧的调用 id */
  tool_call_id?: string;
}

/** 对话轮内的一步观测 */
export interface ConverseStep {
  /** 步序号，从 1 开始 */
  step: number;
  /** 所属轮次：一次模型调用 = 一轮；开轮观察步骤为 0 */
  round: number;
  level: SimulationLogLevel;
  actor: "agent" | "sandbox" | "nova";
  /** 主文本 */
  message: string;
  /** 补充明细 */
  detail?: string;
}

/** 一次工具调用的观测记录 */
export interface ConverseToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
}

/** 对话轮结论 */
export interface ConverseTurnResult {
  /** 最终回复；预算耗尽未收敛时为空 */
  content: string;
  /** 是否在轮次预算内给出最终回复 */
  finished: boolean;
  /** 本轮消耗的模型调用次数 */
  roundsUsed: number;
  /** token 用量（本轮累计） */
  usage: TokenUsage;
  /** 本轮真实墙钟耗时（毫秒） */
  latencyMs: number;
  /** 本轮发起的工具调用 */
  toolCalls: ConverseToolCall[];
  /** 使用过的不同检索式数量 */
  distinctQueries: number;
  /** 上下文压缩调用次数 */
  summarizeCalls: number;
  /** 是否发起越权检索（服从注入，可观测后果） */
  injectionObeyed: boolean;
  /**
   * 本轮产生的 assistant / tool 消息全量。
   *
   * 对话上下文按无状态约定每轮重发（docs/agent-protocol.md §2），
   * 下一轮的历史必须由客户端用这份数据拼接，工具结果因此要随回复保留。
   */
  replyMessages: ConverseChatMessage[];
}

/** 对话事件判别联合；新增事件类型时所有消费方在编译期报错 */
export type ConverseEvent =
  | {
      type: "meta";
      agentId: string;
      agentName: string;
      model: string;
    }
  | { type: "step"; step: ConverseStep }
  | { type: "turn"; turn: ConverseTurnResult }
  | { type: "error"; message: string; hint?: string };

/**
 * 对话验证请求体。
 *
 * Agent 档案由服务端按 `agentId` 反查；`history` 是客户端拼接的
 * 完整对话上下文（只含成功完成的轮次），服务端不持久化任何会话。
 */
export interface ConverseRequest {
  agentId: string;
  /** 可选的系统提示词覆盖；缺省用内置默认 */
  systemPrompt?: string;
  /** 历次成功完成的对话上下文（user / assistant / tool 消息） */
  history: ConverseChatMessage[];
  /** 本轮用户消息 */
  userMessage: string;
}
