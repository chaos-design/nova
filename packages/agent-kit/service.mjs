/**
 * 领域 Agent 的服务骨架。
 *
 * 把 playground 各执行体（nova-research / nova-coder 及脚手架产物）
 * 的共同部分收拢到一处：上游调用的错误映射、chat/completions 的
 * 处理器组装、OpenAI 兼容 HTTP 路由。各 Agent 只提供自己的
 * 模型标识、人格层与标签文案，不再各自维护一份转发实现。
 *
 * 上游可整体注入（`deps.upstream` / `upstream` 选项）：单测用桩
 * 覆盖错误映射与整形断言，不烧真实 token。
 */

import { createServer } from "node:http";
import { toClientResponse } from "./persona.mjs";
import { parseToolArgs } from "./tools.mjs";

/** 携带 HTTP 状态码的错误：服务按状态码回给调用方，NOVA 侧可读 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * 创建上游调用器：把一次 OpenAI 形状的 payload 转发给真实大模型。
 *
 * 错误映射与 NOVA 执行器的口径一致：超时/连接失败归 504，
 * 非 JSON 归 502，非 2xx 状态码原样透传（NOVA 对 401 / 429
 * 有专门的处置话术）。
 *
 * @param {{ baseUrl: string, model: string, apiKey?: string, timeoutMs: number }} upstream
 *   resolveUpstream 的产物；文案里指向 .env 的 NOVA_LLM_*，因为上游配置来自那里
 */
export function createUpstreamCaller(upstream) {
  const { baseUrl, model, apiKey, timeoutMs } = upstream;

  return async function callUpstream(payload) {
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 上游无鉴权时（如本地 Ollama）不发 Authorization
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new HttpError(
        504,
        timedOut
          ? `上游模型调用超时（${timeoutMs}ms）：${model}`
          : `无法连接上游模型端点（${baseUrl}）`,
      );
    }

    const text = await response.text();

    if (!response.ok) {
      // 状态码原样透传：NOVA 对 401 / 429 有专门的处置话术
      throw new HttpError(
        response.status,
        `上游模型端点返回 ${response.status}：${text.slice(0, 200)}（检查 .env 的 NOVA_LLM_* 配置）`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, "上游模型端点返回了非 JSON 响应。");
    }
  };
}

/**
 * 组装 chat/completions 处理器：模型标识校验 → 人格整形 → 上游转发 →
 * 以登记的模型 id 回显。带领域工具时，中间多一段「就近自执行」循环。
 *
 * 工具的两类归属在 `tools.mjs` 里定义：Agent 自己的工具就地真实执行、
 * 结果只回灌给上游；NOVA 的工具（`external_search` / `summarize`）
 * 原样透传回调用方，由 NOVA 执行器真实代执行 —— 被观测到的工具调用
 * 因此仍然只有 NOVA 那一套，评分口径不受影响。
 *
 * @param {object} options
 * @param {string} options.model 本端点登记的模型 id（协议 §1：只服务这一个 id）
 * @param {{ prompt: string, toUpstreamPayload: Function }} options.personaLayer createPersonaLayer 的产物
 * @param {(payload: object) => Promise<object>} options.upstream createUpstreamCaller 的产物
 * @param {string} options.upstreamModel 上游真实模型 id（生产恒为 agent.llm.model）
 * @param {ReturnType<import("./tools.mjs").createDomainToolkit>} [options.toolkit]
 *   createDomainToolkit 的产物；缺省时行为与不带工具完全一致
 * @returns {(body: object, deps?: { upstream?: Function, upstreamModel?: string, toolkit?: object }) => Promise<object>}
 *   deps 仅测试注入用：换桩上游 / 固定上游模型 / 换工具层，脱离 .env 做全量断言
 */
