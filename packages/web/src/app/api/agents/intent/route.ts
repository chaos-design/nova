import {
  chatCompletion,
  LlmError,
  readLlmSettings,
} from "@/lib/nova/executors/llm";

/**
 * 意图分发代理。
 *
 * 多目标模式下「意图分发」用真实大模型做一次零温度分类：根据用户
 * 消息与候选 Agent 的模型标识，选出最合适的一个。分类调用与验证
 * 执行共用同一套 .env 端点与密钥（服务端解析，永不进客户端）。
 */

/** 分类请求体 */
interface IntentRequest {
  text?: string;
  agents?: { id?: unknown; name?: unknown; model?: unknown }[];
}

/** 单次分类的超时（毫秒） */
const INTENT_TIMEOUT_MS = 15_000;

/** 输入与候选的数量/长度上限 */
const MAX_TEXT_CHARS = 2_000;
const MAX_AGENTS = 10;

export async function POST(request: Request) {
  let payload: IntentRequest;

  try {
    payload = (await request.json()) as IntentRequest;
  } catch {
    return json({ message: "请求体不是合法 JSON" }, 400);
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return json({ message: "缺少 text" }, 400);

  const candidates = (Array.isArray(payload.agents) ? payload.agents : [])
    .slice(0, MAX_AGENTS)
    .map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `agent-${index}`,
      name: typeof item?.name === "string" ? item.name : "",
      model: typeof item?.model === "string" ? item.model : "",
    }))
    .filter((item) => item.name || item.model);

  if (candidates.length === 0) return json({ message: "缺少候选 Agent" }, 400);
  if (candidates.length === 1)
    return Response.json({ agentId: candidates[0].id });

  const settings = readLlmSettings();
  const candidateText = candidates
    .map((item) => `- id=${item.id} 名称=${item.name} 模型=${item.model}`)
    .join("\n");

  try {
    const completion = await chatCompletion(settings, {
      model: settings.model,
      messages: [
        {
          role: "system",
          content:
            "你是任务分发器。根据用户消息的意图，从候选 Agent 中选出最合适的一个，只输出该 Agent 的 id，不要输出任何其他文字。",
        },
        {
          role: "user",
          content: `候选 Agent：\n${candidateText}\n\n用户消息：${text.slice(0, MAX_TEXT_CHARS)}\n\n只输出最合适候选的 id。`,
        },
      ],
      tools: [],
      temperature: 0,
      maxTokens: 20,
      signal: AbortSignal.timeout(INTENT_TIMEOUT_MS),
    });

    const output = completion.content.trim();
    const hit =
      candidates.find((item) => output.includes(item.id)) ??
      candidates.find((item) => output.includes(item.name));
    return Response.json({ agentId: hit?.id ?? null, output });
  } catch (error) {
    if (error instanceof LlmError) {
      return json({ message: error.message, hint: error.hint }, 502);
    }
    return json({ message: "意图识别失败" }, 502);
  }
}

/** 明确不允许其他方法 */
export function GET() {
  return new Response("意图分发接口仅接受 POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}
