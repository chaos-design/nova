#!/usr/bin/env node

/**
 * nova-travel 入口：行程规划师的 OpenAI 兼容人格代理端点。
 *
 * 启动：node playground/nova-travel/index.mjs
 *（或 pnpm --filter @chaos-design/nova-travel start）
 *
 * 与纯人格代理的差别：本 Agent 自带**真实领域工具**（地理编码 / 天气 /
 * 汇率，见 tools.mjs），由 agent-kit 的工具层在返回 NOVA 之前就地执行完，
 * 结果只回灌给上游模型。NOVA 的工具（external_search / summarize）仍原样
 * 透传、由 NOVA 执行器真实代执行 —— 观测与评分口径不受影响。
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
import { travelTools } from "./tools.mjs";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

const boot = bootstrapAgent({ agentDir: AGENT_DIR });

const MODEL = boot.config.agent.model;
const PORT = boot.config.agent.port;
const HOSTNAME = boot.config.agent.hostname;

const upstream = createUpstreamCaller(boot.upstream);

/** 领域工具：真实数据源，Agent 侧自执行（不是回传给 NOVA 演一遍） */
export const toolkit = createDomainToolkit({
  tools: travelTools,
  // 地理编码 → 天气 → 汇率 正常两轮内跑完，留一轮余量
  maxRounds: 3,
  // 单个工具调用预算：真实公开接口正常在 1s 内返回
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
    ownedBy: "nova-travel",
    label: "行程规划师",
    maxBodyBytes: boot.config.agent.maxBodyBytes,
    handleChat,
  });
}

// 仅直接执行时监听端口；被测试 import 时不自动启动
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAgentServer().listen(PORT, HOSTNAME, () => {
    console.log(
      `NOVA 行程规划师已启动：http://${HOSTNAME}:${PORT}/v1（模型 ${MODEL}）`,
    );
    console.log(
      `配置来源：${boot.sources.map((s) => s.replace(projectRoot(), ".")).join(" · ")}`,
    );
    console.log(
      `人格提示词：persona.md（${boot.persona.prompt.length} 字符，XML 标签分节）`,
    );
    console.log(
      `领域工具：${travelTools.map((tool) => tool.name).join(" · ")}（Agent 侧真实执行）`,
    );
    console.log(
      `上游真实大模型：${boot.upstream.model} @ ${boot.upstream.baseUrl}`,
    );
  });
}
