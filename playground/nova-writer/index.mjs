#!/usr/bin/env node

/**
 * nova-writer 入口：文案写手的 OpenAI 兼容人格代理端点。
 *
 * 启动：node playground/nova-writer/index.mjs
 *（或 pnpm --filter @chaos-design/nova-writer start）
 *
 * 与纯人格代理的差别：本 Agent 自带**真实领域工具**（文本体检 / 术语核验，
 * 见 tools.mjs），由 agent-kit 的工具层在返回 NOVA 之前就地执行完，结果只
 * 回灌给上游模型。NOVA 的工具（external_search / summarize）仍原样透传、
 * 由 NOVA 执行器真实代执行 —— 观测与评分口径不受影响。
 *
 * 共享基建（配置引导 / 人格加载 / 上游调用 / 工具层 / HTTP 路由）在
 * @chaos-design/agent-kit；本入口只保留身份常量、工具清单与启动日志。
 * 人格在 persona.md 里改，工具在 tools.mjs 里加，都不动这段接线。
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapAgent,
  createChatHandler,
  createDomainAgentServer,
  createDomainToolkit,
  createUpstreamCaller,
  HttpError,
} from "@chaos-design/agent-kit";
import { projectRoot } from "@chaos-design/config";
import { writerTools } from "./tools.mjs";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

const boot = bootstrapAgent({ agentDir: AGENT_DIR });

const MODEL = boot.config.agent.model;
const PORT = boot.config.agent.port;
const HOSTNAME = boot.config.agent.hostname;

const upstream = createUpstreamCaller(boot.upstream);

/** 领域工具：本地真实统计 + 真实百科核验，Agent 侧自执行 */
export const toolkit = createDomainToolkit({
  tools: writerTools,
  // 正常一轮体检 + 一轮术语核验收口；写作类请求常需要改一版再体检
  maxRounds: 4,
  timeoutMs: 12_000,
});

/** 处理一次 chat/completions；上游与工具层均可经 deps 注入（测试用） */
export const handleChat = createChatHandler({
  model: MODEL,
  personaLayer: boot.persona,
  upstream,
  upstreamModel: boot.upstream.model,
  toolkit,
});

/** 转发一次补全给上游真实大模型；测试经全局 fetch stub 覆盖 */
export const callUpstream = upstream;

export { HttpError };

export function createAgentServer() {
  return createDomainAgentServer({
    model: MODEL,
    ownedBy: "nova-writer",
    label: "文案写手",
    maxBodyBytes: boot.config.agent.maxBodyBytes,
    handleChat,
  });
}

// 仅直接执行时监听端口；被测试 import 时不自动启动
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAgentServer().listen(PORT, HOSTNAME, () => {
    console.log(
      `NOVA 文案写手已启动：http://${HOSTNAME}:${PORT}/v1（模型 ${MODEL}）`,
    );
    console.log(
      `配置来源：${boot.sources.map((s) => s.replace(projectRoot(), ".")).join(" · ")}`,
    );
    console.log(
      `人格提示词：persona.md（${boot.persona.prompt.length} 字符，XML 标签分节）`,
    );
    console.log(
      `领域工具：${writerTools.map((tool) => tool.name).join(" · ")}（Agent 侧真实执行）`,
    );
    console.log(
      `上游真实大模型：${boot.upstream.model} @ ${boot.upstream.baseUrl}`,
    );
  });
}
