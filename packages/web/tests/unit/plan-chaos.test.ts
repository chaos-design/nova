import { describe, expect, it } from "vitest";
import {
  CHAOS_KINDS,
  type ChaosInjection,
  ceilingOf,
  type EnvironmentId,
  effectiveIntensity,
  faultPenalty,
  scheduleFaults,
} from "@/lib/nova";

/**
 * [V-03] 混沌排布与环境裁剪。
 *
 * 对应 docs/nova-standard.md §2 / §3.1：实际强度 = 设置值 × 环境上限；
 * 同一份配置必须得到同一张故障表，零强度既不能注入也不能扣分。
 */

const ALL_KINDS = CHAOS_KINDS.map((item) => item.kind);

function chaos(
  entries: Partial<Record<ChaosInjection["kind"], number>>,
): ChaosInjection[] {
  return Object.entries(entries).map(([kind, intensity]) => ({
    kind: kind as ChaosInjection["kind"],
    enabled: true,
    intensity: intensity ?? 1,
  }));
}

function slotsOf(
  environment: EnvironmentId,
  injections: ChaosInjection[],
  slots: number,
) {
  return scheduleFaults({ environment, chaos: injections }, slots);
}

describe("[V-03] 混沌排布与环境裁剪", () => {
  it("三类环境的混沌上限分别为 35% / 100% / 70%", () => {
    expect(ceilingOf("deterministic")).toBe(0.35);
    expect(ceilingOf("stochastic")).toBe(1);
    expect(ceilingOf("arena")).toBe(0.7);
  });

  it("未配置或禁用的故障实际强度为 0", () => {
    expect(
      effectiveIntensity({ environment: "stochastic", chaos: [] }, "latency"),
    ).toBe(0);
    expect(
      effectiveIntensity(
        {
          environment: "stochastic",
          chaos: [{ kind: "latency", enabled: false, intensity: 1 }],
        },
        "latency",
      ),
    ).toBe(0);
  });

  it("实际强度被环境上限二次裁剪，且钳在 0 ~ 1", () => {
    const injections = chaos({ latency: 2 });

    expect(
      effectiveIntensity(
        { environment: "deterministic", chaos: injections },
        "latency",
      ),
    ).toBe(0.35);
    expect(
      effectiveIntensity(
        { environment: "arena", chaos: injections },
        "latency",
      ),
    ).toBe(0.7);
    expect(
      effectiveIntensity(
        { environment: "stochastic", chaos: chaos({ latency: -1 }) },
        "latency",
      ),
    ).toBe(0);
  });

  it("零槽位或零强度不排布任何故障", () => {
    expect(slotsOf("stochastic", chaos({ latency: 1 }), 0).size).toBe(0);
    expect(slotsOf("stochastic", chaos({ latency: 1 }), -3).size).toBe(0);
    expect(slotsOf("stochastic", chaos({ latency: 0 }), 8).size).toBe(0);
  });

  it("排布完全确定：同一配置两次得到相同的故障表", () => {
    const injections = chaos({ latency: 0.8, rateLimit: 0.6, toolFailure: 1 });
    const first = slotsOf("stochastic", injections, 12);
    const second = slotsOf("stochastic", injections, 12);

    expect(JSON.stringify([...first])).toBe(JSON.stringify([...second]));
  });

  it("所有槽位落在 [1, slots] 内，不会越界", () => {
    const schedule = slotsOf(
      "stochastic",
      chaos(Object.fromEntries(ALL_KINDS.map((kind) => [kind, 1]))),
      10,
    );

    expect(schedule.size).toBeGreaterThan(0);
    for (const slot of schedule.keys()) {
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(10);
    }
  });

  it("环境上限会降低同一配置的注入密度", () => {
    const injections = chaos({ latency: 1 });
    const countOf = (environment: EnvironmentId) =>
      [...slotsOf(environment, injections, 20).values()].flat().length;

    // 35% 上限下 20 槽位只够 2 次，100% 下有 7 次
    expect(countOf("deterministic")).toBe(2);
    expect(countOf("stochastic")).toBe(7);
  });

  it("槽位极少时多种故障可以落在同一槽位，顺序与定义一致", () => {
    const injections = chaos(
      Object.fromEntries(ALL_KINDS.map((kind) => [kind, 1])),
    );
    const schedule = slotsOf("stochastic", injections, 1);

    expect(schedule.get(1)).toEqual(ALL_KINDS);
  });

  it("故障代价随强度上升、随韧性下降", () => {
    expect(faultPenalty("latency", 0.5, 1)).toBeCloseTo(2.6, 5);
    expect(faultPenalty("latency", 0.5, 0.35)).toBeCloseTo(1.82, 5);
    expect(faultPenalty("latency", 0.5, 1)).toBeGreaterThan(
      faultPenalty("latency", 0.5, 0),
    );
    expect(faultPenalty("latency", 0.9, 1)).toBeLessThan(
      faultPenalty("latency", 0.2, 1),
    );
  });

  it("关闭的故障即使强度为 1 也不进入故障表", () => {
    const schedule = slotsOf(
      "stochastic",
      [{ kind: "latency", enabled: false, intensity: 1 }],
      8,
    );
    expect(schedule.size).toBe(0);
  });
});
