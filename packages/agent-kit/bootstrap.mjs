/**
 * 领域 Agent 的启动引导。
 *
 * 配置加载与人格加载的失败都是可预期的常见故障，用户需要的是
 * 一句能照着做的话，而不是一段堆栈 —— 因此所有失败都带可读的
 * 退出理由直接 process.exit(1)，问题在启动时暴露，不带病监听端口。
 *
 * 上游指回自己会形成「人格套娃」：每转发一轮多垫一层人格消息
 * 直到超时，这个错误同样必须在启动时暴露。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentConfig } from "@chaos-design/config";
import {
  createPersonaLayer,
  findTagIssues,
  PERSONA_MAX_CHARS,
} from "./persona.mjs";

/**
 * 引导一个领域 Agent：配置加载 → 人格加载 → 上游解析。
 *
 * @param {{ agentDir: string }} options agentDir 为入口所在目录
 *   （agent.config.yaml 与 persona.md 都在这里）
 * @returns {{
 *   config: object, sources: string[],
 *   persona: { prompt: string, toUpstreamPayload: Function },
 *   upstream: { baseUrl: string, model: string, apiKey: string, timeoutMs: number },
 * }}
 *   config 为深合并后的最终配置；upstream 是 .env 的 NOVA_LLM_* 解析结果
 */
export function bootstrapAgent(options) {
  const { agentDir } = options;

  let loaded;
  try {
    loaded = getAgentConfig(agentDir);
  } catch (error) {
    exit(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `  提示：请在项目根目录运行（NOVA_ROOT 可指定根目录），并确认 config.yaml 存在。`,
    );
  }

  const { value: config, missing, sources } = loaded;

  if (missing.length > 0) {
    exit(
      `配置缺少必填环境变量：${missing.join("、")}\n` +
        `  提示：cp .env.example .env 后填写这些变量，或在运行环境中导出它们。`,
    );
  }

  const persona = loadPersona(agentDir);

  // 上游真实大模型：与控制台读的是同一段 agent.llm 配置，
  // 因此换端点 / 换模型永远只动 .env，不改任何代码
  const upstream = {
    baseUrl: String(config.agent.llm.baseUrl).replace(/\/+$/, ""),
    model: config.agent.llm.model,
    apiKey: config.agent.llm.apiKey || "",
    // 留 2s 余量：上游僵住时先把可读错误回给 NOVA，别让调用方的超时先到
    timeoutMs: Math.max(5_000, config.agent.llm.timeoutMs - 2_000),
  };

  // 把上游指到自己会形成自转发循环，启动时直接拒绝
  try {
    if (Number(new URL(upstream.baseUrl).port) === config.agent.port) {
      exit(
        `上游端点 ${upstream.baseUrl} 与本服务端口相同，会形成自转发循环。\n` +
          `  提示：把 .env 的 NOVA_LLM_BASE_URL 指向真实模型服务，而不是本 Agent。`,
      );
    }
  } catch {
    // baseUrl 不是合法 URL：交给第一次请求时的连接错误去暴露
  }

  return { config, sources, persona, upstream };
}

/** 加载并校验 persona.md；问题必须在启动时暴露，缺一条都会让请求带着残缺人格出门 */
function loadPersona(agentDir) {
  const file = join(agentDir, "persona.md");

  let text;
  try {
    text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    exit(
      `缺少人格提示词文件：${file}\n` +
        `  提示：persona.md 与入口脚本同目录，用 XML 标签分节写这个 Agent 的领域人格。`,
    );
  }

  const prompt = text.trim();
  if (prompt.length === 0) {
    exit(`人格提示词是空的：${file}`);
  }

  if (prompt.length > PERSONA_MAX_CHARS) {
    exit(
      `人格提示词超过 ${PERSONA_MAX_CHARS} 字符（当前 ${prompt.length}）：${file}\n` +
        `  提示：人格随每轮请求整段发送，请精简后再启动。`,
    );
  }

  const issues = findTagIssues(prompt);
  if (issues.length > 0) {
    exit(
      `persona.md 的 XML 标签存在结构问题：\n  - ${issues.join("\n  - ")}\n` +
        `  提示：每个 <tag> 都需要配对的 </tag>，标签名只允许字母、数字与连字符。`,
    );
  }

  return createPersonaLayer(prompt);
}

function exit(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
