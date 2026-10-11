/**
 * NOVA 领域模型类型定义。
 *
 * 该文件是全站唯一的类型事实来源（single source of truth）：
 * 页面、服务端数据、客户端组件、模拟引擎全部从此处取型。
 * 任何字段新增都必须同步更新 `constants.ts` 中的静态配置。
 */

/* -------------------------------------------------------------------------- */
/* 能力向量                                                                     */
/* -------------------------------------------------------------------------- */

/** 四大能力向量的稳定标识 */
export type CapabilityVectorId =
  | "autonomy"
  | "toolUsage"
  | "memory"
  | "reasoning";

/** 主题强调色标识，映射到 NOVA 的霓虹色板 */
export type AccentColor =
  | "cyan"
  | "violet"
  | "fuchsia"
  | "sky"
  | "amber"
  | "rose";

/** 能力向量的静态元信息（名称、描述、评测指标、权重） */
export interface CapabilityVectorMeta {
  /** 向量标识 */
  id: CapabilityVectorId;
  /** 中文名称，如「自主性」 */
  label: string;
  /** 英文缩写，用于表格与图表的紧凑展示 */
  abbreviation: string;
  /** 能力描述 */
  description: string;
  /** 该向量下的评测指标（中文） */
  metrics: readonly string[];
  /** 综合评分中的权重，四项之和为 1 */
  weight: number;
  /** 图表与徽章使用的强调色 */
  accent: AccentColor;
}

/** 单项指标的实测值 */
export interface MetricReading {
  /** 指标中文名 */
  label: string;
  /** 实测数值 */
  value: number;
  /** 单位：`%` 百分比、`ms` 毫秒、`次` 次数 */
  unit: "%" | "ms" | "次";
  /** 该指标的目标阈值，用于进度条与达标判定 */
  target: number;
}

/** 单个能力向量的评分结果 */
export interface CapabilityScore {
  /** 所属向量 */
  vector: CapabilityVectorId;
  /** 归一化得分，0 ~ 100 */
  score: number;
  /** 相对上一轮评测的变化量，正数为提升 */
  delta: number;
  /** 子项实测指标 */
  readings: readonly MetricReading[];
}

/** NOVA 综合评级 */
export type NovaGrade = "S" | "A" | "B" | "C";

/* -------------------------------------------------------------------------- */
/* Agent 档案                                                                  */
/* -------------------------------------------------------------------------- */

/** Agent 在验证流水线中的状态 */
export type AgentStatus = "verified" | "testing" | "queued" | "regression";

/** Agent 注册档案 */
export interface AgentProfile {
  /** 稳定主键，形如 `agt-orion` */
  id: string;
  /** 英文代号，用于 UI 展示 */
  name: string;
  /** 中文代号，如「巡天者」 */
  codename: string;
  /** 底层模型标识 */
  model: string;
  /** 归属团队 */
  owner: string;
  /** 语义化版本号 */
  version: string;
  /** 当前状态 */
  status: AgentStatus;
  /** 注册时间（ISO 8601） */
  registeredAt: string;
  /** 最近一次验证完成时间（ISO 8601） */
  lastVerifiedAt: string | null;
  /** 已通过场景数 / 场景总数 */
  scenarios: { passed: number; total: number };
  /** 四大能力向量得分 */
  capabilities: readonly CapabilityScore[];
  /** NOVA 综合评分，0 ~ 100 */
  compositeScore: number;
  /** NOVA 评级 */
  grade: NovaGrade;
  /** 生成的证书编号，未通过评测时为 null */
  certificateId: string | null;
  /** 一句话能力画像 */
  tagline: string;
}

/* -------------------------------------------------------------------------- */
/* 验证生命周期                                                                */
/* -------------------------------------------------------------------------- */

/** 验证流水线的五个阶段 */
export type VerificationStageId =
  | "ingestion"
  | "lint"
  | "execution"
  | "burst"
  | "certificate";

/** 单个阶段的执行结果 */
export interface VerificationStageResult {
  stage: VerificationStageId;
  /** 阶段状态 */
  state: "passed" | "failed" | "running" | "pending";
  /** 耗时（毫秒） */
  durationMs: number;
  /** 阶段简述 */
  summary: string;
}

/** 一次完整验证运行记录 */
export interface VerificationRun {
  /** 运行主键，形如 `run-2026-0341` */
  id: string;
  /** 关联的 Agent */
  agentId: string;
  /** 运行环境 */
  environment: EnvironmentId;
  /** 开始时间（ISO 8601） */
  startedAt: string;
  /** 结束时间（ISO 8601），运行中为 null */
  finishedAt: string | null;
  /** 当前所处阶段 */
  currentStage: VerificationStageId;
  /** 各阶段结果 */
  stages: readonly VerificationStageResult[];
  /** 本次运行的综合评分 */
  compositeScore: number;
  /** 备注 / 异常说明 */
  notes: string;
}

/* -------------------------------------------------------------------------- */
/* 沙盒环境                                                                    */
/* -------------------------------------------------------------------------- */

/** 沙盒环境类型，对应 AGENTS.md 中定义的三类测试环境 */
export type EnvironmentId = "deterministic" | "stochastic" | "arena";

