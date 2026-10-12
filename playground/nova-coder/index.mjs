#!/usr/bin/env node

/**
 * NOVA-CODER 入口：工程搭档的 OpenAI 兼容人格代理端点。
 *
 * 启动：pnpm run agent:coder（等价于 node playground/nova-coder/index.mjs）
 *
 * 它不是规则执行体：收到的请求经 persona.mjs 注入调研人格后，转发给
 * config.yaml agent.llm 指向的真实大模型（.env 的 NOVA_LLM_*），再把
 * 响应整形回协议要求的 OpenAI 形状。工具调用原样透传 —— external_search
 * 与 summarize 由 NOVA 执行器真实代执行。
 *
 * 配置来源与 nova-local 相同（后者覆盖前者）：
 *   1. 项目根 config.yaml
 *   2. 本目录 agent.config.yaml（端口 / 模型标识等私有覆盖）
 *   3. 环境变量：进程环境 > 项目根 .env
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentConfig, projectRoot } from "@chaos-design/config";
import {
  createPersonaLayer,
  findTagIssues,
  PERSONA_MAX_CHARS,
  toClientResponse,
} from "./persona.mjs";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

/** 携带 HTTP 状态码的错误：入口按状态码回给调用方，NOVA 侧可读 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * 加载配置。刻意不让异常往外冒：配置问题是可预期的常见故障，
 * 用户需要的是一句能照着做的话，而不是一段堆栈。
 */
