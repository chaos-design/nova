import { getConfig } from "@chaos-design/config";
import type { ConverseEvent } from "@/lib/nova";
import {
  localAgentById,
  localAgentProfile,
  normalizeEndpoint,
  sanitizeIntentCandidates,
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
import { classifyAgentIntent } from "@/lib/nova/executors/intent-classify";
import { LlmError, readLlmSettings } from "@/lib/nova/executors/llm";

/**
 * 意图分发 + 转发接口（分类与执行合一）。
 *
 * 意图模式下客户端单次请求本路由：服务端先做零温度意图分类，
 * 把消息路由给最合适的候选 Agent，再直接驱动对话执行器并 SSE
 * 返回——分类与执行之间没有第二次客户端往返，转发发生在服务端。
 *
 * 路由结论在首个 meta 事件上标注（`dispatched.fallback`）：真实
 * 分类失败时按约定单发首个候选，绝不广播。分类前的每一步失败都
 * 以 JSON 错误返回（流还没建立，不值得为它开一条 SSE）。
 *
 * 历史上下文按候选分别携带（`histories`）：目标由服务端决定，
 * 客户端无法预知路由结果，只能为每个候选预备各自的会话历史。
 */

/** 流式响应需要的时间预算（秒）；分类一次 + 单轮最多 4 次模型调用 */
export const maxDuration = 120;

/** 分发请求体（字段全部按不可信输入处理） */
interface DispatchRequest {
  text?: unknown;
  agents?: unknown;
  histories?: unknown;
  systemPrompt?: unknown;
  overrides?: unknown;
}

export async function POST(request: Request) {
  let payload: DispatchRequest;

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CONVERSE_MAX_BODY_BYTES) {
      return converseJsonError(
        "请求体过大",
        "候选清单、各候选历史与消息总长不应超过 32KB。",
        413,
      );
    }
    payload = JSON.parse(text) as DispatchRequest;
  } catch {
    return converseJsonError("请求体不是合法 JSON", undefined, 400);
  }

  const userMessage = validateUserMessage(payload.text);
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

  // 候选整形后再过登记表：意图分发只能路由给登记在案的 Agent，
  // 与定点执行的档案反查是同一条信任边界
  const candidates = sanitizeIntentCandidates(payload.agents).filter(
    (item) => localAgentById(item.id) !== undefined,
  );

  if (candidates.length === 0) {
    return converseJsonError(
      "没有可分发的候选 Agent",
      "候选必须来自登记在 packages/web/src/lib/nova/local-agents.ts 的本地 Agent。",
      400,
    );
  }

  // --- 意图分类：失败按约定落首个候选，流照常建立 ---
  let routedTo = candidates[0].id;
  let fallback = false;

  if (candidates.length > 1) {
    try {
      const resolved = await classifyAgentIntent(
        userMessage.value,
        candidates,
        readLlmSettings(),
      );
      routedTo = resolved.agentId;
    } catch {
      fallback = true;
    }
  }

  const localEntry = localAgentById(routedTo);

  // 分类解析保证命中候选之一，而候选已过登记表过滤——这里兜住类型
  if (!localEntry) {
    return converseJsonError(`未注册的 Agent：${routedTo}`, undefined, 500);
  }

  const profile = localAgentProfile(localEntry);
  const novaConfig = getConfig();
  const effectiveSettings = {
    baseUrl: normalizeEndpoint(overrides.value.endpoint ?? localEntry.endpoint),
    // 密钥优先级与定点执行一致：界面覆盖 > 登记 env 变量 > 统一配置
    apiKey:
      overrides.value.apiKey ||
      process.env[localEntry.apiKeyEnv]?.trim() ||
      novaConfig.agent.llm.apiKey ||
      "",
    model: overrides.value.model ?? localEntry.model,
    maxTokens: novaConfig.agent.llm.maxTokens,
    timeoutMs: novaConfig.agent.llm.timeoutMs,
  };

  // 路由结果定了才取该 Agent 的历史：没有路由到的不浪费校验
  const history = sanitizeHistory(readHistory(payload.histories, routedTo));

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
        let metaSent = false;
        for await (const event of runConverseTurn(
          history,
          userMessage.value,
          profile,
          effectiveSettings,
          systemPrompt.value,
          request.signal,
        )) {
          if (!metaSent && event.type === "meta") {
            // 首个 meta 事件标注路由结论，客户端据此迁移会话分桶
            metaSent = true;
            send({ ...event, dispatched: { fallback } });
            continue;
          }
          // 对话轮不落库：与定点执行同一口径，评分权不交给被测方
          send(event);
        }
      } catch (error) {
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
      "X-Accel-Buffering": "no",
    },
  });
}

/** 明确不允许其他方法 */
export function GET() {
  return new Response("NOVA 意图分发接口仅接受 POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/**
 * 读取指定候选的会话历史。
 *
 * histories 是 agentId → 消息数组的映射；条目条数与内容长度
 * 交由 sanitizeHistory 统一裁剪。
 */
function readHistory(raw: unknown, agentId: string): unknown {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  return record[agentId];
}
