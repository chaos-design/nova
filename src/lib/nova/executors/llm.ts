import "server-only";

/**
 * OpenAI 兼容的 chat completions 客户端。
 *
 * 刻意不引入 SDK：沙盒只需要「发一次非流式请求、拿 tool_calls」这一个能力，
 * 而 SDK 会带来版本耦合、多供应商差异适配与额外的心智负担。
 * 只要供应商兼容 OpenAI 协议（OpenAI / DeepSeek / Moonshot / Qwen / vLLM /
 * Ollama / 各类网关），改一个 `LLM_BASE_URL` 就能切换。
 */

/** 一次对话消息，兼容 OpenAI 的 role / content / tool_calls 结构 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** assistant 侧的原生 tool_calls 回传，保证多轮工具调用上下文连续 */
  tool_calls?: RawToolCall[];
  /** tool 侧的调用 id */
  tool_call_id?: string;
}

export interface RawToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: readonly unknown[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletion {
  content: string;
  toolCalls: RawToolCall[];
  usage: ChatUsage;
  /** 模型原始标识，便于在报告里记录实际跑了什么 */
  model: string;
}

/** 运行期配置（只在服务端解析，密钥永不进入客户端包） */
export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

/** 从环境变量解析配置；缺配置时返回 null */
export function readLlmSettings(): LlmSettings | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim();

  if (!baseUrl || !model) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: apiKey ?? "",
    model,
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2_000),
  };
}

/** 供应商不可用 / 协议不符 / 配额耗尽，统一归为可读错误 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * 发起一次非流式对话补全。
 *
 * 刻意用非流式：沙盒需要的是"每一轮工具调用后拿到完整 tool_calls"，
 * 流式在这里只会增加协议复杂度而不带来任何收益。
 */
export async function chatCompletion(
  settings: LlmSettings,
  request: ChatRequest,
): Promise<ChatCompletion> {
  let response: Response;

  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 本地服务（Ollama 等）没有密钥要求：非空才带 Authorization
        ...(settings.apiKey
          ? { Authorization: `Bearer ${settings.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: request.messages,
        tools: request.tools,
        tool_choice: "auto",
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false,
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new LlmError(
      `无法连接模型服务（${settings.baseUrl}）`,
      "请检查 LLM_BASE_URL 是否可访问，以及本机网络与代理设置。",
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new LlmError(
      `模型服务返回 ${response.status}：${body.slice(0, 200)}`,
      response.status === 401
        ? "LLM_API_KEY 无效或已过期。"
        : response.status === 429
          ? "供应商侧限流或配额耗尽，请稍后重试。"
          : "请确认 LLM_BASE_URL 指向的是 OpenAI 兼容的 /v1 端点，且该模型支持 function calling。",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LlmError(
      "模型服务返回了非 JSON 响应",
      "该地址可能不是 OpenAI 兼容端点。",
    );
  }

  return parseCompletion(payload, settings.model);
}

interface RawCompletion {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: RawToolCall[];
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

function parseCompletion(
  payload: unknown,
  fallbackModel: string,
): ChatCompletion {
  const data = payload as RawCompletion;
  const choice = data.choices?.[0];

  if (!choice?.message) {
    throw new LlmError(
      "模型响应缺少 choices[0].message",
      "该端点可能不兼容 OpenAI chat completions 协议。",
    );
  }

  return {
    content: choice.message.content ?? "",
    toolCalls: choice.message.tool_calls ?? [],
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
    model: data.model ?? fallbackModel,
  };
}

/** 解析 tool_calls 的 JSON 参数；解析失败返回空对象而不是抛错 */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