/** 沙盒环境静态元信息 */
export interface EnvironmentMeta {
  id: EnvironmentId;
  label: string;
  description: string;
  /** 建议的混沌注入强度上限（0 ~ 1） */
  chaosCeiling: number;
}

/** 混沌注入类型 */
export type ChaosKind =
  | "latency"
  | "rateLimit"
  | "malformedPayload"
  | "promptInjection"
  | "toolFailure";

/** 单项混沌注入配置 */
export interface ChaosInjection {
  kind: ChaosKind;
  /** 是否启用 */
  enabled: boolean;
  /** 注入强度，0 ~ 1 */
  intensity: number;
}

/** 混沌注入的静态元信息 */
export interface ChaosMeta {
  kind: ChaosKind;
  label: string;
  description: string;
  /** 该类故障在脚本中单次注入的最小间隔步数 */
  spacing: number;
}

/** 沙盒运行配置 */
export interface SimulationConfig {
  /** 目标 Agent */
  agentId: string;
  /** 用户自定义系统提示词 */
  systemPrompt: string;
  /** 运行环境 */
  environment: EnvironmentId;
  /** 混沌注入组合 */
  chaos: readonly ChaosInjection[];
  /** 最大执行步数 */
  maxSteps: number;
}

/** 模拟日志级别 */
export type SimulationLogLevel =
  | "info"
  | "success"
  | "warn"
  | "error"
  | "reflect";

/** 单条模拟日志 */
export interface SimulationLog {
  id: string;
  /** 相对运行开始的偏移（毫秒） */
  atMs: number;
  /** 步序号 */
  step: number;
  level: SimulationLogLevel;
  /** 发言方：`agent` / `sandbox` / `nova` */
  actor: "agent" | "sandbox" | "nova";
  /** 主文本 */
  message: string;
  /** 补充明细（如返回体片段、耗时） */
  detail?: string;
}

/* -------------------------------------------------------------------------- */
/* 遥测                                                                        */
/* -------------------------------------------------------------------------- */

/** 单个遥测采样点 */
export interface TelemetryPoint {
  /** 时间标签 `HH:mm:ss` */
  t: string;
  /** 任务成功率（%） */
  successRate: number;
  /** 平均响应延迟（毫秒） */
  latencyMs: number;
  /** 记忆占用率（%） */
  memoryUtilization: number;
  /** 吞吐（tokens/s） */
  throughputTps: number;
}

/** 一次遥测采样的指标定义 */
export type TelemetryMetricId =
  | "successRate"
  | "latencyMs"
  | "memoryUtilization"
  | "throughputTps";

/** 遥测指标静态元信息 */
export interface TelemetryMetricMeta {
  id: TelemetryMetricId;
  label: string;
  unit: string;
  /** 展示精度 */
  precision: number;
  /** 数值越大越好为 true，越小越好为 false */
  higherIsBetter: boolean;
  accent: AccentColor;
}

/** 集群运营概览指标 */
export type ClusterStatId =
  | "activeVerifications"
  | "queuedRuns"
  | "certificatesIssued"
  | "chaosIncidents";

/** 集群运营概览指标项 */
export interface ClusterStat {
  id: ClusterStatId;
  label: string;
  value: number;
  unit: string;
  /** 环比变化 */
  delta: number;
  accent: AccentColor;
}

/* -------------------------------------------------------------------------- */
/* 模型清单                                                                    */
/* -------------------------------------------------------------------------- */

/** 沙盒可选的底层模型 */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  /** 上下文窗口（token 数） */
  contextWindow: number;
  /** 模型简介 */
  description: string;
}

/* -------------------------------------------------------------------------- */
/* 排行榜与证书                                                                */
/* -------------------------------------------------------------------------- */

/** 排行榜条目（在 AgentProfile 基础上附加排名与趋势） */
export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  codename: string;
  model: string;
  compositeScore: number;
  grade: NovaGrade;
  /** 相较上一轮的排名变化，正数为上升 */
  rankDelta: number;
  scenariosPassed: number;
  scenariosTotal: number;
  /** 四大能力向量的得分，用于表格内联条形图 */
  vectorScores: Record<CapabilityVectorId, number>;
}

/** NOVA 证书 */
export interface NovaCertificate {
  /** 证书编号 */
  id: string;
  agentId: string;
  grade: NovaGrade;
  compositeScore: number;
  /** 颁发时间（ISO 8601） */
  issuedAt: string;
  /** 校验码 */
  checksum: string;
  /** 评定依据的向量得分快照 */
  vectorSnapshot: Record<CapabilityVectorId, number>;
}

/** 可下载的 JSON 报告 */
export interface NovaReport {
  reportVersion: string;
  generatedAt: string;
  generator: string;
  standard: string;
  agent: {
    id: string;
    name: string;
    codename: string;
    model: string;
    version: string;
  };
  verdict: {
    compositeScore: number;
    grade: NovaGrade;
    certificateId: string | null;
  };
  capabilities: {
    vector: CapabilityVectorId;
    label: string;
    weight: number;
    score: number;
    readings: readonly MetricReading[];
  }[];
  lifecycle: readonly {
    stage: VerificationStageId;
    state: VerificationStageResult["state"];
    durationMs: number;
    summary: string;
  }[];
}
