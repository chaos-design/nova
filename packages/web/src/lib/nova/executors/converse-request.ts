import "server-only";

import type {
  ConverseChatMessage,
  ConverseEvent,
  ConverseOverrides,
} from "../executor";
import { lintSystemPrompt } from "./live";

/**
 * 对话执行链路的共享请求校验。
 *
 * `/api/agents/converse`（定点执行）与 `/api/agents/dispatch`
 * （意图分发后转发）面对同一类不可信输入：历史消息会被原样重发
 * 给 Agent、端点覆盖是潜在 SSRF 面、系统提示词要先过静态校验。
 * 两条路径共用这一份校验，信任边界因此只有一处定义。
 */

/** 单次请求体大小上限 */
export const CONVERSE_MAX_BODY_BYTES = 32_768;

/** 历史消息条数上限：超过后上下文与 token 成本失去可控性 */
export const MAX_HISTORY_MESSAGES = 24;

/** 单条 user / assistant 消息的长度上限 */
export const MAX_CONTENT_CHARS = 4_000;

/** tool 消息的执行器侧截断上限与之一致（converse.ts 的 TOOL_RESULT_CAP） */
export const MAX_TOOL_CONTENT_CHARS = 1_500;

/** 本轮用户消息的长度上限 */
export const MAX_USER_MESSAGE_CHARS = 2_000;

/** 覆盖值的长度上限：端点 / 模型 / 密钥都远用不到这么长 */
const OVERRIDE_LIMITS = { endpoint: 300, model: 120, apiKey: 300 } as const;

/** 校验失败的可读结论 */
export type FieldValidation<T> =
  | { value: T }
  | { error: string; hint?: string };

/**
 * 校验并裁剪用户消息。
 *
 * 消息会在下一轮被原样重发给 Agent，恶意或异常的大块内容会直接
 * 放大 token 成本，因此先裁长度再放行。
 */
export function validateUserMessage(raw: unknown): FieldValidation<string> {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { error: "缺少 userMessage" };
  }
  return { value: raw.trim().slice(0, MAX_USER_MESSAGE_CHARS) };
}

/**
 * 校验系统提示词覆盖。
 *
 * 与沙盒同一条防线：静态校验不过就不投放，不烧 token。
 * 缺省（undefined / 空串）表示沿用内置默认提示词。
 */
export function validateSystemPrompt(
  raw: unknown,
): FieldValidation<string | undefined> {
  if (raw === undefined || raw === "") return { value: undefined };
  if (typeof raw !== "string") return { error: "systemPrompt 必须是字符串" };

  const systemPrompt = raw.slice(0, 8_000);
  const issues = lintSystemPrompt(systemPrompt);
  if (issues.length > 0) {
    return {
      error: `系统提示词未通过静态校验：${issues.join(" · ")}`,
      hint: "去掉越权指令特征后重试，或留空使用内置默认提示词。",
    };
  }
  return { value: systemPrompt };
}

/** 历史消息整段裁剪：条数钳上限，逐条过 sanitizeMessage */
export function sanitizeHistory(raw: unknown): ConverseChatMessage[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_HISTORY_MESSAGES)
    .map(sanitizeMessage);
}

/** 单条历史消息的裁剪：role 白名单、内容截断、工具调用结构兜底 */
export function sanitizeMessage(item: unknown): ConverseChatMessage {
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

/**
 * 校验可视化配置覆盖值。
 *
 * 端点会由服务端发起请求，是潜在的 SSRF 面：协议必须显式为 http(s)，
 * 长度全部钳到远超实际用量的上限；字段缺省（undefined）表示沿用默认。
 */
export function sanitizeOverrides(
  raw: unknown,
): FieldValidation<ConverseOverrides> {
  if (raw === undefined || raw === null) return { value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "overrides 必须是对象" };
  }

  const record = raw as Record<string, unknown>;
  const value: ConverseOverrides = {};

  if (record.endpoint !== undefined && record.endpoint !== "") {
    if (typeof record.endpoint !== "string") {
      return { error: "overrides.endpoint 必须是字符串" };
    }
    const endpoint = record.endpoint.trim().slice(0, OVERRIDE_LIMITS.endpoint);
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          error: "overrides.endpoint 只允许 http/https 协议",
          hint: "端点形如 https://api.example.com/v1。",
        };
      }
      value.endpoint = endpoint;
    } catch {
      return {
        error: "overrides.endpoint 不是合法 URL",
        hint: "端点形如 https://api.example.com/v1（带 /v1，无末尾斜杠）。",
      };
    }
  }

  if (record.model !== undefined && record.model !== "") {
    if (typeof record.model !== "string") {
      return { error: "overrides.model 必须是字符串" };
    }
    value.model = record.model.trim().slice(0, OVERRIDE_LIMITS.model);
  }

  if (record.apiKey !== undefined && record.apiKey !== "") {
    if (typeof record.apiKey !== "string") {
      return { error: "overrides.apiKey 必须是字符串" };
    }
    value.apiKey = record.apiKey.trim().slice(0, OVERRIDE_LIMITS.apiKey);
  }

  return { value };
}

/** 400/413/500 的统一错误体：形状是 ConverseEvent 的 error 事件 */
export function converseJsonError(
  message: string,
  hint?: string,
  status = 500,
): Response {
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
