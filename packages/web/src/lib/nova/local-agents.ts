import { CAPABILITY_VECTOR_IDS } from "./constants";
import { compositeScore, gradeOf } from "./scoring";
import type { AgentProfile, CapabilityScore, MetricReading } from "./types";

/**
 * 本地 Agent 注册点。
 *
 * NOVA 没有预置档案：要在这里登记一个真实可达的 Agent，它才会出现在
 * 注册表里，跑完一次沙盒验证后才会产生评分并进入排行榜。
 *
 * 两个入口在这里汇合：
 *
 * 1. `LOCAL_AGENTS` —— 把 Agent 写进这个数组。这是**档案登记**，
 *    需要改代码、随仓库走、便于 code review。
 * 2. `apiKeyEnv` 指向的环境变量 —— 密钥的**变量名**（不是值）随登记进版本库，
 *    值只存在于服务端的 `.env.local`。
 *
 * 刻意不做的事：不给未验证的 Agent 编造能力向量得分。没跑过就是没分数，
 * 界面显示"待验证"，而不是一个假的 0 分。
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

/**
 * e2e 专用登记（仅 `NOVA_E2E=1` 进程内存在，正常启动恒为空）。
 *
 * scripts/e2e.mjs 要走通「探测 → 沙盒 → 落库 → 页面」全链路，需要一个
 * 登记在案且**离线可跑**的 Agent，而 nova-local 是规则执行体、不满足
 * 「只收真实大模型端点」的登记口径。环境变量门控让两者兼容：端到端
 * 验证自己拉起的控制台带上 NOVA_E2E=1，它才出现在登记表里；用户自起
 * 的 dev server 与生产构建永远看不到这条档案。
 */
const E2E_AGENTS: readonly LocalAgentEntry[] =
  process.env.NOVA_E2E === "1"
    ? [
        {
          id: "agt-local-nova",
          name: "NOVA-LOCAL",
          codename: "离线执行体",
          model: "nova-local-agent",
          owner: "e2e",
          version: "v0.1.0",
          endpoint: "http://127.0.0.1:43110/v1",
          // nova-local 无鉴权：变量名仅满足登记结构，执行器读不到值就不带 Authorization
          apiKeyEnv: "LLM_API_KEY",
          tagline:
            "离线规则执行体（仅 NOVA_E2E=1 进程可见）：端到端验证的确定性被测对象，不是真实大模型端点",
          registeredAt: "2026-10-10T00:00:00.000Z",
        },
      ]
    : [];

/**
 * 已登记的本地 Agent。
 *
 * 这是 NOVA 唯一的数据来源：界面上的档案、评分、榜单全部由这里登记的
 * Agent 真实跑出来的运行记录派生，没有任何预置档案。
 *
 * 登记口径（不可放宽）：只收**真实端点的真实 Agent** —— 回复出自真实大模型，
 * 且带自己的领域工具与职责边界。两类东西刻意不登记：
 *
 * 1. 裸模型端点：直接把上游大模型挂上来充数，没有领域人格、没有工具、
 *    没有可判定的职责边界，跑出来的分数说明不了任何事；
 * 2. 规则执行体（`playground/nova-local`）：回复不出自大模型，
 *    只在 `NOVA_E2E=1` 的端到端验证进程里临时登记（见下方 E2E_AGENTS）。
 *
 * 自己接入时在这里追加一条登记即可，完整步骤见 `docs/local-agent.md`。
 */
export const LOCAL_AGENTS: readonly LocalAgentEntry[] = [
  {
    // 领域专家 Agent（playground/nova-travel）：本地人格代理服务，转发到
    // agent.llm 指向的真实大模型并注入行程规划人格。除人格外，它自带
    // **真实领域工具**（Open-Meteo 地理编码 / 天气预报、Frankfurter 汇率），
    // 在 Agent 侧就地执行后回灌给上游模型 —— 结论里的坐标、天气、汇率
    // 都是真实抓到的，不是编的。
    id: "agt-local-travel",
    name: "NOVA-TRAVEL",
    codename: "行程规划师",
    model: "nova-travel-agent",
    owner: "本地开发",
    version: "v0.1.0",
    endpoint: "http://127.0.0.1:43113/v1",
    // 本地端点无鉴权：变量名仅满足登记结构，执行器读不到值就不带 Authorization
    apiKeyEnv: "LLM_API_KEY",
    tagline:
      "专职行程规划的领域 Agent：目的地情报、逐日排期、预算与天气风险；自带真实地理编码 / 天气 / 汇率工具（playground/nova-travel）",
    registeredAt: "2026-10-14T00:00:00.000Z",
  },
  {
    // 与行程规划师互补的中文内容创作 Agent（playground/nova-writer）。
    // 自带真实工具：text_stats 现算字数 / 句长 / 结构体检，
    // lookup_term 走中文维基百科核验术语出处。两者职责互斥，
    // Converse Lab 的意图分发因此有可判定的分界。
    id: "agt-local-writer",
    name: "NOVA-WRITER",
    codename: "文案写手",
    model: "nova-writer-agent",
    owner: "本地开发",
    version: "v0.1.0",
    endpoint: "http://127.0.0.1:43114/v1",
    apiKeyEnv: "LLM_API_KEY",
    tagline:
      "专职中文内容创作的领域 Agent：公众号长文 / 小红书笔记 / 标题组与稿件打磨；自带真实文本体检与百科术语核验工具（playground/nova-writer）",
    registeredAt: "2026-10-14T00:00:00.000Z",
  },
  // e2e 门控登记放最后：正常启动展开为空，端到端验证进程才有离线执行体
  ...E2E_AGENTS,
];

/** 按 id 查本地 Agent，找不到返回 undefined（不抛错：登记是可选注入） */
export function localAgentById(id: string): LocalAgentEntry | undefined {
  return LOCAL_AGENTS.find((item) => item.id === id);
}

/**
 * 为沙盒执行派生档案。
 *
 * 执行器（`runLive`）需要一个 `AgentProfile` 才能计算韧性与推理返还。
 * 本地 Agent 在首次验证前没有真实评测读数，因此能力向量取**中性先验**
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
    // 场景通过率由真实运行累计，登记时尚未跑过，如实为 0/0
    scenarios: { passed: 0, total: 0 },
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
