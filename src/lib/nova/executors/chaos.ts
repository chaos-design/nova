import { CHAOS_KINDS, ENVIRONMENTS } from "../constants";
import { clamp } from "../format";
import type { ChaosInjection, ChaosKind, SimulationConfig } from "../types";

/**
 * 混沌注入的纯逻辑。
 *
 * 这部分被两个执行器共用：本地仿真按"轮次"排布故障，真实执行器按"工具调用序号"
 * 排布故障。用同一段排布算法，两种模式下的故障密度与代价才是可比的。
 */

/** 各类故障对得分的基准代价（0 ~ 100 标度） */
export const FAULT_COST: Record<ChaosKind, number> = {
  latency: 4,
  rateLimit: 7,
  malformedPayload: 9,
  promptInjection: 14,
  toolFailure: 11,
};

/** 当前环境的混沌强度上限 */
export function ceilingOf(
  environment: SimulationConfig["environment"],
): number {
  return (
    ENVIRONMENTS.find((item) => item.id === environment)?.chaosCeiling ?? 1
  );
}

/** 注入强度经环境上限二次裁剪后的实际值 */
export function effectiveIntensity(
  config: Pick<SimulationConfig, "environment" | "chaos">,
  kind: ChaosKind,
): number {
  const injection = config.chaos.find((item) => item.kind === kind);
  if (!injection?.enabled) return 0;
  return clamp(injection.intensity, 0, 1) * ceilingOf(config.environment);
}

/** 该类故障是否处于启用状态 */
export function isEnabled(
  config: Pick<SimulationConfig, "chaos">,
  kind: ChaosKind,
): boolean {
  return config.chaos.some((item) => item.kind === kind && item.enabled);
}

/** 已启用的混沌项 */
export function enabledKinds(
  config: Pick<SimulationConfig, "chaos">,
): ChaosInjection[] {
  return config.chaos.filter((item) => item.enabled);
}

/**
 * 计算每种故障的注入槽位。
 *
 * 槽位在 `[1, slots]` 上均匀铺开且完全确定：同一份配置永远得到同一张故障表，
 * 因此两种执行器在相同配置下的故障分布是可对照的，也便于复现问题。
 *
 * @param slots 可注入的槽位总数（两个执行器都按「轮次」= 一次模型调用计数）
 * @returns 槽位序号 → 该槽位注入的故障类型列表
 */
export function scheduleFaults(
  config: Pick<SimulationConfig, "environment" | "chaos">,
  slots: number,
): Map<number, ChaosKind[]> {
  const schedule = new Map<number, ChaosKind[]>();
  if (slots <= 0) return schedule;

  for (const injection of enabledKinds(config)) {
    const meta = CHAOS_KINDS.find((item) => item.kind === injection.kind);
    if (!meta) continue;

    const effective = effectiveIntensity(config, injection.kind);
    const occurrences = Math.min(
      Math.max(Math.round((effective * slots) / meta.spacing), 1),
      slots,
    );

    for (let k = 0; k < occurrences; k += 1) {
      const slot = clamp(
        Math.round(((k + 0.5) * slots) / (occurrences + 1)),
        1,
        slots,
      );
      const bucket = schedule.get(slot) ?? [];
      bucket.push(injection.kind);
      schedule.set(slot, bucket);
    }
  }

  return schedule;
}

/**
 * 单次故障的失分代价。
 *
 * 代价随 Agent 韧性下降而上升 —— 这正是韧性系数存在的意义：
 * 同一个 Agent 面对更强的混沌，暴露的短板越明显。
 */
export function faultPenalty(
  kind: ChaosKind,
  resilience: number,
  intensity: number,
): number {
  return FAULT_COST[kind] * (1 - resilience) * (0.7 + intensity * 0.6);
}

/** 混沌类型的中文名，供日志直接引用 */
export function chaosLabel(kind: ChaosKind): string {
  return CHAOS_KINDS.find((item) => item.kind === kind)?.label ?? kind;
}
