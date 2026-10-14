/**
 * Agent 侧领域工具层。
 *
 * 领域 Agent 与「裸模型端点」的差别就在这里：它自己带**真实工具**——
 * 真正发出去的 HTTP 请求、真正算出来的统计，而不是把工具调用原样丢给
 * NOVA 去演。工具结果只回灌给本 Agent 的上游模型，NOVA 侧看不到伪造语料。
 *
 * 与 NOVA 工具的分工（协议 §5）：
 * - `external_search` / `summarize` 是 **NOVA 的工具**，执行器负责真实代执行，
 *   本层只原样透传（连同一个 tool_call 里混着两类工具的情况也拆开处理）；
 * - 本层声明的工具是 **Agent 自己的工具**，在返回 NOVA 之前就地执行完，
 *   它们的调用与结果不进 NOVA 的观测面 —— 这是刻意的：被评测的是
 *   NOVA 眼里的行为，Agent 内部怎么查天气不该算进它的工具调用得分。
 *
 * 纯 Node ESM，无第三方依赖；不 import service.mjs（避免循环依赖）。
 */

/** 单个工具结果回灌给上游时的字符上限：防止长结果把上下文撑爆 */
export const TOOL_RESULT_CAP = 4_000;

/** 领域工具自执行的默认轮次上限：用尽后剥掉工具强制收口，杜绝无限循环 */
export const DEFAULT_MAX_TOOL_ROUNDS = 3;

/**
 * 声明一个领域工具。
 *
 * @param {object} spec
 * @param {string} spec.name 工具名（OpenAI function name，只允许字母数字与下划线）
 * @param {string} spec.description 给模型读的用途说明
 * @param {object} spec.parameters JSON Schema 形式的参数定义
 * @param {(args: Record<string, unknown>, ctx: { timeoutMs: number }) => Promise<{ content: string, records?: number, ok?: boolean }>} spec.handler
 *   真实执行体：抛错即视为工具失败，由本层转成可读错误回灌给模型
 * @returns {{ name: string, description: string, parameters: object, handler: Function }}
 */
export function defineTool(spec) {
  const name = String(spec?.name ?? "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `工具名不合法：${name || "(missing)"}（只允许字母、数字与下划线）`,
    );
  }
  if (typeof spec?.handler !== "function") {
    throw new Error(
      `工具 ${name} 缺少 handler：领域工具必须在 Agent 侧真实执行。`,
    );
  }

  return {
    name,
    description: String(spec.description ?? "").trim(),
    parameters: spec.parameters ?? { type: "object", properties: {} },
    handler: spec.handler,
  };
}

/**
 * 把一组声明好的工具装进执行器。
 *
 * @param {object} options
 * @param {ReturnType<typeof defineTool>[]} options.tools 工具清单
 * @param {number} [options.maxRounds] 领域工具自执行的最大轮次
 * @param {number} [options.timeoutMs] 单个工具的超时预算（handler 自行使用）
 */
export function createDomainToolkit(options) {
  const tools = Array.isArray(options?.tools) ? options.tools : [];
  const names = new Set(tools.map((tool) => tool.name));

  if (names.size !== tools.length) {
    throw new Error("领域工具存在重名：工具名是模型选择工具的唯一依据。");
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    /** OpenAI 形状的工具定义，直接并进上游 payload 的 tools */
    definitions: tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    /** 本 Agent 自己的工具名集合：命中的调用就地执行，不交给 NOVA */
    names,
    /** 工具数量为 0 时整层等价于不存在，upstream payload 保持不变 */
    enabled: tools.length > 0,
    maxRounds:
      Number.isInteger(options?.maxRounds) && options.maxRounds > 0
        ? options.maxRounds
        : DEFAULT_MAX_TOOL_ROUNDS,
    timeoutMs:
      Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : 10_000,

    /**
     * 真实执行一次领域工具调用。
     *
     * 永不抛错：失败也是可观测结果，转成 `错误：…` 回灌给模型，
     * 让上游有机会降级重试 —— 这与 NOVA 执行器对工具失败的处理口径一致。
     */
    async run(name, args) {
      const tool = byName.get(name);
      if (!tool) {
        return {
          ok: false,
          records: 0,
          content: `错误：未知领域工具 ${name}。`,
        };
      }

      try {
        const result = await tool.handler(args ?? {}, {
          timeoutMs:
            Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0
              ? options.timeoutMs
              : 10_000,
        });
        const content = String(result?.content ?? "");
        return {
          ok: result?.ok !== false,
          records:
            Number.isFinite(result?.records) && result.records >= 0
              ? Math.trunc(result.records)
              : 0,
          content:
            content.length > TOOL_RESULT_CAP
              ? `${content.slice(0, TOOL_RESULT_CAP)}…`
              : content,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          records: 0,
          content: `错误：${tool.name} 执行失败：${message}`,
        };
      }
    },
  };
}

/**
 * 解析工具的 arguments。
 *
 * 上游给的是字符串（部分端点会直接给对象）：字符串解析失败按空参数处理，
 * 由工具自己的参数校验去暴露 —— 这里静默兜底比抛错更利于诊断。
 */
export function parseToolArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || raw.trim().length === 0) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 真实 HTTP 取 JSON：领域工具的唯一网络入口。
 *
 * 平台侧的全部网络行为都收在这一个函数里，超时、非 2xx、非 JSON 都转成
 * 可读错误 —— 真实互联网的失败必须让模型看得见，而不是悄悄返回空数据。
 */
export async function fetchJson(
  url,
  { timeoutMs = 10_000, headers = {}, method = "GET" } = {},
) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...headers },
      // 真实公开数据源：跟随重定向（部分汇率 / 词条接口会 301 到规范域）
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new Error(
      timedOut
        ? `上游数据源在 ${timeoutMs}ms 内没有响应`
        : `无法连接数据源（${url}）`,
    );
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`数据源返回 ${response.status}：${text.slice(0, 160)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("数据源返回了非 JSON 响应");
  }
}
