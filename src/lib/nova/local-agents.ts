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

/**
 * 已登记的本地 Agent。
 *
 * 默认留空：`local-agents.example.ts` 里有可直接粘贴的模板。
 * 有真实接入需求时在这里追加即可，注册表会自动多出一张本地档案卡。
 */
export const LOCAL_AGENTS: readonly LocalAgentEntry[] = [];

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
