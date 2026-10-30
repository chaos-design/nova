import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "@/lib/nova";
import { LOCAL_AGENTS } from "@/lib/nova";
import type { RecordRunInput } from "@/lib/nova/run-store";

vi.mock("server-only", () => ({}));

/**
 * [V-09] 运行记录落库与派生。
 *
 * 对应 docs/nova-standard.md §5 / §6。三条不能破的线：
 * 1. 客户端传的 score 无效，分数一律由观测派生；
 * 2. 并发落库不丢记录；
 * 3. 损坏的存储按空库处理，下一次写入能自愈。
 *
 * 所有用例锚定临时目录，绝不触碰仓库根的真实 `.nova`。
 */

const AGENT = "agt-local-research";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nova-store-"));
  process.env.NOVA_ROOT = tmp;
  delete process.env.VERCEL;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.NOVA_ROOT;
  delete process.env.VERCEL;
  await fs.rm(tmp, { recursive: true, force: true });
  vi.resetModules();
});

async function store() {
  return import("@/lib/nova/run-store");
}

function makeInput(overrides: Partial<RecordRunInput> = {}): RecordRunInput {
  return {
    agentId: AGENT,
    environment: "deterministic",
    success: true,
    score: 100,
    summary: "验证记录",
    durationMs: 1_500,
    stages: [
      { stage: "ingestion", state: "passed", durationMs: 10, summary: "接入" },
      {
        stage: "execution",
        state: "passed",
        durationMs: 1_200,
        summary: "执行",
      },
      {
        stage: "certificate",
        state: "pending",
        durationMs: 0,
        summary: "待发证",
      },
    ],
    observations: {
      modelCalls: 4,
      toolCalls: 4,
      validArgCalls: 4,
      injected: 0,
      recoveries: 0,
      distinctQueries: 2,
      summarizeCalls: 1,
      finished: true,
      injectionObeyed: false,
      stepsUsed: 6,
      maxSteps: 8,
      usage: {
        calls: 4,
        promptTokens: 800,
        completionTokens: 200,
        totalTokens: 1_000,
      },
    },
    usage: {
      calls: 4,
      promptTokens: 800,
      completionTokens: 200,
      totalTokens: 1_000,
    },
    ...overrides,
  };
}

function failedInput(overrides: Partial<RecordRunInput> = {}): RecordRunInput {
  return makeInput({
    success: false,
    summary: "未达成",
    observations: {
      ...makeInput().observations,
      injected: 1,
      recoveries: 0,
      finished: false,
    },
    ...overrides,
  });
}

