import { getConfig } from "@chaos-design/config";
import type { ConverseOverrides } from "@/lib/nova";
import { normalizeEndpoint, validateLlmEndpoint } from "@/lib/nova";

/**
 * 模型列表代理。
 *
 * 浏览器不能直连 LLM 端点（CORS 与密钥暴露），由服务端代为请求
 * `GET {endpoint}/models`。密钥优先级与对话路由一致：
 * 界面覆盖 > .env 的 NOVA_LLM_API_KEY；只在本次请求内透传，不落任何存储。
 */

/** 单次代理请求的超时（毫秒） */
const PROXY_TIMEOUT_MS = 10_000;

export async function POST(request: Request) {
  let payload: ConverseOverrides & { endpoint?: string };

  try {
    payload = (await request.json()) as ConverseOverrides;
  } catch {
    return json({ message: "请求体不是合法 JSON" }, 400);
  }

  const validated = validateLlmEndpoint(payload?.endpoint);
  if (!validated.ok) {
    return json({ message: validated.message, hint: validated.hint }, 400);
  }

  // 界面没存密钥时兜底读 .env：浏览器侧拿不到也不该拿到 env 值
  const apiKey = payload.apiKey?.trim() || getConfig().agent.llm.apiKey || "";

  let response: Response;
  try {
    response = await fetch(`${normalizeEndpoint(validated.url)}/models`, {
      headers: {
        "Content-Type": "application/json",
        // 无鉴权端点（Ollama 等）不发送 Authorization
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return json(
        { message: `模型列表请求超时（${PROXY_TIMEOUT_MS}ms）` },
        504,
      );
    }
    return json(
      {
        message: "无法连接端点",
        hint: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }

  if (!response.ok) {
    return json(
      { message: `端点返回 ${response.status}，请检查端点与密钥` },
      502,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return json({ message: "端点返回了非 JSON 响应" }, 502);
  }

  // OpenAI 兼容形如 { data: [{ id }] }；宽松提取字符串 id
  const ids = extractModelIds(body);

  return Response.json({ models: ids });
}

function extractModelIds(payload: unknown): string[] {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const ids = data
    .map((item) =>
      typeof item === "object" && item !== null && "id" in item
        ? (item as { id?: unknown }).id
        : null,
    )
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** 明确不允许其他方法 */
export function GET() {
  return new Response("模型列表代理仅接受 POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}
