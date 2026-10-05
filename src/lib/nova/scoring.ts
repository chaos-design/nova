import { CAPABILITY_VECTORS, GRADE_THRESHOLDS } from "./constants";
import type {
  AgentProfile,
  CapabilityScore,
  CapabilityVectorId,
  LeaderboardEntry,
  NovaGrade,
} from "./types";

/**
 * NOVA 综合评分：四大能力向量的加权平均。
 *
 * 只对实际存在的向量做归一化，避免部分向量缺失时总分被稀释。
 */
export function compositeScore(scores: readonly CapabilityScore[]): number {
  const weights = new Map<CapabilityVectorId, number>(
    CAPABILITY_VECTORS.map((vector) => [vector.id, vector.weight]),
  );

  let weighted = 0;
  let totalWeight = 0;
  for (const item of scores) {
    const weight = weights.get(item.vector);
    if (weight === undefined) continue;
    weighted += item.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weighted / totalWeight) * 10) / 10;
}

/** 分数 → 评级 */
export function gradeOf(score: number): NovaGrade {
  const matched = GRADE_THRESHOLDS.find((item) => score >= item.min);
  return (matched?.grade ?? "C") as NovaGrade;
}

/** 评级 → 静态元信息 */
export function gradeMeta(grade: NovaGrade) {
  return (
    GRADE_THRESHOLDS.find((item) => item.grade === grade) ?? GRADE_THRESHOLDS[3]
  );
}

/** 距离下一档评级还差多少分，已达最高档返回 0 */
export function scoreGapToNextGrade(score: number): number {
  const higher = GRADE_THRESHOLDS.filter((item) => item.min > score);
  if (higher.length === 0) return 0;
  const next = Math.max(...higher.map((item) => item.min));
  return Math.round((next - score) * 10) / 10;
}

/** 从档案中抽取向量得分映射 */
export function vectorScoreMap(
  agent: AgentProfile,
): Record<CapabilityVectorId, number> {
  const map = {} as Record<CapabilityVectorId, number>;
  for (const item of agent.capabilities) {
    map[item.vector] = item.score;
  }
  return map;
}

/** 由 Agent 档案集合派生排行榜（按综合评分降序） */
export function buildLeaderboard(
  agents: readonly AgentProfile[],
): LeaderboardEntry[] {
  const sorted = [...agents].sort(
    (a, b) => b.compositeScore - a.compositeScore || a.id.localeCompare(b.id),
  );

  return sorted.map((agent, index) => ({
    rank: index + 1,
    agentId: agent.id,
    name: agent.name,
    codename: agent.codename,
    model: agent.model,
    compositeScore: agent.compositeScore,
    grade: agent.grade,
    // 演示数据：排名趋势由排名派生，展示"较上一轮"的升降
    rankDelta: ((index + 2) % 5) - 2,
    scenariosPassed: agent.scenarios.passed,
    scenariosTotal: agent.scenarios.total,
    vectorScores: vectorScoreMap(agent),
  }));
}

/** 单个 Agent 的韧性系数（0 ~ 1），用于模拟中估算故障代价 */
export function resilienceFactor(agent: AgentProfile): number {
  return Math.min(Math.max(agent.compositeScore / 100, 0.2), 0.98);
}

/**
 * 集群平均能力向量。
 *
 * 作为雷达图与矩阵页的对照基线：单个 Agent 落在基线之上还是之下，
 * 比绝对分数更能说明问题。
 */
export function averageCapabilities(
  agents: readonly AgentProfile[],
): CapabilityScore[] {
  if (agents.length === 0) return [];

  return CAPABILITY_VECTORS.map((vector) => {
    const items = agents
      .map((agent) => agent.capabilities.find((c) => c.vector === vector.id))
      .filter((item): item is CapabilityScore => item !== undefined);

    const readings = items[0]?.readings.map((reading, index) => {
      const values = items
        .map((item) => item.readings[index]?.value)
        .filter((value): value is number => value !== undefined);
      const sum = values.reduce((acc, value) => acc + value, 0);

      return {
        ...reading,
        value: values.length ? Math.round((sum / values.length) * 10) / 10 : 0,
      };
    });

    const score =
      items.reduce((acc, item) => acc + item.score, 0) / items.length;
    const delta =
      items.reduce((acc, item) => acc + item.delta, 0) / items.length;

    return {
      vector: vector.id,
      score: Math.round(score * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      readings,
    };
  });
}
