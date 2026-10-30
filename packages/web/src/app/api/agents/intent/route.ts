import { sanitizeIntentCandidates } from "@/lib/nova";
import { classifyAgentIntent } from "@/lib/nova/executors/intent-classify";
import { LlmError, readLlmSettings } from "@/lib/nova/executors/llm";

/**
 * 意图分发代理（分类即服务）。
 *
 * 多目标模式下「意图分发」用真实大模型做一次零温度分类：根据用户
 * 消息与候选 Agent 的领域描述，选出最合适的一个。分类调用与验证
 * 执行共用同一套 .env 端点与密钥（服务端解析，永不进客户端）。
 *
 * 提示词构造、候选整形与解析兜底（单发、绝不广播）沉淀在
 * `src/lib/nova/intent.ts`；需要「分类 + 执行」一次完成的场景用
 * `/api/agents/dispatch`，本路由只做分类。
 */

/** 分类请求体（字段全部按不可信输入处理） */
interface IntentRequest {
  text?: unknown;
  agents?: unknown;
}

/** 单次请求体大小上限：候选与消息都远用不到这么大 */
const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  let payload: IntentRequest;

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ message: "请求体过大" }, 413);
    }
    payload = JSON.parse(text) as IntentRequest;
  } catch {
    return json({ message: "请求体不是合法 JSON" }, 400);
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return json({ message: "缺少 text" }, 400);

  const candidates = sanitizeIntentCandidates(payload.agents);
  if (candidates.length === 0) return json({ message: "缺少候选 Agent" }, 400);

  // 单候选没有分类价值：直接返回，省一次模型调用
  if (candidates.length === 1)
    return Response.json({ agentId: candidates[0].id });

  try {
    const resolved = await classifyAgentIntent(
      text,
      candidates,
      readLlmSettings(),
    );
    return Response.json({
      agentId: resolved.agentId,
      output: resolved.output,
    });
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
