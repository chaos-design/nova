import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunObservations, TokenUsage } from "./executor";
import { formatClock } from "./format";
import { LOCAL_AGENTS, localAgentProfile } from "./local-agents";
import { buildLeaderboard } from "./scoring";
import type {
  AgentProfile,
  CapabilityScore,
  ClusterStat,
  EnvironmentId,
  NovaGrade,
  TelemetryPoint,
  VerificationRun,
  VerificationStageResult,
} from "./types";
import { verdictFromObservations } from "./verdict";

/**
 * 真实运行记录存储。
 *
 * 这是移除 mock 之后**唯一的数据来源**：界面上的每一个数字都来自一次
 * 真实跑完的沙盒验证，没有任何预置档案。存储落在 `.nova/runs.json`
 * （已 gitignore），因此刷新页面、重启服务都不会让历史消失。
 *
 * 设计取舍：用单个 JSON 文件而不是引入数据库 —— 演示项目的数据量
 * 只有几十条记录，一个文件足够，且不增加部署依赖。真要上规模时，
 * 替换本文件内部实现即可，对外的函数签名不变。
 */

/** 存储文件位置（相对项目根） */
const STORE_DIR = ".nova";
const STORE_FILE = "runs.json";

/** 一条已落库的运行记录 */
export interface StoredRun extends VerificationRun {
  /** 收敛判定结果 */
  success: boolean;
  /** 端到端墙钟耗时（毫秒） */
  durationMs: number;
  /** 本次评定的等级 */
  grade: NovaGrade;
  /** 本次评定的能力向量 */
  capabilities: CapabilityScore[];
  /** 本次观测计数 */
  observations: RunObservations;
  /** token 用量 */
  usage: TokenUsage;
  /** 本次签发的证书编号（未达签发条件为 null） */
  certificateId: string | null;
}

interface StoreData {
  version: 1;
  runs: StoredRun[];
  /** 上一次评估后的排名快照，用于计算真实的排名变化 */
  rankSnapshot: Record<string, number>;
  /** 证书序号自增 */
  certificateSeq: number;
}

const EMPTY: StoreData = {
  version: 1,
  runs: [],
  rankSnapshot: {},
  certificateSeq: 0,
};

function storePath(): string {
  return path.join(process.cwd(), STORE_DIR, STORE_FILE);
}

/** 串行的写锁：并发落库时后一次覆盖前一次是数据丢失，必须排隊 */
let writeChain: Promise<unknown> = Promise.resolve();

async function read(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreData;
    if (parsed?.version !== 1 || !Array.isArray(parsed.runs)) return EMPTY;
    return parsed;
  } catch {
    // 文件不存在或损坏都按空库处理：演示项目不需要迁移逻辑
    return { ...EMPTY, runs: [], rankSnapshot: {} };
  }
}

async function writeTransaction<T>(mutate: (data: StoreData) => T): Promise<T> {
  const task = writeChain.then(async () => {
    const data = await read();
    const result = mutate(data);
    await fs.mkdir(path.join(process.cwd(), STORE_DIR), { recursive: true });
    await fs.writeFile(storePath(), JSON.stringify(data, null, 2), "utf8");
    return result;
  });

  // 无论成功失败都要接住，否则后续写入会永远挂在被拒绝的 Promise 上
  writeChain = task.catch(() => undefined);
  return task;
}

/* -------------------------------------------------------------------------- */
/* 写入                                                                        */
/* -------------------------------------------------------------------------- */

export interface RecordRunInput {
  agentId: string;
  environment: EnvironmentId;
  success: boolean;
  score: number;
  summary: string;
  durationMs: number;
  stages: readonly VerificationStageResult[];
  observations: RunObservations;
  usage: TokenUsage;
}