describe("[V-09] 运行记录落库与派生", () => {
  it("客户端传入的 score 被忽略：分数只由观测派生", async () => {
    const runs = await store();

    const asZero = await runs.recordRun(makeInput({ score: 0 }));
    const asHundred = await runs.recordRun(makeInput({ score: 999 }));

    expect(asZero.compositeScore).toBe(100);
    expect(asHundred.compositeScore).toBe(100);
    expect(asZero.grade).toBe("S");
  });

  it("观测质量差时伪造高分也不生效", async () => {
    const runs = await store();
    const run = await runs.recordRun(
      makeInput({
        score: 999,
        success: false,
        observations: {
          ...makeInput().observations,
          modelCalls: 0,
          toolCalls: 0,
          validArgCalls: 0,
          distinctQueries: 0,
          summarizeCalls: 0,
          finished: false,
        },
      }),
    );

    expect(run.compositeScore).toBe(37.5);
    expect(run.grade).toBe("C");
    expect(run.certificateId).toBeNull();
  });

  it("成功且评级 B 以上签发证书，序号从 0001 递增", async () => {
    const runs = await store();

    const first = await runs.recordRun(makeInput());
    const second = await runs.recordRun(makeInput());

    expect(first.certificateId).toMatch(/^NOVA-CERT-\d{4}-0001$/);
    expect(second.certificateId).toMatch(/^NOVA-CERT-\d{4}-0002$/);
  });

  it("失败运行不签发证书，也不占用证书序号", async () => {
    const runs = await store();

    const pass = await runs.recordRun(makeInput());
    const fail = await runs.recordRun(failedInput());
    const next = await runs.recordRun(makeInput());

    expect(pass.certificateId).toMatch(/-0001$/);
    expect(fail.certificateId).toBeNull();
    expect(next.certificateId).toMatch(/-0002$/);
  });

  it("运行编号按日期与落库序号生成，格式稳定", async () => {
    const runs = await store();

    const first = await runs.recordRun(makeInput());
    const second = await runs.recordRun(makeInput());

    expect(first.id).toMatch(/^run-\d{4}-\d{3}-001$/);
    expect(second.id).toMatch(/^run-\d{4}-\d{3}-002$/);
    expect(second.id).not.toBe(first.id);
  });

  it("开始与结束时间差覆盖传入的墙钟耗时", async () => {
    const runs = await store();
    const run = await runs.recordRun(makeInput({ durationMs: 2_500 }));
    const elapsed =
      new Date(run.finishedAt ?? 0).getTime() -
      new Date(run.startedAt).getTime();

    // 结束时间取落库瞬间，允许 1 ~ 2ms 的调度误差
    expect(elapsed).toBeGreaterThanOrEqual(2_500);
    expect(elapsed).toBeLessThan(2_600);
  });

  it("8 个并发落库全部保留，id 不重复（写锁串行化）", async () => {
    const runs = await store();

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runs.recordRun(makeInput({ summary: `并发 ${index}` })),
      ),
    );

    const listed = await runs.listRuns();
    expect(listed).toHaveLength(8);
    expect(new Set(listed.map((item) => item.id)).size).toBe(8);
  });

  it("存储文件损坏时按空库读取，写入后自愈为合法 JSON", async () => {
    await fs.mkdir(path.join(tmp, ".nova"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".nova", "runs.json"), "{broken", "utf8");

    const runs = await store();
    expect(await runs.listRuns()).toEqual([]);

    await runs.recordRun(makeInput());
    const onDisk = JSON.parse(
      await fs.readFile(path.join(tmp, ".nova", "runs.json"), "utf8"),
    );
    expect(onDisk.version).toBe(1);
    expect(onDisk.runs).toHaveLength(1);
  });

  it("存储版本不符时视为空库，不猜测迁移", async () => {
    await fs.mkdir(path.join(tmp, ".nova"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".nova", "runs.json"),
      JSON.stringify({ version: 2, runs: [{}] }),
      "utf8",
    );

    const runs = await store();
    expect(await runs.listRuns()).toEqual([]);
  });

  it("档案只收登记表内的 Agent，未登记的运行记录被忽略", async () => {
    const runs = await store();
    await runs.recordRun(makeInput({ agentId: "agt-local-ghost" }));
    await runs.recordRun(makeInput());

    const agents = await runs.verifiedAgents();
    expect(agents.map((item) => item.id)).toEqual([AGENT]);
  });

  it("最近一次运行决定状态与分数，历史累计决定场景通过率", async () => {
    const runs = await store();
    await runs.recordRun(makeInput({ summary: "第一次成功" }));
    await runs.recordRun(failedInput({ summary: "第二次失败" }));

    const agent = await runs.agentById(AGENT);

    expect(agent?.status).toBe("regression");
    expect(agent?.scenarios).toEqual({ passed: 1, total: 2 });
    expect(agent?.tagline).toBe("第二次失败");
    expect(agent?.lastVerifiedAt).not.toBeNull();
  });

  it("集群概览四项全部由真实记录派生", async () => {
    const runs = await store();
    await runs.recordRun(makeInput());
    await runs.recordRun(
      makeInput({
        agentId: "agt-local-coder",
        observations: {
          ...makeInput().observations,
          injected: 2,
          recoveries: 2,
        },
      }),
    );

    const stats = await runs.clusterStats();
    const byId = Object.fromEntries(stats.map((item) => [item.id, item.value]));

    expect(byId.activeVerifications).toBe(2);
    expect(byId.queuedRuns).toBe(LOCAL_AGENTS.length - 2);
    expect(byId.certificatesIssued).toBe(2);
    expect(byId.chaosIncidents).toBe(2);
  });

  it("遥测按累计达成率、墙钟耗时、步数占用与 token 吞吐派生", async () => {
    const runs = await store();
    await runs.recordRun(makeInput({ durationMs: 2_000 }));
    await runs.recordRun(
      makeInput({
        success: false,
        durationMs: 4_000,
        observations: { ...makeInput().observations, stepsUsed: 8 },
      }),
    );

    const points = await runs.telemetrySeries();

    expect(points).toHaveLength(2);
    expect(points[0].successRate).toBe(100);
    expect(points[1].successRate).toBe(50);
    expect(points[1].latencyMs).toBe(4_000);
    expect(points[1].memoryUtilization).toBe(100);
    expect(points[0].throughputTps).toBe(500);
    expect(points[0].t).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("名次快照可回写可读回，ranksOf 与 byScore 口径一致", async () => {
    const runs = await store();

    await runs.saveRankSnapshot({ [AGENT]: 1 });
    expect(await runs.rankSnapshot()).toEqual({ [AGENT]: 1 });

    const agents: AgentProfile[] = [
      { ...placeholder, id: "a", compositeScore: 90 },
      { ...placeholder, id: "b", compositeScore: 80 },
    ];
    expect(runs.ranksOf(agents)).toEqual({ a: 1, b: 2 });
    expect(runs.byScore(agents).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

/** 只用于排序与名次映射的最小合法档案 */
const placeholder: AgentProfile = {
  id: "placeholder",
  name: "占位",
  codename: "占位",
  model: "stub",
  owner: "验证",
  version: "v0",
  status: "verified",
  registeredAt: "2026-10-30T00:00:00.000Z",
  lastVerifiedAt: "2026-10-30T00:00:00.000Z",
  scenarios: { passed: 1, total: 1 },
  capabilities: [],
  compositeScore: 0,
  grade: "C",
  certificateId: null,
  tagline: "",
};
