import type { LiveRunRequest, SandboxEvent } from "@/lib/nova/executor";
import { runLive } from "@/lib/nova/executors/live";
import { type LlmSettings, readLlmSettings } from "@/lib/nova/executors/llm";
import { localAgentById, localAgentProfile } from "@/lib/nova/local-agents";
import { agentById } from "@/lib/nova/mock-data";
import type { AgentProfile } from "@/lib/nova/types";

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
  // 全局配置是内置 Agent 的运行配置；本地 Agent 有自己完整的运行配置，
  // 因此这里的 settings 允许为 null，而在分流后按需判定是否缺失。
  const settings = readLlmSettings();

  let payload: LiveRunRequest;

  try {
    const text = await request.text();

    if (text.length > MAX_BODY_BYTES) {
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

  // Agent 档案由服务端按 id 反查：绝不相信客户端传来的档案内容，
  // 否则评分就变成了"客户端自己给自己打分"。
  // 内置 Agent 用全局 LLM_* 配置；本地 Agent 用它自己登记的端点/模型与
  // 它自己的密钥环境变量（找不到时降级为无鉴权调用，Ollama 等可跑通）。
  const localEntry = localAgentById(payload.agentId);

  let profile: AgentProfile;
  let effectiveSettings: LlmSettings | null;

  if (localEntry) {
    profile = localAgentProfile(localEntry);
    // 密钥仍只来自服务端环境变量；登记侧给的是变量名，不是值
    effectiveSettings = {
      baseUrl: localEntry.endpoint,
      apiKey:
        process.env[localEntry.apiKeyEnv]?.trim() ??
        process.env.LLM_API_KEY?.trim() ??
        "",
      model: localEntry.model,
      maxTokens: Number(process.env.LLM_MAX_TOKENS) || 2_000,
    };
  } else {
    try {
      profile = agentById(payload.agentId);
    } catch {
      return jsonError(`未注册的 Agent：${payload.agentId}`, undefined, 400);
    }
    if (!settings) {
      return jsonError(
        "真实执行器未配置",
        "请在 .env.local 中设置 LLM_BASE_URL、LLM_MODEL 后重启开发服务器；也可以在 local-agents.ts 登记一个本地 Agent。",
      );
    }
    effectiveSettings = settings;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SandboxEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        for await (const event of runLive(
          { ...config.value, agentId: profile.id },
          profile,
          effectiveSettings,
          request.signal,
        )) {
          send(event);
        }
      } catch (error) {
        // 兜底：执行器内部已经处理过的错误不会走到这里
        send({
          type: "error",
          message: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        controller.close();
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
