import { CHAOS_KINDS, DEFAULT_SYSTEM_PROMPT, ENVIRONMENTS } from "./constants";
import type {
  ChaosInjection,
  ChaosKind,
  SimulationConfig,
  SimulationLogLevel,
} from "./types";

/**
 * 沙盒配置与事件类型。
 *
 * 这里只保留「配置」与「一步观测的形状」两件事：
 * 预生成剧本（曾经据此播放一场编好的执行过程）已随 mock 一并移除，
 * 现在唯一的执行路径是真实执行器 `executors/live.ts`。
 */

/* -------------------------------------------------------------------------- */
/* 类型                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 执行过程中的一步观测。
 *
 * 字段是**观测事实**而不是时序参数：真实执行器在实际事件发生时上报它，
 * 耗时由调用方按真实经过时间填充。
 */
export interface ScriptStep {
  /** 步序号，从 1 开始 */
  step: number;
  /** 所属轮次：一次模型调用 = 一轮；阶段性的开场/收尾步骤为 0 */
  round: number;
  level: SimulationLogLevel;
  actor: "agent" | "sandbox" | "nova";
  /** 主文本 */
  message: string;
  /** 补充明细 */
  detail?: string;
  /** 该步涉及的故障类型 */
  chaos?: ChaosKind;
  /** 该步是否为自我反思 */
  reflection?: boolean;
  /** 执行完该步之后的累计得分 */
  scoreAfter: number;
}

/* -------------------------------------------------------------------------- */
/* 配置                                                                        */
/* -------------------------------------------------------------------------- */

/** 全部混沌项的默认强度 */
const DEFAULT_CHAOS: Record<ChaosKind, ChaosInjection> = {
  latency: { kind: "latency", enabled: false, intensity: 0.6 },
  rateLimit: { kind: "rateLimit", enabled: false, intensity: 0.5 },
  malformedPayload: {
    kind: "malformedPayload",
    enabled: true,
    intensity: 0.45,
  },
  promptInjection: { kind: "promptInjection", enabled: false, intensity: 0.7 },
  toolFailure: { kind: "toolFailure", enabled: false, intensity: 0.5 },
};

/** 沙盒默认配置：默认瞄准仓库自带的本地执行体 */
export const DEFAULT_SANDBOX_CONFIG: SimulationConfig = {
  agentId: "agt-local-nova",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  environment: "stochastic",
  chaos: CHAOS_KINDS.map((item) => DEFAULT_CHAOS[item.kind]),
  maxSteps: 8,
};

/** 由 Agent id 与配置派生一份沙盒配置 */
export function createSandboxConfig(
  agentId: string,
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    ...DEFAULT_SANDBOX_CONFIG,
    agentId,
    chaos: CHAOS_KINDS.map((item) => DEFAULT_CHAOS[item.kind]),
    ...overrides,
  };
}

/** 环境标识 → 中文名 */
export function environmentLabel(id: SimulationConfig["environment"]) {
  return ENVIRONMENTS.find((item) => item.id === id)?.label ?? id;
}
