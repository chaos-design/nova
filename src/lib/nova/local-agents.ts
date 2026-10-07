import { CAPABILITY_VECTOR_IDS } from "./constants";
import { compositeScore, gradeOf } from "./scoring";
import type { AgentProfile, CapabilityScore, MetricReading } from "./types";

/**
 * 本地 Agent 注册点。
 *
 * NOVA 当前是纯前端演示 + 一个真实沙盒执行接口，因此"接入一个本地 Agent"
 * 只有两个可落地的入口，它们都在这里汇合：
 *
 * 1. `LOCAL_AGENTS` —— 把 Agent 写进这个数组，它就会出现在注册表的
 *    「本地接入」分区里。这是**档案登记**，需要改代码、随仓库走、便于 code review。
 * 2. `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` —— 告诉真实执行器去调哪个
 *    OpenAI 兼容端点。这是**运行配置**，只存在于服务端环境变量里，密钥不进仓库。
 *
 * 刻意不做的事：不在运行时把密钥写进档案、不给本地 Agent 编造能力向量得分。
 * 未跑过验证的 Agent 没有评分可言，界面应该显示"待验证"而不是一个假的 0 分。
 */

/** 一条本地 Agent 登记 */
export interface LocalAgentEntry {
  /** 稳定主键，形如 `agt-local-myagent`，需与内置档案不冲突 */
  id: string;
  /** 英文代号 */
  name: string;
  /** 中文代号 */
  codename: string;
  /** 模型标识，与端点上暴露的模型 id 一致 */
  model: string;
  /** 归属（个人 / 团队） */
  owner: string;
  /** 语义化版本号 */
  version: string;
  /** OpenAI 兼容端点，形如 `http://127.0.0.1:11434/v1` */
  endpoint: string;
  /**
   * 存放密钥的环境变量名。
   *
   * 只存变量名不存值：这条记录会进版本库，值必须留在 `.env.local`。
   */
  apiKeyEnv: string;
  /** 一句话说明 */
  tagline: string;
  /** 登记时间（ISO 8601） */
  registeredAt: string;
}

/** 已登记的本地 Agent。
 *
 * 默认留空：`local-agents.example.ts` 里有可直接粘贴的模板。
 * 有真实接入需求时在这里追加即可，注册表会自动多出一张本地档案卡。
 */
export const LOCAL_AGENTS: readonly LocalAgentEntry[] = [
  {
    id: "agt-local-solver",
    name: "SOLVER",
    codename: "本地试验体",
    model: "qwen2.5:14b",
    owner: "本地开发",
    version: "v0.1.0",
    endpoint: "http://127.0.0.1:11434/v1",
    apiKeyEnv: "LLM_API_KEY",
    tagline: "接入试验样例：Ollama 本地部署，跑真实工具调用与混沌注入",
    registeredAt: "2026-10-06T06:00:00.000Z",
  },
];

/** 按 id 查本地 Agent，找不到返回 undefined（不抛错：登记是可选注入） */
export function localAgentById(id: string): LocalAgentEntry | undefined {
  return LOCAL_AGENTS.find((item) => item.id === id);
}

/**
 * 为沙盒执行派生档案。
 *
 * 执行器（`runLive` / `buildSimulationPlan`）需要一个 `AgentProfile` 才能
 * 计算韧性与推理返还。本地 Agent 没有真实评测读数，因此能力向量取**中性先验**
 * （70 分、空读数、delta=0）——它只参与执行中的启发式估计，
 * 不会被当作评测结论展示：本地档案的卡片只显示端点/模型/登记信息。
 */
export function localAgentProfile(entry: LocalAgentEntry): AgentProfile {
  // 全部向量取中性先验 70 分，评级由同一套逻辑派生而不是手填
  const vectors: CapabilityScore[] = CAPABILITY_VECTOR_IDS.map((vectorId) => ({
    vector: vectorId,
    score: 70,
    delta: 0,
    readings: [] as MetricReading[],
  }));
  const composite = compositeScore(vectors);

  return {
    id: entry.id,
    name: entry.name,
    codename: entry.codename,
    model: entry.model,
    owner: entry.owner,
    version: entry.version,
    status: "queued",
    registeredAt: entry.registeredAt,
    lastVerifiedAt: null,
    scenarios: { passed: 0, total: 50 },
    capabilities: vectors,
    compositeScore: composite,
    grade: gradeOf(composite),
    certificateId: null,
    tagline: entry.tagline,
  };
}

/** 端点规范化：去掉末尾斜杠，保证与执行器的拼接方式一致 */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

/** `.env.local` 片段：真实执行器读的就是这三个变量 */
export function localAgentEnvSnippet(entry: LocalAgentEntry): string {
  return [
    `# 本地 Agent ${entry.name} · ${entry.codename}（接入向导生成，粘贴到 .env.local）`,
    `LLM_BASE_URL=${normalizeEndpoint(entry.endpoint)}`,
    "LLM_API_KEY=<把你的密钥写在这里>",
    `LLM_MODEL=${entry.model}`,
    "",
    `# 密钥不写进 src/lib/nova/local-agents.ts；登记侧只引用变量名：`,
    `apiKeyEnv: "${entry.apiKeyEnv}"`,
  ].join("\n");
}

/** `local-agents.ts` 片段：把一条登记写进数组 */
export function localAgentSourceSnippet(entry: LocalAgentEntry): string {
  return [
    "  {",
    `    id: "${entry.id}",`,
    `    name: "${entry.name}",`,
    `    codename: "${entry.codename}",`,
    `    model: "${entry.model}",`,
    `    owner: "${entry.owner}",`,
    `    version: "${entry.version}",`,
    `    endpoint: "${normalizeEndpoint(entry.endpoint)}",`,
    `    apiKeyEnv: "${entry.apiKeyEnv}",`,
    `    tagline: "${entry.tagline}",`,
    `    registeredAt: "${entry.registeredAt}",`,
    "  },",
  ].join("\n");
}
