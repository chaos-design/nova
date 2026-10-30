#!/usr/bin/env node

/**
 * NOVA-RESEARCH 入口：调研专员的 OpenAI 兼容人格代理端点。
 *
 * 启动：pnpm run agent:research（等价于 node playground/nova-research/index.mjs）
 *
 * 它不是规则执行体：收到的请求经 persona.md 注入调研人格后，转发给
 * config.yaml agent.llm 指向的真实大模型（.env 的 NOVA_LLM_*），再把
 * 响应整形回协议要求的 OpenAI 形状。工具调用原样透传 —— external_search
 * 与 summarize 由 NOVA 执行器真实代执行。
 *
 * 共享基建（配置引导 / 人格加载 / 上游调用 / HTTP 路由）在
 * @chaos-design/agent-kit；本入口只保留本 Agent 的身份常量与启动日志。
 *
 * 配置来源与 nova-local 相同（后者覆盖前者）：
 *   1. 项目根 config.yaml
 *   2. 本目录 agent.config.yaml（端口 / 模型标识等私有覆盖）
 *   3. 环境变量：进程环境 > 项目根 .env
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapAgent,
  createChatHandler,
  createDomainAgentServer,
  createUpstreamCaller,
  HttpError,
} from "@chaos-design/agent-kit";
import { projectRoot } from "@chaos-design/config";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

const boot = bootstrapAgent({ agentDir: AGENT_DIR });

const MODEL = boot.config.agent.model;
const PORT = boot.config.agent.port;
const HOSTNAME = boot.config.agent.hostname;

const upstream = createUpstreamCaller(boot.upstream);

/** 处理一次 chat/completions；上游可经 deps 注入（测试用） */
export const handleChat = createChatHandler({
  model: MODEL,
  personaLayer: boot.persona,
  upstream,
  upstreamModel: boot.upstream.model,
});

/** 转发一次补全给上游真实大模型；测试经全局 fetch stub 覆盖 */
export const callUpstream = upstream;

export { HttpError };

export function createAgentServer() {
  return createDomainAgentServer({
    model: MODEL,
    ownedBy: "nova-research",
    label: "调研专员",
    maxBodyBytes: boot.config.agent.maxBodyBytes,
    handleChat,
  });
}

// 仅直接执行时监听端口；被测试 import 时不自动启动
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAgentServer().listen(PORT, HOSTNAME, () => {
    console.log(
      `NOVA 调研专员已启动：http://${HOSTNAME}:${PORT}/v1（模型 ${MODEL}）`,
    );
    console.log(
      `配置来源：${boot.sources.map((s) => s.replace(projectRoot(), ".")).join(" · ")}`,
    );
    console.log(
      `人格提示词：persona.md（${boot.persona.prompt.length} 字符，XML 标签分节）`,
    );
    console.log(
      `上游真实大模型：${boot.upstream.model} @ ${boot.upstream.baseUrl}`,
    );
  });
}