function bootstrap() {
  let loaded;
  try {
    loaded = getAgentConfig(AGENT_DIR);
  } catch (error) {
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}\n` +
        `  提示：请在项目根目录运行（NOVA_ROOT 可指定根目录），并确认 config.yaml 存在。`,
    );
    process.exit(1);
  }

  const { value: config, missing, sources } = loaded;

  if (missing.length > 0) {
    console.error(
      `✗ 配置缺少必填环境变量：${missing.join("、")}\n` +
        `  提示：cp .env.example .env 后填写这些变量，或在运行环境中导出它们。`,
    );
    process.exit(1);
  }

  return { config, sources };
}

/**
 * 加载并校验 persona.md。
 *
 * 人格提示词独立成 MD 文件（支持 XML 自定义标签分节），为的是改人格
 * 不动代码。问题必须在启动时暴露：缺文件、空文件、超长、标签没配对，
 * 任何一条都会让每次请求带着残缺人格出门 —— 带着可读的退出理由失败。
 */
function loadPersona() {
  const file = join(AGENT_DIR, "persona.md");

  let text;
  try {
    text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    console.error(
      `✗ 缺少人格提示词文件：${file}\n` +
        `  提示：persona.md 与 index.mjs 同目录，用 XML 标签分节写这个 Agent 的领域人格。`,
    );
    process.exit(1);
  }

  const prompt = text.trim();
  if (prompt.length === 0) {
    console.error(`✗ 人格提示词是空的：${file}`);
    process.exit(1);
  }

  if (prompt.length > PERSONA_MAX_CHARS) {
    console.error(
      `✗ 人格提示词超过 ${PERSONA_MAX_CHARS} 字符（当前 ${prompt.length}）：${file}\n` +
        `  提示：人格随每轮请求整段发送，请精简后再启动。`,
    );
    process.exit(1);
  }

  const issues = findTagIssues(prompt);
  if (issues.length > 0) {
    console.error(
      `✗ persona.md 的 XML 标签存在结构问题：\n  - ${issues.join("\n  - ")}\n` +
        `  提示：每个 <tag> 都需要配对的 </tag>，标签名只允许字母、数字与连字符。`,
    );
    process.exit(1);
  }

  return createPersonaLayer(prompt);
}

const { config, sources } = bootstrap();
const PERSONA = loadPersona();

const PORT = config.agent.port;
const HOSTNAME = config.agent.hostname;
const MODEL = config.agent.model;
const MAX_BODY_BYTES = config.agent.maxBodyBytes;

// 上游真实大模型：与控制台读的是同一段 agent.llm 配置，
// 因此换端点 / 换模型永远只动 .env，不改任何代码
const UPSTREAM_BASE_URL = String(config.agent.llm.baseUrl).replace(/\/+$/, "");
const UPSTREAM_MODEL = config.agent.llm.model;
const UPSTREAM_API_KEY = config.agent.llm.apiKey || "";
// 留 2s 余量：上游僵住时先把可读错误回给 NOVA，别让调用方的超时先到
const UPSTREAM_TIMEOUT_MS = Math.max(5_000, config.agent.llm.timeoutMs - 2_000);

// 把上游指到自己会形成「人格套娃」：每转发一轮多垫一层人格消息直到超时，
// 这个错误必须在启动时暴露，而不是跑到一半才现形
try {
  if (Number(new URL(UPSTREAM_BASE_URL).port) === PORT) {
    console.error(
      `✗ 上游端点 ${UPSTREAM_BASE_URL} 与本服务端口相同，会形成自转发循环。\n` +
        `  提示：把 .env 的 NOVA_LLM_BASE_URL 指向真实模型服务，而不是本 Agent。`,
    );
    process.exit(1);
  }
} catch {
  // baseUrl 不是合法 URL：交给第一次请求时的连接错误去暴露
}

/* -------------------------------------------------------------------------- */
/* 上游调用                                                                    */
/* -------------------------------------------------------------------------- */

/** 转发一次补全给上游真实大模型，返回解析后的 JSON */
export async function callUpstream(payload) {
  let response;
  try {
    response = await fetch(`${UPSTREAM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 上游无鉴权时（如本地 Ollama）不发 Authorization
        ...(UPSTREAM_API_KEY
          ? { Authorization: `Bearer ${UPSTREAM_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new HttpError(
      504,
      timedOut
        ? `上游模型调用超时（${UPSTREAM_TIMEOUT_MS}ms）：${UPSTREAM_MODEL}`
        : `无法连接上游模型端点（${UPSTREAM_BASE_URL}）`,
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
}

/* -------------------------------------------------------------------------- */
/* 请求处理                                                                    */
/* -------------------------------------------------------------------------- */

/** 处理一次 chat/completions 请求；上游可通过 deps.upstream 注入（测试用） */
export async function handleChat(body, deps = {}) {
  // 模型标识一致性（协议 §1）：只服务登记的那个 id，错了要大声失败
  if (body?.model !== MODEL) {
    throw new HttpError(
      400,
      `未知模型：${body?.model ?? "(missing)"}。本端点只服务 ${MODEL}，与 GET /v1/models 一致。`,
    );
  }

  const upstream = deps.upstream ?? callUpstream;
  // 上游模型经 deps 可注入：生产恒跟随配置 agent.llm.model（换端点只动 .env），
  // 测试注入固定值即可脱离 .env 做全量整形断言，CI 无 .env 也不漂移。
  const payload = PERSONA.toUpstreamPayload(
    body,
    deps.upstreamModel ?? UPSTREAM_MODEL,
  );
  const completion = toClientResponse(await upstream(payload), MODEL);

  if (!completion) {
    throw new HttpError(502, "上游模型响应缺少 choices[0].message，无法转发。");
  }

  return completion;
}

/* -------------------------------------------------------------------------- */
/* HTTP 服务                                                                   */
/* -------------------------------------------------------------------------- */

export function createAgentServer() {
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
            id: MODEL,
            object: "model",
            created: Math.floor(Date.now() / 1_000),
            owned_by: "nova-coder",
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && url.endsWith("/chat/completions")) {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) request.destroy();
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
            `工程搭档 · ${completion.choices[0].message.tool_calls ? "tool_calls" : "文本"} · ${(Date.now() - startedAt) / 1_000}s · 上游 ${UPSTREAM_MODEL}`,
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

// 仅直接执行时监听端口；被测试 import 时不自动启动
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAgentServer().listen(PORT, HOSTNAME, () => {
    console.log(
      `NOVA 工程搭档已启动：http://${HOSTNAME}:${PORT}/v1（模型 ${MODEL}）`,
    );
    console.log(
      `配置来源：${sources.map((s) => s.replace(projectRoot(), ".")).join(" · ")}`,
    );
    console.log(
      `人格提示词：persona.md（${PERSONA.prompt.length} 字符，XML 标签分节）`,
    );
    console.log(`上游真实大模型：${UPSTREAM_MODEL} @ ${UPSTREAM_BASE_URL}`);
  });
}
