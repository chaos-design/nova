import { getConfig } from "@chaos-design/config";
import type {
  AgentProfile,
  ConverseChatMessage,
  ConverseEvent,
  ConverseRequest,
} from "@/lib/nova";
import { localAgentById, localAgentProfile } from "@/lib/nova";
import { runConverseTurn } from "@/lib/nova/executors/converse";
import { lintSystemPrompt } from "@/lib/nova/executors/live";

/**
 * 对话验证接口（Converse Lab）。
 *
 * 与沙盒路由同形态：**单次请求 + SSE 流式响应**。差别在于它是一条
 * **观测路径**：Agent 档案由服务端按 id 反查，对话上下文由客户端拼接
 * 后整轮回传（无状态约定），执行完不写 run-store、不产生评分。
 */

/** 流式响应需要的时间预算（秒）；单轮最多 4 次模型调用，另受模型自身耗时影响 */
export const maxDuration = 120;

/** 单次请求体大小上限 */
const MAX_BODY_BYTES = 32_768;

/** 历史消息条数上限：超过后上下文与 token 成本失去可控性 */
const MAX_HISTORY_MESSAGES = 24;

/** 单条 user / assistant 消息的长度上限 */
const MAX_CONTENT_CHARS = 4_000;

/** tool 消息的执行器侧截断上限与之一致（converse.ts 的 TOOL_RESULT_CAP） */
const MAX_TOOL_CONTENT_CHARS = 1_500;

/** 本轮用户消息的长度上限 */
const MAX_USER_MESSAGE_CHARS = 2_000;

export async function POST(request: Request) {
  let payload: ConverseRequest;

  try {
    const text = await request.text();

    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return jsonError(
        "请求体过大",
        "对话上下文与用户消息总长不应超过 32KB。",
        413,
      );
    }

    payload = JSON.parse(text) as ConverseRequest;
  } catch {
    return jsonError("请求体不是合法 JSON", undefined, 400);
  }

  const validated = validate(payload);

  if ("error" in validated) {
    return jsonError(validated.error, validated.hint, 400);
  }

  // Agent 档案由服务端按 id 反查：绝不采信客户端传来的档案内容
  const localEntry = localAgentById(payload.agentId);

  if (!localEntry) {
    return jsonError(
      `未注册的 Agent：${payload.agentId}`,
      "只有登记在 packages/web/src/lib/nova/local-agents.ts 的本地 Agent 可以被对话验证。",
      400,
    );
  }

  const profile: AgentProfile = localAgentProfile(localEntry);

  // 端点与模型取登记条目，密钥与 token 上限取统一配置（与沙盒路由同段逻辑）
  const novaConfig = getConfig();
  const effectiveSettings = {
    baseUrl: localEntry.endpoint,
    apiKey:
      process.env[localEntry.apiKeyEnv]?.trim() ||
      novaConfig.agent.llm.apiKey ||
      "",
    model: localEntry.model,
    maxTokens: novaConfig.agent.llm.maxTokens,
    timeoutMs: novaConfig.agent.llm.timeoutMs,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端中止（停止按钮 / 离开页面）后流即取消：
      // 对已取消的流 enqueue / close 都会抛错，必须全部防护
      const send = (event: ConverseEvent) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // 流已被消费方取消：后续事件自然不再发送
        }
      };

      try {
        for await (const event of runConverseTurn(
          validated.value.history,
          validated.value.userMessage,
          profile,
          effectiveSettings,
          validated.value.systemPrompt,
          request.signal,
        )) {
          // 对话轮不落库：评分若由客户端回传等于把打分权交给被测方，
          // 而对话观测本来就不进评分体系，因此这里刻意没有 recordRun
          send(event);
        }
      } catch (error) {
        // 兜底：执行器内部已经处理过的错误不会走到这里
        send({
          type: "error",
          message: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // 流已被消费方取消：无需也无法再关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 反向代理的缓冲会让流式响应退化成一次性返回，必须显式关闭
      "X-Accel-Buffering": "no",
    },
  });
}

