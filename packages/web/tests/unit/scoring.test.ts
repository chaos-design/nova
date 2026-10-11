import { describe, expect, it } from "vitest";
import {
  type AgentProfile,
  attainmentScore,
  buildLeaderboard,
  type CapabilityScore,
  compositeScore,
  gradeOf,
  vectorScoreOf,
} from "@/lib/nova";

/**
 * 评分口径测试，对应 docs/nova-standard.md §1.1 / §1.2 / §1.3。
 */

function capability(
  vector: CapabilityScore["vector"],
  score: number,
): CapabilityScore {
  return { vector, score, delta: 0, readings: [] };
}

describe("attainmentScore", () => {
  it("三档判定的边界值：≥1.0 满分、0.8 记 80、0 记 0", () => {
    expect(attainmentScore(1)).toBe(100);
    expect(attainmentScore(1.5)).toBe(100);
    expect(attainmentScore(0.8)).toBe(80);
    expect(attainmentScore(0)).toBe(0);
  });

  it("0.8 ~ 1.0 之间线性插值", () => {
    expect(attainmentScore(0.9)).toBe(90);
    expect(attainmentScore(0.95)).toBe(95);
  });

  it("0 ~ 0.8 之间线性插值", () => {
    expect(attainmentScore(0.4)).toBe(40);
    expect(attainmentScore(0.2)).toBe(20);
  });

  it("非法值归零而不是产生 NaN", () => {
    expect(attainmentScore(Number.NaN)).toBe(0);
    expect(attainmentScore(-1)).toBe(0);
  });
});

describe("vectorScoreOf", () => {
  it("取各子项达标分的均值", () => {
    expect(vectorScoreOf(1, 1)).toBe(100);
    expect(vectorScoreOf(1, 0.8)).toBe(90);
    expect(vectorScoreOf(0.8, 0.8)).toBe(80);
  });

  it("没有子项时记 0", () => {
    expect(vectorScoreOf()).toBe(0);
  });
});

describe("compositeScore", () => {
  it("四项满分 → 100", () => {
    const score = compositeScore([
      capability("autonomy", 100),
      capability("toolUsage", 100),
      capability("memory", 100),
      capability("reasoning", 100),
    ]);

    expect(score).toBe(100);
  });

  it("按权重加权（自主性 30% 权重最大）", () => {
    const score = compositeScore([
      capability("autonomy", 100),
      capability("toolUsage", 0),
      capability("memory", 0),
      capability("reasoning", 0),
    ]);

    expect(score).toBe(30);
  });

  it("缺失向量按剩余权重归一化，不被稀释", () => {
    const score = compositeScore([
      capability("autonomy", 100),
      capability("memory", 100),
    ]);

    // 权重 0.3 + 0.2 = 0.5，总分 = 100×(0.5/0.5)
    expect(score).toBe(100);
  });

  it("没有任何向量时记 0，而不是除零", () => {
    expect(compositeScore([])).toBe(0);
  });
});

describe("gradeOf", () => {
  it("阈值映射符合 §1.3", () => {
    expect(gradeOf(95)).toBe("S");
    expect(gradeOf(92)).toBe("S");
    expect(gradeOf(91.9)).toBe("A");
    expect(gradeOf(85)).toBe("A");
    expect(gradeOf(72)).toBe("B");
    expect(gradeOf(71.9)).toBe("C");
    expect(gradeOf(0)).toBe("C");
  });
});

describe("buildLeaderboard", () => {
  // 用完整档案而不是残缺对象：排行榜会读 capabilities / scenarios，
  // 造一个假对象只会掩盖真实契约
  const profile = (
    id: string,
    name: string,
    compositeScore: number,
  ): AgentProfile => ({
    id,
    name,
    codename: name,
    model: "nova-local-agent",
    owner: "本地开发",
    version: "v1.0.0",
    status: "verified",
    registeredAt: "2026-10-09T00:00:00.000Z",
    lastVerifiedAt: "2026-10-09T00:00:00.000Z",
    scenarios: { passed: 1, total: 1 },
    capabilities: [
      { vector: "autonomy", score: compositeScore, delta: 0, readings: [] },
      { vector: "toolUsage", score: compositeScore, delta: 0, readings: [] },
      { vector: "memory", score: compositeScore, delta: 0, readings: [] },
      { vector: "reasoning", score: compositeScore, delta: 0, readings: [] },
    ],
    compositeScore,
    grade: gradeOf(compositeScore),
    certificateId: null,
    tagline: "",
  });

  const agents = [
    profile("a", "A", 80),
    profile("b", "B", 95),
    profile("c", "C", 95),
  ];

  it("按综合评分降序，同分用 id 打破平局", () => {
    const rows = buildLeaderboard(agents);

    expect(rows.map((row) => row.agentId)).toEqual(["b", "c", "a"]);
    expect(rows[0]?.rank).toBe(1);
  });

  it("没有历史名次快照时涨跌一律记 0，不编造趋势", () => {
    const rows = buildLeaderboard(agents);
    expect(rows.every((row) => row.rankDelta === 0)).toBe(true);
  });

  it("有历史快照时涨跌来自真实名次位移（正数=上升）", () => {
    const rows = buildLeaderboard(agents, { a: 1, b: 3, c: 2 });

    const delta = Object.fromEntries(
      rows.map((row) => [row.agentId, row.rankDelta]),
    );
    // a 从第 1 掉到第 3 → -2；b 从第 3 升到第 1 → +2
    expect(delta.a).toBe(-2);
    expect(delta.b).toBe(2);
    expect(delta.c).toBe(0);
  });
});
