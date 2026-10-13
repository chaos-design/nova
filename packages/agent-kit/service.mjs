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
 * 以登记的模型 id 回显。
 *
 * @param {object} options
 * @param {string} options.model 本端点登记的模型 id（协议 §1：只服务这一个 id）
 * @param {{ prompt: string, toUpstreamPayload: Function }} options.personaLayer createPersonaLayer 的产物
 * @param {(payload: object) => Promise<object>} options.upstream createUpstreamCaller 的产物
 * @param {string} options.upstreamModel 上游真实模型 id（生产恒为 agent.llm.model）
 * @returns {(body: object, deps?: { upstream?: Function, upstreamModel?: string }) => Promise<object>}
 *   deps 仅测试注入用：换桩上游 / 固定上游模型，脱离 .env 做全量断言
 */
export function createChatHandler(options) {
  const { model, personaLayer, upstream, upstreamModel } = options;

  return async function handleChat(body, deps = {}) {
    // 模型标识一致性（协议 §1）：只服务登记的那个 id，错了要大声失败
    if (body?.model !== model) {
      throw new HttpError(
        400,
        `未知模型：${body?.model ?? "(missing)"}。本端点只服务 ${model}，与 GET /v1/models 一致。`,
      );
    }

    const callUpstream = deps.upstream ?? upstream;
    const completion = toClientResponse(
      await callUpstream(
        personaLayer.toUpstreamPayload(
          body,
          deps.upstreamModel ?? upstreamModel,
        ),
      ),
      model,
    );

    if (!completion) {
      throw new HttpError(
        502,
        "上游模型响应缺少 choices[0].message，无法转发。",
      );
    }

    return completion;
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