/** 明确不允许其他方法，避免误用 */
export function GET() {
  return new Response("NOVA 对话验证接口仅接受 POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/* -------------------------------------------------------------------------- */
/* 入参校验                                                                    */
/* -------------------------------------------------------------------------- */

type Validation =
  | {
      value: {
        history: ConverseChatMessage[];
        userMessage: string;
        systemPrompt?: string;
      };
    }
  | { error: string; hint?: string };

/**
 * 校验并裁剪请求体。
 *
 * 历史消息的每一项都在信任边界上重新裁剪：对话上下文会被原样重发给
 * Agent，恶意或异常的大块内容会直接放大 token 成本。
 */
function validate(payload: ConverseRequest): Validation {
  if (typeof payload?.agentId !== "string" || payload.agentId.length === 0) {
    return { error: "缺少 agentId" };
  }

  if (
    typeof payload?.userMessage !== "string" ||
    payload.userMessage.trim().length === 0
  ) {
    return { error: "缺少 userMessage" };
  }

  const userMessage = payload.userMessage
    .trim()
    .slice(0, MAX_USER_MESSAGE_CHARS);

  const history = (Array.isArray(payload.history) ? payload.history : [])
    .slice(0, MAX_HISTORY_MESSAGES)
    .map(sanitizeMessage);

  let systemPrompt: string | undefined;
  if (payload.systemPrompt !== undefined && payload.systemPrompt !== "") {
    if (typeof payload.systemPrompt !== "string") {
      return { error: "systemPrompt 必须是字符串" };
    }
    // 与沙盒同一条防线：静态校验不过就不投放，不烧 token
    systemPrompt = payload.systemPrompt.slice(0, 8_000);
    const issues = lintSystemPrompt(systemPrompt);
    if (issues.length > 0) {
      return {
        error: `系统提示词未通过静态校验：${issues.join(" · ")}`,
        hint: "去掉越权指令特征后重试，或留空使用内置默认提示词。",
      };
    }
  }

  return { value: { history, userMessage, systemPrompt } };
}

/** 单条历史消息的裁剪：role 白名单、内容截断、工具调用结构兜底 */
function sanitizeMessage(item: unknown): ConverseChatMessage {
  const record = (
    typeof item === "object" && item !== null ? item : {}
  ) as Record<string, unknown>;

  const role: ConverseChatMessage["role"] =
    record.role === "assistant" || record.role === "tool"
      ? record.role
      : "user";

  const content =
    typeof record.content === "string"
      ? record.content.slice(
          0,
          role === "tool" ? MAX_TOOL_CONTENT_CHARS : MAX_CONTENT_CHARS,
        )
      : null;

  return {
    role,
    content,
    ...(role === "assistant" && Array.isArray(record.tool_calls)
      ? {
          tool_calls: record.tool_calls.slice(0, 8).map(sanitizeToolCall),
        }
      : {}),
    ...(role === "tool" && typeof record.tool_call_id === "string"
      ? { tool_call_id: record.tool_call_id }
      : {}),
  };
}

function sanitizeToolCall(
  item: unknown,
): NonNullable<ConverseChatMessage["tool_calls"]>[number] {
  const record = (
    typeof item === "object" && item !== null ? item : {}
  ) as Record<string, unknown>;
  const fn = (
    typeof record.function === "object" && record.function !== null
      ? record.function
      : {}
  ) as Record<string, unknown>;

  return {
    id:
      typeof record.id === "string"
        ? record.id.slice(0, 128)
        : `call_${Math.random().toString(36).slice(2)}`,
    type: "function",
    function: {
      name: typeof fn.name === "string" ? fn.name.slice(0, 128) : "",
      arguments:
        typeof fn.arguments === "string" ? fn.arguments.slice(0, 4_000) : "{}",
    },
  };
}

function jsonError(message: string, hint?: string, status = 500) {
  return new Response(
    JSON.stringify({
      type: "error",
      message,
      ...(hint ? { hint } : {}),
    } satisfies ConverseEvent),
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}