export function createChatHandler(options) {
  const { model, personaLayer, upstream, upstreamModel, toolkit } = options;

  return async function handleChat(body, deps = {}) {
    // 模型标识一致性（协议 §1）：只服务登记的那个 id，错了要大声失败
    if (body?.model !== model) {
      throw new HttpError(
        400,
        `未知模型：${body?.model ?? "(missing)"}。本端点只服务 ${model}，与 GET /v1/models 一致。`,
      );
    }

    const callUpstream = deps.upstream ?? upstream;
    const tools = deps.toolkit === undefined ? toolkit : deps.toolkit;

    const payload = personaLayer.toUpstreamPayload(
      body,
      deps.upstreamModel ?? upstreamModel,
    );

    // 领域工具并进 tools：模型只看到一份候选清单，选谁由它自己决定
    if (tools?.enabled) {
      payload.tools = [...(payload.tools ?? []), ...tools.definitions];
      payload.tool_choice = payload.tool_choice ?? "auto";
    }

    const messages = payload.messages;
    // NOVA 按响应里的 usage 记账，自执行轮次消耗的 token 必须一起报上去，
    // 否则 Agent 侧的工具循环在成本口径上等于没发生过
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    let localRounds = 0;

    for (;;) {
      // 轮次用尽：剥掉工具再问一次，强制收口成文本，杜绝无限循环。
      // 判断放在请求之前，省掉一次注定要被丢弃的探测调用。
      if (tools?.enabled && localRounds >= tools.maxRounds) {
        const forced = await forward(messages, { withoutTools: true });
        return withUsage(stripLocalCalls(forced, tools.names), usage);
      }

      const completion = await forward(messages);
      const message = completion.choices[0].message;
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const localCalls = calls.filter((call) =>
        tools?.names?.has(call?.function?.name),
      );
      const forwardedCalls = calls.filter(
        (call) => !tools?.names?.has(call?.function?.name),
      );

      // 没有属于本 Agent 的工具要执行：原样交给调用方
      // （要么是纯文本结论，要么是 NOVA 自己的工具调用）
      if (localCalls.length === 0) return withUsage(completion, usage);

      localRounds += 1;

      // 自执行的领域工具：把模型这一轮请求的本地工具记进对话，
      // 逐个真实执行后以 role=tool 回灌，下一轮由模型自己消化
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: localCalls,
      });

      const notes = [];
      for (const call of localCalls) {
        const name = call?.function?.name ?? "";
        const args = parseToolArgs(call?.function?.arguments);
        const outcome = await (tools?.run
          ? tools.run(name, args)
          : Promise.resolve({
              ok: false,
              content: `错误：未知工具 ${name}。`,
            }));

        messages.push({
          role: "tool",
          tool_call_id: call?.id ?? "",
          content: outcome.content,
        });

        console.log(
          `领域工具 · ${name}(${JSON.stringify(args).slice(0, 80)}) · ${outcome.ok ? `${outcome.records} 条` : "失败"}`,
        );
        notes.push(describeLocalCall(name, args, outcome));
      }

      // 混合轮：本地工具已经执行完，同一轮里属于 NOVA 的调用原样回传；
      // 本地结果只在 content 里留一份可读摘要，保证下一轮上下文不断档
      if (forwardedCalls.length > 0) {
        return withUsage(
          withForwardedCalls(completion, forwardedCalls, notes),
          usage,
        );
      }
    }

    /** 向上游要一轮结果；usage 统一在这里累计 */
    async function forward(currentMessages, { withoutTools = false } = {}) {
      const raw = await callUpstream({
        ...payload,
        messages: currentMessages,
        ...(withoutTools
          ? { tools: undefined, tool_choice: undefined }
          : { tools: payload.tools, tool_choice: payload.tool_choice }),
      });

      usage.promptTokens += num(raw?.usage?.prompt_tokens);
      usage.completionTokens += num(raw?.usage?.completion_tokens);
      usage.totalTokens += num(raw?.usage?.total_tokens);

      const completion = toClientResponse(raw, model);
      if (!completion) {
        throw new HttpError(
          502,
          "上游模型响应缺少 choices[0].message，无法转发。",
        );
      }
      return completion;
    }
  };
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 把累计 usage 写回待返回的补全体（NOVA 按它记账） */
function withUsage(completion, usage) {
  return {
    ...completion,
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    },
  };
}

