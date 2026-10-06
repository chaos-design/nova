import { DEMO_EPOCH } from "./constants";
import { clamp, formatClock, formatYear, round } from "./format";
import { compositeScore, gradeOf } from "./scoring";
import type {
  AgentProfile,
  CapabilityScore,
  CapabilityVectorId,
  ClusterStat,
  MetricReading,
  TelemetryPoint,
  VerificationRun,
} from "./types";

/* -------------------------------------------------------------------------- */
/* 时间锚点                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 演示数据的时间锚点。
 *
 * 全部 mock 数据都相对该锚点生成，因此页面可以被静态预渲染，
 * 文案在任何时候打开都保持一致（模拟数据不该假装自己是真实时间）。
 */
const EPOCH_MS = new Date(DEMO_EPOCH).getTime();

/** 相对锚点偏移若干分钟，offset 为负表示过去 */
function atOffset(minutes: number): string {
  return new Date(EPOCH_MS + minutes * 60_000).toISOString();
}

/** 确定性伪随机：同一 seed 永远返回同一值（0 ~ 1） */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

/** 相对锚点的 `HH:mm:ss` 标签，复用领域层的北京时间口径 */
function clockAt(minutes: number): string {
  return formatClock(atOffset(minutes));
}

/* -------------------------------------------------------------------------- */
/* 组装工具                                                                    */
/* -------------------------------------------------------------------------- */

/** 单项指标的四元组：指标名 / 实测值 / 单位 / 目标阈值 */
type ReadingSeed = readonly [
  label: string,
  value: number,
  unit: MetricReading["unit"],
  target: number,
];

function vector(
  vector: CapabilityVectorId,
  score: number,
  delta: number,
  readings: readonly ReadingSeed[],
): CapabilityScore {
  return {
    vector,
    score,
    delta,
    readings: readings.map(([label, value, unit, target]) => ({
      label,
      value,
      unit,
      target,
    })),
  };
}

interface AgentSeed {
  id: string;
  name: string;
  codename: string;
  model: string;
  owner: string;
  version: string;
  status: AgentProfile["status"];
  tagline: string;
  registeredMinutesAgo: number;
  lastVerifiedMinutesAgo: number | null;
  scenarios: readonly [passed: number, total: number];
  certificateSeq: number;
  capabilities: readonly CapabilityScore[];
}

/** 派生综合评分、评级与证书，避免手工维护三处重复数字 */
function createAgent(seed: AgentSeed): AgentProfile {
  const composite = compositeScore(seed.capabilities);
  const grade = gradeOf(composite);
  // 发证三条件见 docs/nova-standard.md §5：评级 ≥ B、状态已验证、已完成一次验证
  const issued =
    grade !== "C" &&
    seed.status === "verified" &&
    seed.lastVerifiedMinutesAgo !== null;

  return {
    id: seed.id,
    name: seed.name,
    codename: seed.codename,
    model: seed.model,
    owner: seed.owner,
    version: seed.version,
    status: seed.status,
    registeredAt: atOffset(-seed.registeredMinutesAgo),
    lastVerifiedAt:
      seed.lastVerifiedMinutesAgo === null
        ? null
        : atOffset(-seed.lastVerifiedMinutesAgo),
    scenarios: { passed: seed.scenarios[0], total: seed.scenarios[1] },
    capabilities: seed.capabilities,
    compositeScore: composite,
    grade,
    certificateId: issued
      ? `NOVA-CERT-${formatYear(DEMO_EPOCH)}-${String(seed.certificateSeq).padStart(4, "0")}`
      : null,
    tagline: seed.tagline,
  };
}

/* -------------------------------------------------------------------------- */
/* Agent 档案                                                                  */
/* -------------------------------------------------------------------------- */

