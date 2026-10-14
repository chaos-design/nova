import { getConfig } from "@chaos-design/config";
import type { AgentProfile, ConverseEvent } from "@/lib/nova";
import {
  localAgentById,
  localAgentProfile,
  normalizeEndpoint,
} from "@/lib/nova";
import { runConverseTurn } from "@/lib/nova/executors/converse";
import {
  CONVERSE_MAX_BODY_BYTES,
  converseJsonError,
  sanitizeHistory,
  sanitizeOverrides,
  validateSystemPrompt,
  validateUserMessage,
} from "@/lib/nova/executors/converse-request";

/**
 * 对话验证接口（Converse Lab）。
 *
 * 与沙盒路由同形态：**单次请求 + SSE 流式响应**。差别在于它是一条
 * **观测路径**：Agent 档案由服务端按 id 反查，对话上下文由客户端拼接
 * 后整轮回传（无状态约定），执行完不写 run-store、不产生评分。
 *
 * 入参校验沉淀在 `executors/converse-request.ts`，与意图分发路由
 * （`/api/agents/dispatch`）共用同一套信任边界。
 */

/** 流式响应需要的时间预算（秒）；单轮最多 4 次模型调用，另受模型自身耗时影响 */
export const maxDuration = 120;

export async function POST(request: Request) {
  let payload: Record<string, unknown>;

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CONVERSE_MAX_BODY_BYTES) {
      return converseJsonError(
        "请求体过大",
        "对话上下文与用户消息总长不应超过 32KB。",
        413,
      );
    }
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return converseJsonError("请求体不是合法 JSON", undefined, 400);
  }

  if (typeof payload.agentId !== "string" || payload.agentId.length === 0) {
    return converseJsonError("缺少 agentId", undefined, 400);
  }

  const userMessage = validateUserMessage(payload.userMessage);
  if ("error" in userMessage) {
    return converseJsonError(userMessage.error, userMessage.hint, 400);
  }

  const systemPrompt = validateSystemPrompt(payload.systemPrompt);
  if ("error" in systemPrompt) {
    return converseJsonError(systemPrompt.error, systemPrompt.hint, 400);
  }

  const overrides = sanitizeOverrides(payload.overrides);
  if ("error" in overrides) {
    return converseJsonError(overrides.error, overrides.hint, 400);
  }

  // Agent 档案由服务端按 id 反查；端点/模型/密钥可被可视化配置覆盖，
  // 覆盖值已逐项校验，仅在本次请求内生效（服务端不落任何存储）
  const localEntry = localAgentById(payload.agentId);

  if (!localEntry) {
    return converseJsonError(
      `未注册的 Agent：${payload.agentId}`,
      "只有登记在 packages/web/src/lib/nova/local-agents.ts 的本地 Agent 可以被对话验证。",
      400,
    );
  }

  const profile: AgentProfile = localAgentProfile(localEntry);
  const novaConfig = getConfig();
  const effectiveSettings = {
    baseUrl: normalizeEndpoint(overrides.value.endpoint ?? localEntry.endpoint),
    // 密钥优先级：界面覆盖 > 登记的 env 变量 > 统一配置（.env 的 NOVA_LLM_API_KEY）
    apiKey:
      overrides.value.apiKey ||
      process.env[localEntry.apiKeyEnv]?.trim() ||
      novaConfig.agent.llm.apiKey ||
      "",
    model: overrides.value.model ?? localEntry.model,
    maxTokens: novaConfig.agent.llm.maxTokens,
    timeoutMs: novaConfig.agent.llm.timeoutMs,
  };

  const history = sanitizeHistory(payload.history);

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
          history,
          userMessage.value,
          profile,
          effectiveSettings,
          systemPrompt.value,
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