/** 混合轮：只把 NOVA 的工具调用交回去，本地结果降级为 content 摘要 */
function withForwardedCalls(completion, forwardedCalls, notes) {
  const message = completion.choices[0].message;

  return {
    ...completion,
    choices: [
      {
        ...completion.choices[0],
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content:
            [message.content, ...notes].filter(Boolean).join("\n\n") || null,
          tool_calls: forwardedCalls,
        },
      },
    ],
  };
}

/** 本地工具调用的可读一行，进 content 供下一轮上下文使用 */
function describeLocalCall(name, args, outcome) {
  const argText = JSON.stringify(args ?? {});
  const head = `已执行本地工具 ${name}(${argText.length > 80 ? `${argText.slice(0, 80)}…` : argText})`;
  return `${head}：${outcome.content.slice(0, 400)}`;
}

/**
 * 收口轮兜底：即使剥掉工具后模型仍塞回本 Agent 的工具调用，也不能把它
 * 转给 NOVA —— NOVA 只认自己那套工具，未知工具会变成一条工具失败记录，
 * 白白算进被测 Agent 的账上。
 */
function stripLocalCalls(completion, names) {
  if (!names || names.size === 0) return completion;

  const message = completion.choices[0].message;
  const kept = (message.tool_calls ?? []).filter(
    (call) => !names.has(call?.function?.name),
  );

  if (kept.length === (message.tool_calls ?? []).length) return completion;

  return {
    ...completion,
    choices: [
      {
        ...completion.choices[0],
        finish_reason: kept.length > 0 ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: message.content ?? null,
          ...(kept.length > 0 ? { tool_calls: kept } : {}),
        },
      },
    ],
  };
}

/**
 * 创建 OpenAI 兼容的 HTTP 服务：GET /v1/models + POST /v1/chat/completions。
 *
 * @param {object} options
 * @param {string} options.model 登记的模型 id（/v1/models 与请求校验都用它）
 * @param {string} options.ownedBy /v1/models 的 owned_by 字段
 * @param {string} options.label 请求日志里的中文标签（如「调研专员」）
 * @param {number} options.maxBodyBytes 请求体大小上限（对话历史整轮回传，覆盖层放宽到 256KB）
 * @param {(body: object) => Promise<object>} options.handleChat createChatHandler 的产物
 */
export function createDomainAgentServer(options) {
  const { model, ownedBy, label, maxBodyBytes, handleChat } = options;

  return createServer((request, response) => {
    const url = request.url ?? "";

    const send = (status, payload) => {
      const text = JSON.stringify(payload);
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
      });
      response.end(text);
    };

    if (request.method === "GET" && url.endsWith("/models")) {
      send(200, {
        object: "list",
        data: [
          {
            id: model,
            object: "model",
            created: Math.floor(Date.now() / 1_000),
            owned_by: ownedBy,
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && url.endsWith("/chat/completions")) {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
        if (Buffer.byteLength(raw) > maxBodyBytes) request.destroy();
      });
      request.on("end", async () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          send(400, { error: { message: "请求体不是合法 JSON" } });
          return;
        }
        const startedAt = Date.now();
        try {
          const completion = await handleChat(body);
          send(200, completion);
          console.log(
            `${label} · ${completion.choices[0].message.tool_calls ? "tool_calls" : "文本"} · ${(Date.now() - startedAt) / 1_000}s`,
          );
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500;
          send(status, {
            error: {
              message: error instanceof Error ? error.message : "未知错误",
            },
          });
        }
      });
      return;
    }

    send(404, { error: { message: `未知路由：${request.method} ${url}` } });
  });
}
