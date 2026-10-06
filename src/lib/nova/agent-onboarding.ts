/**
 * 本地 Agent 接入的数据访问边界。
 *
 * 组件不直接 `fetch`：接口路径、错误归一与兜底结构都收在这里，
 * 界面只关心"探测结论长什么样"。
 */

/** 端点探测结论 */
export interface EndpointProbe {
  /** 端点是否有响应（含鉴权失败：有响应即可达） */
  reachable: boolean;
  /** 是否返回了 OpenAI 兼容的 `{ data: [{ id }] }` 模型清单 */
  openaiCompatible: boolean;
  /** 端点暴露的模型 id 列表 */
  models: string[];
  /** 往返耗时（毫秒） */
  latencyMs: number;
  /** 失败原因；可达时为 null */
  message: string | null;
  /** 可操作的排查建议 */
  hint: string | null;
}

/** 探测接口地址 */
const PROBE_ENDPOINT = "/api/agents/probe";

/**
 * 探测一个 OpenAI 兼容端点。
 *
 * 永远不会抛错：网络失败时也会返回一个结构完整的失败结论，
 * 否则界面就得同时处理"没有结果"和"结果是失败"两种空态。
 */
export async function probeAgentEndpoint(
  endpoint: string,
): Promise<EndpointProbe> {
  try {
    const response = await fetch(PROBE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    const payload = (await response.json()) as Partial<EndpointProbe>;

    return {
      reachable: Boolean(payload.reachable),
      openaiCompatible: Boolean(payload.openaiCompatible),
      models: payload.models ?? [],
      latencyMs: payload.latencyMs ?? 0,
      message: payload.message ?? null,
      hint: payload.hint ?? null,
    };
  } catch {
    return {
      reachable: false,
      openaiCompatible: false,
      models: [],
      latencyMs: 0,
      message: "探测请求没有发出去",
      hint: "确认开发服务器正在运行，然后重试。",
    };
  }
}