const AGENT_SEEDS: readonly AgentSeed[] = [
  {
    id: "agt-orion",
    name: "ORION",
    codename: "巡天者",
    model: "nova-warden-128k",
    owner: "深空智能组",
    version: "v3.4.1",
    status: "verified",
    tagline: "长程规划稳定，可在限流环境下自主退避重规划",
    registeredMinutesAgo: 43_200,
    lastVerifiedMinutesAgo: 26,
    scenarios: [48, 50],
    certificateSeq: 471,
    capabilities: [
      vector("autonomy", 96.4, 1.8, [
        ["目标完成率", 96.8, "%", 95],
        ["平均执行深度", 11.4, "次", 8],
      ]),
      vector("toolUsage", 93.1, 0.9, [
        ["参数准确率", 97.2, "%", 98],
        ["失败恢复率", 91.5, "%", 85],
      ]),
      vector("memory", 94.8, 2.4, [
        ["向量检索相关度", 93.6, "%", 88],
        ["上下文窗口效率", 78.2, "%", 75],
      ]),
      vector("reasoning", 92.7, 1.2, [
        ["平均反思轮次", 3.4, "次", 4],
        ["逻辑一致性", 96.1, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-quasar",
    name: "QUASAR",
    codename: "类星体",
    model: "nova-arbiter-pro",
    owner: "仲裁与协商组",
    version: "v2.1.0",
    status: "testing",
    tagline: "多智能体仲裁能力突出，正承受竞技场高强度对攻",
    registeredMinutesAgo: 21_600,
    lastVerifiedMinutesAgo: 4,
    scenarios: [41, 50],
    certificateSeq: 468,
    capabilities: [
      vector("autonomy", 90.2, 3.1, [
        ["目标完成率", 91.4, "%", 95],
        ["平均执行深度", 12.8, "次", 8],
      ]),
      vector("toolUsage", 92.6, -0.4, [
        ["参数准确率", 96.1, "%", 98],
        ["失败恢复率", 88.3, "%", 85],
      ]),
      vector("memory", 91.7, 1.5, [
        ["向量检索相关度", 92.2, "%", 88],
        ["上下文窗口效率", 74.9, "%", 75],
      ]),
      vector("reasoning", 95.3, 2.7, [
        ["平均反思轮次", 4.1, "次", 4],
        ["逻辑一致性", 97.4, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-lyra",
    name: "LYRA",
    codename: "织女",
    model: "nova-arbiter-pro",
    owner: "深空智能组",
    version: "v4.0.2",
    status: "verified",
    tagline: "推理链最长的实验体，反思轮次与一致性双高",
    registeredMinutesAgo: 86_400,
    lastVerifiedMinutesAgo: 63,
    scenarios: [46, 50],
    certificateSeq: 465,
    capabilities: [
      vector("autonomy", 88.5, 0.6, [
        ["目标完成率", 89.7, "%", 95],
        ["平均执行深度", 10.2, "次", 8],
      ]),
      vector("toolUsage", 89.8, 1.1, [
        ["参数准确率", 95.3, "%", 98],
        ["失败恢复率", 86.2, "%", 85],
      ]),
      vector("memory", 90.4, 0.9, [
        ["向量检索相关度", 90.8, "%", 88],
        ["上下文窗口效率", 76.4, "%", 75],
      ]),
      vector("reasoning", 94.6, 2.2, [
        ["平均反思轮次", 4.6, "次", 4],
        ["逻辑一致性", 95.8, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-helix",
    name: "HELIX",
    codename: "螺旋",
    model: "nova-warden-128k",
    owner: "记忆工程组",
    version: "v1.8.3",
    status: "verified",
    tagline: "记忆留存专项优化，长程检索几乎不失真",
    registeredMinutesAgo: 129_600,
    lastVerifiedMinutesAgo: 118,
    scenarios: [43, 50],
    certificateSeq: 461,
    capabilities: [
      vector("autonomy", 85.1, 2.8, [
        ["目标完成率", 86.3, "%", 95],
        ["平均执行深度", 9.6, "次", 8],
      ]),
      vector("toolUsage", 87.4, 1.3, [
        ["参数准确率", 94.1, "%", 98],
        ["失败恢复率", 83.9, "%", 85],
      ]),
      vector("memory", 96.9, 3.6, [
        ["向量检索相关度", 97.5, "%", 88],
        ["上下文窗口效率", 88.2, "%", 75],
      ]),
      vector("reasoning", 84.8, -1.2, [
        ["平均反思轮次", 3.1, "次", 4],
        ["逻辑一致性", 91.2, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-atlas",
    name: "ATLAS",
    codename: "擎天",
    model: "atlas-pro-1",
    owner: "外部接入组",
    version: "v5.2.1",
    status: "testing",
    tagline: "通用旗舰模型，工具精度高但自纠错偏慢",
    registeredMinutesAgo: 15_120,
    lastVerifiedMinutesAgo: 9,
    scenarios: [37, 50],
    certificateSeq: 0,
    capabilities: [
      vector("autonomy", 83.2, -2.4, [
        ["目标完成率", 84.1, "%", 95],
        ["平均执行深度", 8.6, "次", 8],
      ]),
      vector("toolUsage", 91.3, 0.8, [
        ["参数准确率", 98.4, "%", 98],
        ["失败恢复率", 82.6, "%", 85],
      ]),
      vector("memory", 78.9, -0.6, [
        ["向量检索相关度", 83.7, "%", 88],
        ["上下文窗口效率", 68.1, "%", 75],
      ]),
      vector("reasoning", 80.4, 1.1, [
        ["平均反思轮次", 2.2, "次", 4],
        ["逻辑一致性", 88.9, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-vega",
    name: "VEGA",
    codename: "天津四",
    model: "nova-scout-32k",
    owner: "轻量部署组",
    version: "v2.9.0",
    status: "verified",
    tagline: "小体量高可靠，边界逻辑判定严格不妥协",
    registeredMinutesAgo: 57_600,
    lastVerifiedMinutesAgo: 205,
    scenarios: [38, 50],
    certificateSeq: 452,
    capabilities: [
      vector("autonomy", 79.6, 0.4, [
        ["目标完成率", 80.3, "%", 95],
        ["平均执行深度", 7.4, "次", 8],
      ]),
      vector("toolUsage", 81.2, 1.9, [
        ["参数准确率", 92.8, "%", 98],
        ["失败恢复率", 76.4, "%", 85],
      ]),
      vector("memory", 74.3, -1.1, [
        ["向量检索相关度", 79.6, "%", 88],
        ["上下文窗口效率", 64.8, "%", 75],
      ]),
      vector("reasoning", 77.9, 0.8, [
        ["平均反思轮次", 2.8, "次", 4],
        ["逻辑一致性", 85.2, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-pulsar",
    name: "PULSAR",
    codename: "脉冲星",
    model: "nova-scout-32k",
    owner: "外部接入组",
    version: "v0.9.7",
    status: "queued",
    tagline: "新接入候选，尚未完成静态提示词校验",
    registeredMinutesAgo: 320,
    lastVerifiedMinutesAgo: null,
    scenarios: [0, 50],
    certificateSeq: 0,
    capabilities: [
      vector("autonomy", 74.2, 0, [
        ["目标完成率", 0, "%", 95],
        ["平均执行深度", 0, "次", 8],
      ]),
      vector("toolUsage", 72.8, 0, [
        ["参数准确率", 0, "%", 98],
        ["失败恢复率", 0, "%", 85],
      ]),
      vector("memory", 70.5, 0, [
        ["向量检索相关度", 0, "%", 88],
        ["上下文窗口效率", 0, "%", 75],
      ]),
      vector("reasoning", 75.1, 0, [
        ["平均反思轮次", 0, "次", 4],
        ["逻辑一致性", 0, "%", 92],
      ]),
    ],
  },
  {
    id: "agt-nocta",
    name: "NOCTA",
    codename: "南极",
    model: "orion-mini-8k",
    owner: "边缘部署组",
    version: "v1.3.4",
    status: "regression",
    tagline: "8K 上下文压测下出现注入服从倾向，回归观察中",
    registeredMinutesAgo: 172_800,
    lastVerifiedMinutesAgo: 42,
    scenarios: [29, 50],
    certificateSeq: 438,
    capabilities: [
      vector("autonomy", 71.6, -6.2, [
        ["目标完成率", 69.8, "%", 95],
        ["平均执行深度", 6.1, "次", 8],
      ]),
      vector("toolUsage", 66.4, -4.8, [
        ["参数准确率", 88.2, "%", 98],
        ["失败恢复率", 58.9, "%", 85],
      ]),
      vector("memory", 62.8, -5.1, [
        ["向量检索相关度", 71.4, "%", 88],
        ["上下文窗口效率", 42.3, "%", 75],
      ]),
      vector("reasoning", 68.9, -3.7, [
        ["平均反思轮次", 1.4, "次", 4],
        ["逻辑一致性", 76.5, "%", 92],
      ]),
    ],
  },
];

/** 全部 Agent 档案（注册表数据源） */
export const AGENTS: readonly AgentProfile[] = AGENT_SEEDS.map(createAgent);

/** 按综合评分降序的 Agent 列表（排行榜数据源） */
export const AGENTS_BY_SCORE: readonly AgentProfile[] = [...AGENTS].sort(
  (a, b) => b.compositeScore - a.compositeScore,
);

/** 指定 id 的 Agent，找不到时抛错（mock 层用强约束换取简洁） */
export function agentById(id: string): AgentProfile {
  const found = AGENTS.find((agent) => agent.id === id);
  if (!found) throw new Error(`未注册的 Agent: ${id}`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* 验证运行记录                                                                */
/* -------------------------------------------------------------------------- */

/** 最近的验证运行记录 */
export const VERIFICATION_RUNS: readonly VerificationRun[] = [
  {
    id: "run-0341",
    agentId: "agt-quasar",
    environment: "arena",
    startedAt: atOffset(-11),
    finishedAt: null,
    currentStage: "execution",
    stages: [
      {
        stage: "ingestion",
        state: "passed",
        durationMs: 412,
        summary: "档案完整，模型版本已锁定",
      },
      {
        stage: "lint",
        state: "passed",
        durationMs: 1_284,
        summary: "发现 1 条软性越权指令，已标注",
      },
      {
        stage: "execution",
        state: "running",
        durationMs: 8_640,
        summary: "正在竞技场第 41/50 个场景",
      },
      {
        stage: "burst",
        state: "pending",
        durationMs: 0,
        summary: "等待执行阶段收敛",
      },
      {
        stage: "certificate",
        state: "pending",
        durationMs: 0,
        summary: "尚未签发",
      },
    ],
    compositeScore: 91.7,
    notes: "协商轮次偏多，信息交换成本上升",
  },
  {
    id: "run-0340",
    agentId: "agt-orion",
    environment: "stochastic",
    startedAt: atOffset(-26),
    finishedAt: atOffset(-24),
    currentStage: "certificate",
    stages: [
      {
        stage: "ingestion",
        state: "passed",
        durationMs: 388,
        summary: "档案完整",
      },
      {
        stage: "lint",
        state: "passed",
        durationMs: 1_102,
        summary: "未检出注入风险",
      },
      {
        stage: "execution",
        state: "passed",
        durationMs: 102_400,
        summary: "50/50 场景通过，含 7 次混沌注入",
      },
      {
        stage: "burst",
        state: "passed",
        durationMs: 940,
        summary: "综合评分 94.2，评级 S",
      },
      {
        stage: "certificate",
        state: "passed",
        durationMs: 210,
        summary: "证书 NOVA-CERT-2026-0471 已签发",
      },
    ],
    compositeScore: 94.2,
    notes: "限流退避策略表现稳定",
  },
  {
    id: "run-0339",
    agentId: "agt-nocta",
    environment: "stochastic",
    startedAt: atOffset(-42),
    finishedAt: atOffset(-37),
    currentStage: "burst",
    stages: [
      {
        stage: "ingestion",
        state: "passed",
        durationMs: 356,
        summary: "档案完整",
      },
      {
        stage: "lint",
        state: "failed",
        durationMs: 2_310,
        summary: "检出 2 条可执行注入指令",
      },
      {
        stage: "execution",
        state: "passed",
        durationMs: 268_000,
        summary: "29/50 场景通过，注入服从 3 次",
      },
      {
        stage: "burst",
        state: "running",
        durationMs: 720,
        summary: "综合评分下调至 68.9",
      },
      {
        stage: "certificate",
        state: "pending",
        durationMs: 0,
        summary: "回归期内暂停签发",
      },
    ],
    compositeScore: 68.9,
    notes: "工具失败恢复率跌破阈值，标记回归",
  },
  {
    id: "run-0338",
    agentId: "agt-lyra",
    environment: "deterministic",
    startedAt: atOffset(-63),
    finishedAt: atOffset(-58),
    currentStage: "certificate",
    stages: [
      {
        stage: "ingestion",
        state: "passed",
        durationMs: 401,
        summary: "档案完整",
      },
      {
        stage: "lint",
        state: "passed",
        durationMs: 988,
        summary: "提示词结构规范",
      },
      {
        stage: "execution",
        state: "passed",
        durationMs: 244_800,
        summary: "46/50 场景通过",
      },
      {
        stage: "burst",
        state: "passed",
        durationMs: 880,
        summary: "综合评分 89.1，评级 A",
      },
      {
        stage: "certificate",
        state: "passed",
        durationMs: 196,
        summary: "证书已续期",
      },
    ],
    compositeScore: 89.1,
    notes: "反思轮次偏高，注意推理时延",
  },
  {
    id: "run-0337",
    agentId: "agt-helix",
    environment: "stochastic",
    startedAt: atOffset(-118),
    finishedAt: atOffset(-111),
    currentStage: "certificate",
    stages: [
      {
        stage: "ingestion",
        state: "passed",
        durationMs: 377,
        summary: "档案完整",
      },
      {
        stage: "lint",
        state: "passed",
        durationMs: 1_046,
        summary: "未检出注入风险",
      },
      {
        stage: "execution",
        state: "passed",
        durationMs: 331_600,
        summary: "43/50 场景通过",
      },
      {
        stage: "burst",
        state: "passed",
        durationMs: 912,
        summary: "综合评分 88.6，评级 A",
      },
      {
        stage: "certificate",
        state: "passed",
        durationMs: 188,
        summary: "证书已签发",
      },
    ],
    compositeScore: 88.6,
    notes: "记忆向量显著领先，推理向量轻微回落",
  },
  {
    id: "run-0336",
    agentId: "agt-pulsar",
    environment: "deterministic",
    startedAt: atOffset(-6),
    finishedAt: null,
    currentStage: "ingestion",
    stages: [
      {
        stage: "ingestion",
        state: "running",
        durationMs: 210,
        summary: "正在校验模型与版本元信息",
      },
      { stage: "lint", state: "pending", durationMs: 0, summary: "等待中" },
      {
        stage: "execution",
        state: "pending",
        durationMs: 0,
        summary: "等待中",
      },
      { stage: "burst", state: "pending", durationMs: 0, summary: "等待中" },
      {
        stage: "certificate",
        state: "pending",
        durationMs: 0,
        summary: "等待中",
      },
    ],
    compositeScore: 0,
    notes: "新接入候选，排队第 1 位",
  },
];

/* -------------------------------------------------------------------------- */
/* 遥测                                                                        */
/* -------------------------------------------------------------------------- */

/** 首屏遥测采样点数量 */
export const TELEMETRY_SAMPLE_COUNT = 40;

/** 相邻采样点的时间间隔（分钟） */
const TELEMETRY_STEP_MINUTES = 0.5;

/**
 * 第 `index` 个采样点的指标值。
 *
 * 完全由序号决定（三角函数 + 确定性伪随机），不依赖随机数与墙钟，
 * 因此首屏（服务端预渲染）与后续推演（客户端）的曲线完全连续一致。
 */
export function telemetryPointAt(index: number): TelemetryPoint {
  const minutes =
    (index - (TELEMETRY_SAMPLE_COUNT - 1)) * TELEMETRY_STEP_MINUTES;

  return {
    t: clockAt(minutes),
    successRate: round(
      clamp(
        92.4 + Math.sin(index / 4) * 2.6 + (noise(index) - 0.5) * 2.4,
        82,
        99.5,
      ),
      1,
    ),
    latencyMs: Math.round(
      clamp(
        620 + Math.sin(index / 6) * 95 + (noise(index + 7) - 0.5) * 180,
        320,
        2_400,
      ),
    ),
    memoryUtilization: round(
      clamp(
        56 + Math.sin(index / 17) * 13 + (noise(index + 29) - 0.5) * 7,
        30,
        96,
      ),
      1,
    ),
    throughputTps: Math.round(
      clamp(
        1_420 + Math.cos(index / 4.5) * 128 + (noise(index + 13) - 0.5) * 140,
        600,
        2_600,
      ),
    ),
  };
}

/** 首屏遥测种子，由服务端传入客户端以避免 hydration 不一致 */
export const TELEMETRY_SEED: readonly TelemetryPoint[] = Array.from(
  { length: TELEMETRY_SAMPLE_COUNT },
  (_, index) => telemetryPointAt(index),
);

/** 集群运营概览 */
export const CLUSTER_STATS: readonly ClusterStat[] = [
  {
    id: "activeVerifications",
    label: "进行中验证",
    value: 12,
    unit: "项",
    delta: 3,
    accent: "cyan",
  },
  {
    id: "queuedRuns",
    label: "排队运行",
    value: 7,
    unit: "项",
    delta: -2,
    accent: "violet",
  },
  {
    id: "certificatesIssued",
    label: "累计发证",
    value: 148,
    unit: "张",
    delta: 12,
    accent: "fuchsia",
  },
  {
    id: "chaosIncidents",
    label: "混沌事件",
    value: 37,
    unit: "次",
    delta: -9,
    accent: "sky",
  },
];
