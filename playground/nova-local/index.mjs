#!/usr/bin/env node
/**
 * NOVA-LOCAL 入口。
 *
 * 启动：npm run agent:local（等价于 node playground/nova-local/index.mjs）
 *
 * 配置来源（后者覆盖前者）：
 *   1. 项目根 config.yaml
 *   2. 本目录 agent.config.yaml（Agent 私有覆盖）
 *   3. 环境变量：进程环境 > 项目根 .env
 *
 * 敏感值与环境相关值全部走 ${VAR} 插值，因此本文件与配置里都不含密钥。
 */

import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentConfig, projectRoot } from "@chaos-design/config";
import {
  buildRefusal,
  decide,
  estimateTokens,
  reconstruct,
  textOf,
} from "./policy.mjs";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * 加载配置。
 *
 * 这里刻意**不让异常往外冒**：配置问题是可预期的常见故障，
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

const { config, sources } = bootstrap();

const PORT = config.agent.port;
const HOSTNAME = config.agent.hostname;
const MODEL = config.agent.model;
const LIMITS = config.agent.limits;
const MAX_BODY_BYTES = config.agent.maxBodyBytes;

/* -------------------------------------------------------------------------- */
/* OpenAI 兼容响应                                                             */
/* -------------------------------------------------------------------------- */

let callSeq = 0;

function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 100_000_007;
  }
  return hash;
}

function nextCallId() {
  callSeq += 1;
  return `call_${callSeq.toString(36)}_${Math.abs(hashString(`${Date.now()}:${callSeq}`)).toString(36)}`;
}

/** 组装一次 chat.completion 响应，usage 按真实文本体积计算 */
function completion({
  messages,
  content,
  toolCalls,
  promptTokens,
  completionTokens,
}) {
  const message = {
    role: "assistant",
    content,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  return {
    id: `chatcmpl-${hashString(`${messages.length}:${content}:${callSeq}`).toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: MODEL,
    choices: [
      {
        index: 0,
        message,
        finish_reason:
          toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/** 处理一次 chat/completions 请求 */
export function handleChat(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const state = reconstruct(messages);
  const decision = decide(state, LIMITS);

  const promptTokens = messages.reduce(
    (acc, message) =>
      acc +
      estimateTokens(textOf(message.content)) +
      estimateTokens(JSON.stringify(message.tool_calls ?? [])),
    0,
  );

  // 首次检出注入时，把拒绝声明作为本轮正文一并输出
  const refusal =
    state.injections.length > 0 && state.summaries === 0
      ? buildRefusal(state.injections[0])
      : null;
  const note = decision.note ?? "";
  const content = [refusal, note].filter(Boolean).join("\n") || null;

  if (decision.kind === "final") {
    const text = decision.text;
    return completion({
      messages,
      content: text,
      toolCalls: [],
      promptTokens,
      completionTokens: estimateTokens(text),
    });
  }

  const toolCall = {
    id: nextCallId(),
    type: "function",
    function: {
      name: decision.name,
      arguments: JSON.stringify(decision.args),
    },
  };

  return completion({
    messages,
    content,
    toolCalls: [toolCall],
    promptTokens,
    completionTokens:
      estimateTokens(content ?? "") +
      estimateTokens(toolCall.function.arguments),
  });
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
            owned_by: "nova-local",
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
      request.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          send(400, { error: { message: "请求体不是合法 JSON" } });
          return;
        }
        send(200, handleChat(body));
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
      `NOVA 本地 Agent 已启动：http://${HOSTNAME}:${PORT}/v1（模型 ${MODEL}）`,
    );
    console.log(
      `配置来源：${sources.map((s) => s.replace(projectRoot(), ".")).join(" · ")}`,
    );
    console.log(
      `预算：轮次 ${LIMITS.roundBudget} · 检索上限 ${LIMITS.maxSearchAttempts} · 独立来源 ${LIMITS.requiredSources}`,
    );
  });
}