/** 运行编号：`run-{年}{第几天}-{序号}`，由落库序号派生，稳定不重复 */
function runIdOf(now: Date, seq: number): string {
  const year = now.getUTCFullYear();
  const dayOfYear =
    Math.floor((now.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `run-${year}-${String(dayOfYear).padStart(3, "0")}-${String(seq).padStart(3, "0")}`;
}

/**
 * 落库一次真实运行，并返回它与本次派生的档案。
 *
 * 证书编号按标准 §5 的三条规则判定签发：评级 ≥ B、状态已验证、已完成验证。
 */
export function recordRun(input: RecordRunInput): Promise<StoredRun> {
  const startedAt = new Date(Date.now() - input.durationMs);
  const finishedAt = new Date();
  const verdict = verdictFromObservations(input.observations, input.success);

  return writeTransaction((data) => {
    const seq = data.runs.length + 1;
    const issued =
      verdict.grade !== "C" && verdict.status === "verified" && input.success;

    let certificateId: string | null = null;
    if (issued) {
      data.certificateSeq += 1;
      certificateId = `NOVA-CERT-${finishedAt.getUTCFullYear()}-${String(
        data.certificateSeq,
      ).padStart(4, "0")}`;
    }

    const run: StoredRun = {
      id: runIdOf(finishedAt, seq),
      agentId: input.agentId,
      environment: input.environment,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      currentStage: "certificate",
      stages: [...input.stages],
      compositeScore: verdict.compositeScore,
      notes: input.summary,
      success: input.success,
      durationMs: input.durationMs,
      grade: verdict.grade,
      capabilities: verdict.capabilities,
      observations: input.observations,
      usage: input.usage,
      certificateId,
    };

    data.runs.push(run);
    return run;
  });
}

/** 名次快照在榜单渲染后回写，用于下次计算真实涨跌 */
export function saveRankSnapshot(ranks: Record<string, number>): Promise<void> {
  return writeTransaction((data) => {
    data.rankSnapshot = ranks;
  });
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                        */
/* -------------------------------------------------------------------------- */

/** 全部运行记录，按开始时间倒序 */
export async function listRuns(): Promise<StoredRun[]> {
  const data = await read();
  return [...data.runs].reverse();
}

/** 上一次评估的排名快照 */
export async function rankSnapshot(): Promise<Record<string, number>> {
  return (await read()).rankSnapshot;
}

/**
 * 已产生真实结果的 Agent 档案。
 *
 * 身份信息（代号 / 模型 / 归属 / 版本）来自 `LOCAL_AGENTS` 登记，
 * 评分与状态来自它自己跑出来的运行记录 —— 没跑过的 Agent 不在这里出现。
 */
export async function verifiedAgents(): Promise<AgentProfile[]> {
  const data = await read();
  const latest = new Map<string, StoredRun>();
  const passed = new Map<string, number>();
  const total = new Map<string, number>();
  const certificates = new Map<string, string>();

  for (const run of data.runs) {
    latest.set(run.agentId, run);
    total.set(run.agentId, (total.get(run.agentId) ?? 0) + 1);
    if (run.success) {
      passed.set(run.agentId, (passed.get(run.agentId) ?? 0) + 1);
    }
    if (run.certificateId) certificates.set(run.agentId, run.certificateId);
  }

  const profiles: AgentProfile[] = [];

  for (const entry of LOCAL_AGENTS) {
    const run = latest.get(entry.id);
    if (!run) continue;

    const base = localAgentProfile(entry);
    profiles.push({
      ...base,
      status: verdictFromObservations(run.observations, run.success).status,
      lastVerifiedAt: run.finishedAt,
      scenarios: {
        passed: passed.get(entry.id) ?? 0,
        total: total.get(entry.id) ?? 0,
      },
      capabilities: run.capabilities,
      compositeScore: run.compositeScore,
      grade: run.grade,
      certificateId: certificates.get(entry.id) ?? null,
      // 画像来自最近一次真实结论，不再是一句固定文案
      tagline: run.notes,
    });
  }

  return profiles.sort(
    (a, b) => b.compositeScore - a.compositeScore || a.id.localeCompare(b.id),
  );
}

/** 按 id 查档案；未跑过验证的 Agent 没有档案，返回 undefined */
export async function agentById(id: string): Promise<AgentProfile | undefined> {
  const agents = await verifiedAgents();
  return agents.find((agent) => agent.id === id);
}

/** 按综合评分降序（排行榜页与仪表盘共用同一口径） */
export function byScore(agents: readonly AgentProfile[]): AgentProfile[] {
  return [...agents].sort(
    (a, b) => b.compositeScore - a.compositeScore || a.id.localeCompare(b.id),
  );
}

/** 由真实运行派生集群概览；每项都可追溯到具体运行记录 */
export async function clusterStats(): Promise<ClusterStat[]> {
  const data = await read();
  const agents = await verifiedAgents();

  const chaosIncidents = data.runs.reduce(
    (acc, run) => acc + run.observations.injected,
    0,
  );
  const certificates = data.runs.filter((run) => run.certificateId).length;

  return [
    {
      id: "activeVerifications",
      label: "已完成验证",
      value: agents.length,
      unit: "个",
      delta: 0,
      accent: "cyan",
    },
    {
      id: "queuedRuns",
      label: "待验证",
      value: Math.max(LOCAL_AGENTS.length - agents.length, 0),
      unit: "个",
      delta: 0,
      accent: "violet",
    },
    {
      id: "certificatesIssued",
      label: "已签发证书",
      value: certificates,
      unit: "张",
      delta: 0,
      accent: "fuchsia",
    },
    {
      id: "chaosIncidents",
      label: "混沌事件累计",
      value: chaosIncidents,
      unit: "次",
      delta: 0,
      accent: "rose",
    },
  ];
}

/**
 * 由真实运行派生遥测序列。
 *
 * 四项指标都换成了可观测口径（标准 §6）：成功率取累计达成率，
 * 延迟取端到端耗时，占用率取步数预算占用，吞吐取 token/秒。
 */
export async function telemetrySeries(): Promise<TelemetryPoint[]> {
  const data = await read();
  let passed = 0;

  return data.runs.map((run, index) => {
    if (run.success) passed += 1;
    const seconds = run.durationMs > 0 ? run.durationMs / 1_000 : 1;

    return {
      t: formatClock(run.startedAt),
      successRate: Math.round((passed / (index + 1)) * 100 * 10) / 10,
      latencyMs: run.durationMs,
      memoryUtilization:
        run.observations.maxSteps > 0
          ? Math.round(
              (run.observations.stepsUsed / run.observations.maxSteps) * 1_000,
            ) / 10
          : 0,
      throughputTps: Math.round((run.usage.totalTokens / seconds) * 10) / 10,
    };
  });
}

/** 排行榜用的名次快照：把当前榜单名次固化下来供下次对照 */
export function ranksOf(
  agents: readonly AgentProfile[],
): Record<string, number> {
  return Object.fromEntries(
    buildLeaderboard(agents).map((entry) => [entry.agentId, entry.rank]),
  );
}
