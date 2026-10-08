import { CHAOS_KINDS } from "@/lib/nova/constants";
import type { LiveRunRequest, SandboxEvent } from "@/lib/nova/executor";
import { runLive } from "@/lib/nova/executors/live";
import { localAgentById, localAgentProfile } from "@/lib/nova/local-agents";
import { recordRun } from "@/lib/nova/run-store";
import type { AgentProfile, ChaosInjection } from "@/lib/nova/types";

/**
 * 真实沙盒执行接口。
 *
 * 设计要点：**单次请求 + 流式响应**，而不是"提交任务 + 轮询状态"。
 * 后者需要在服务端保存运行状态（内存 / Redis / 数据库），对一个演示执行器
 * 来说是完全不必要的复杂度；单次请求天然无状态，能直接跑在任何无状态平台上。
 *
 * 事件以 SSE 帧输出，消费方（`useSandboxRun`）看到的与本地仿真执行器完全一致。
 */

/** 流式响应需要的时间预算（秒）；同时受模型自身耗时影响 */
export const maxDuration = 120;

/** 单次请求体大小上限，防止被构造出超大提示词 */
const MAX_BODY_BYTES = 32_768;

export async function POST(request: Request) {
  let payload: LiveRunRequest;

  try {
    const text = await request.text();

    // 按 UTF-8 字节而非字符数校验：中文提示词的字符数远小于线上字节数
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return jsonError("请求体过大", "系统提示词不应超过 32KB。", 413);
    }

    payload = JSON.parse(text) as LiveRunRequest;
  } catch {
    return jsonError("请求体不是合法 JSON", undefined, 400);
  }

  const config = validate(payload);

  if ("error" in config) {
    return jsonError(config.error, config.hint, 400);
  }

  if (!isValidChaos(config.value.chaos)) {
    return jsonError(
      "chaos 配置含未知故障类型",
      `kind 必须是 ${CHAOS_KINDS.map((item) => item.kind).join(" / ")} 之一。`,
      400,
    );
  }

  // Agent 档案由服务端按 id 反查：绝不相信客户端传来的档案内容，
  // 否则评分就变成了"客户端自己给自己打分"。
  // 只有登记过的本地 Agent 可被投放 —— NOVA 不再维护任何内置档案。
  const localEntry = localAgentById(payload.agentId);

  if (!localEntry) {
    return jsonError(
      `未注册的 Agent：${payload.agentId}`,
      "只有登记在 src/lib/nova/local-agents.ts 的本地 Agent 可以被投放。",
      400,
    );
  }

  const profile: AgentProfile = localAgentProfile(localEntry);

  // 密钥仍只来自服务端环境变量；登记侧给的是变量名，不是值
  const effectiveSettings = {
    baseUrl: localEntry.endpoint,
    apiKey:
      process.env[localEntry.apiKeyEnv]?.trim() ??
      process.env.LLM_API_KEY?.trim() ??
      "",
    model: localEntry.model,
    maxTokens: Number(process.env.LLM_MAX_TOKENS) || 2_000,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端中止（停止按钮 / 离开页面）后流即取消：
      // 对已取消的流 enqueue / close 都会抛错，必须全部防护，
      // 否则每次中止都会在服务端留下一个未处理的 Promise 拒绝
      const send = (event: SandboxEvent) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // 流已被消费方取消：后续事件自然不再发送
        }
      };

      const startedAt = Date.now();

      try {
        for await (const event of runLive(
          { ...config.value, agentId: profile.id },
          profile,
          effectiveSettings,
          request.signal,
        )) {
          // 落库放在服务端而不是让客户端回传：评分若由客户端上报，
          // 就等于把打分权交给了被测方
          if (event.type === "done" && !request.signal.aborted) {
            await recordRun({
              agentId: profile.id,
              environment: config.value.environment,
              success: event.result.success,
              score: event.result.score,
              summary: event.result.summary,
              durationMs: Date.now() - startedAt,
              stages: event.result.stages,
              observations: event.result.observations,
              usage: event.result.usage,
            });
          }

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

/* -------------------------------------------------------------------------- */
/* 入参校验                                                                    */
/* -------------------------------------------------------------------------- */

type Validation =
  | { value: Omit<LiveRunRequest, "agentId"> }
  | { error: string; hint?: string };

/**
 * 校验并裁剪请求体。
 *
 * 这里的裁剪不是"防御性编程"的仪式：注入强度、步数上限都是会直接影响
 * 服务端 token 消耗与运行时长的量，必须在信任边界上钳死。
 */
function validate(payload: LiveRunRequest): Validation {
  if (typeof payload?.agentId !== "string" || payload.agentId.length === 0) {
    return { error: "缺少 agentId" };
  }

  if (typeof payload.systemPrompt !== "string") {
    return { error: "缺少 systemPrompt" };
  }

  if (!Array.isArray(payload.chaos)) {
    return { error: "缺少 chaos 配置" };
  }

  if (!["deterministic", "stochastic", "arena"].includes(payload.environment)) {
    return { error: `未知环境：${payload.environment}` };
  }

  const maxSteps = Number(payload.maxSteps);
  if (!Number.isFinite(maxSteps) || maxSteps < 2) {
    return { error: "maxSteps 至少为 2" };
  }

  // 服务端再钳一次上限：不信任客户端声明的 maxSteps
  const capped = Math.min(Math.round(maxSteps), 20);

  return {
    value: {
      systemPrompt: payload.systemPrompt.slice(0, 8_000),
      environment: payload.environment,
      chaos: payload.chaos.slice(0, 8).map((item) => ({
        kind: item.kind,
        enabled: Boolean(item.enabled),
        intensity: Math.min(Math.max(Number(item.intensity) || 0, 0), 1),
      })),
      maxSteps: capped,
    },
  };
}

/** chaos 注入的 kind 必须是已知故障类型，非法值会让剧本静默失真 */
function isValidChaos(chaos: readonly ChaosInjection[]): boolean {
  const known = new Set(CHAOS_KINDS.map((item) => item.kind));
  return chaos.every((item) => known.has(item.kind));
}

function jsonError(message: string, hint?: string, status = 500) {
  return new Response(
    JSON.stringify({
      type: "error",
      message,
      ...(hint ? { hint } : {}),
    } satisfies SandboxEvent),
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

/** 明确不允许其他方法，避免误用 */
export function GET() {
  return new Response("NOVA 沙盒执行接口仅接受 POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
