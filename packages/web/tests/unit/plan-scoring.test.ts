import { describe, expect, it } from "vitest";
import {
  type AgentProfile,
  attainmentScore,
  averageCapabilities,
  buildLeaderboard,
  type CapabilityScore,
  compositeScore,
  gradeOf,
  resilienceFactor,
  scoreGapToNextGrade,
  vectorScoreMap,
} from "@/lib/nova";

/**
 * [V-01] 评分与等级派生。
 *
 * 对应 docs/nova-standard.md §1.2 / §1.3：阈值、归一化与派生都不允许出现
 * 「文档一个数、代码另一个数」。这里专测边界与缺失项，既有 scoring.test.ts
 * 继续承担主路径基线。
 */

function capability(
  vector: CapabilityScore["vector"],
  score: number,
  readings: CapabilityScore["readings"] = [],
): CapabilityScore {
  return { vector, score, delta: 0, readings };
}

function profile(
  id: string,
  score: number,
  capabilities: CapabilityScore[],
): AgentProfile {
  return {
    id,
    name: id.toUpperCase(),
    codename: id,
    model: "stub-model",
    owner: "验证",
    version: "v0.0.0",
    status: "verified",
    registeredAt: "2026-10-30T00:00:00.000Z",
    lastVerifiedAt: "2026-10-30T00:00:00.000Z",
    scenarios: { passed: 1, total: 1 },
    capabilities,
    compositeScore: score,
    grade: gradeOf(score),
    certificateId: null,
    tagline: "",
  };
}

describe("[V-01] 评分与等级派生", () => {
  it("达标分在三档边界上取到精确值", () => {
    expect(attainmentScore(1)).toBe(100);
    expect(attainmentScore(1.5)).toBe(100);
    expect(attainmentScore(0.8)).toBe(80);
    expect(attainmentScore(0)).toBe(0);
  });

  it("0.8 以下与 0.8 以上各自线性插值", () => {
    expect(attainmentScore(0.9)).toBe(90);
    expect(attainmentScore(0.95)).toBe(95);
    expect(attainmentScore(0.4)).toBe(40);
  });

  it("非法达标比例归零而不是产生 NaN", () => {
    expect(attainmentScore(Number.NaN)).toBe(0);
    expect(attainmentScore(-1)).toBe(0);
    // 无穷不是合法达标比例：按非法输入归零，而不是当成满分
    expect(attainmentScore(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("评级阈值的上下沿严格按 92 / 85 / 72 分档", () => {
    expect(gradeOf(92)).toBe("S");
    expect(gradeOf(91.9)).toBe("A");
    expect(gradeOf(85)).toBe("A");
    expect(gradeOf(84.9)).toBe("B");
    expect(gradeOf(72)).toBe("B");
    expect(gradeOf(71.9)).toBe("C");
  });

  it("非法分数落到 C 档，不抛错", () => {
    expect(gradeOf(Number.NaN)).toBe("C");
    expect(gradeOf(-1)).toBe("C");
  });

  it("距下一档的差值在阈值上下沿正确", () => {
    expect(scoreGapToNextGrade(100)).toBe(0);
    expect(scoreGapToNextGrade(92)).toBe(0);
    expect(scoreGapToNextGrade(91.9)).toBe(0.1);
    expect(scoreGapToNextGrade(90)).toBe(2);
    expect(scoreGapToNextGrade(85)).toBe(7);
    expect(scoreGapToNextGrade(0)).toBe(72);
  });

  it("韧性系数钳在 0.2 ~ 0.98，不随原始分越界", () => {
    expect(resilienceFactor(profile("a", 0, []))).toBe(0.2);
    expect(resilienceFactor(profile("b", 50, []))).toBe(0.5);
    expect(resilienceFactor(profile("c", 100, []))).toBe(0.98);
  });

  it("四向量满分的加权结果恰为 100", () => {
    const score = compositeScore([
      capability("autonomy", 100),
      capability("toolUsage", 100),
      capability("memory", 100),
      capability("reasoning", 100),
    ]);
    expect(score).toBe(100);
  });

  it("运行时混入未知向量时忽略它，不参与归一化", () => {
    const score = compositeScore([
      capability("autonomy", 100),
      {
        vector: "unknown",
        score: 0,
        delta: 0,
        readings: [],
      } as unknown as CapabilityScore,
    ]);
    expect(score).toBe(100);
  });

  it("集群平均能力对空集合返回空数组", () => {
    expect(averageCapabilities([])).toEqual([]);
  });

  it("集群平均能力按读数逐项取均值并保留一位小数", () => {
    const readings = (first: number, second: number) => [
      { label: "目标完成率", value: first, unit: "%" as const, target: 95 },
      { label: "执行深度", value: second, unit: "次" as const, target: 4 },
    ];

    const a = profile("a", 90, [
      capability("autonomy", 90, readings(100, 4)),
      capability("toolUsage", 90),
      capability("memory", 90),
      capability("reasoning", 90),
    ]);
    const b = profile("b", 80, [
      capability("autonomy", 80, readings(85, 3)),
      capability("toolUsage", 80),
      capability("memory", 80),
      capability("reasoning", 80),
    ]);

    const averaged = averageCapabilities([a, b]);
    const autonomy = averaged.find((item) => item.vector === "autonomy");

    expect(autonomy?.score).toBe(85);
    expect(autonomy?.readings.map((item) => item.value)).toEqual([92.5, 3.5]);
  });

  it("某向量在所有档案里都缺失时记 0，而不是除零得到 NaN", () => {
    const onlyAutonomy = profile("a", 70, [capability("autonomy", 70)]);
    const averaged = averageCapabilities([onlyAutonomy]);
    const toolUsage = averaged.find((item) => item.vector === "toolUsage");

    expect(toolUsage?.score).toBe(0);
    expect(toolUsage?.delta).toBe(0);
    expect(toolUsage?.readings).toEqual([]);
  });

  it("排行榜补齐向量映射，缺历史快照时不编造涨跌", () => {
    const agents = [
      profile("a", 80, [
        capability("autonomy", 80),
        capability("toolUsage", 80),
        capability("memory", 80),
        capability("reasoning", 80),
      ]),
    ];
    const rows = buildLeaderboard(agents);

    expect(rows).toHaveLength(1);
    expect(rows[0].vectorScores).toEqual({
      autonomy: 80,
      toolUsage: 80,
      memory: 80,
      reasoning: 80,
    });
    expect(rows[0].rankDelta).toBe(0);
  });

  it("空榜单返回空数组，不产生占位条目", () => {
    expect(buildLeaderboard([])).toEqual([]);
  });

  it("向量得分映射不包含档案里没有的向量", () => {
    const map = vectorScoreMap(profile("a", 70, [capability("memory", 70)]));
    expect(map).toEqual({ memory: 70 });
  });
});
