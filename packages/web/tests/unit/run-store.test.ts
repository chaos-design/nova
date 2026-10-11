import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordRunInput } from "@/lib/nova/run-store";

/**
 * `run-store` 顶部 `import "server-only"`，在 Node 里直接导入会抛错。
 * 单测跑在 node 环境，把它替换成空模块即可；测试只关心落库语义。
 */
vi.mock("server-only", () => ({}));

function makeInput(overrides: Partial<RecordRunInput> = {}): RecordRunInput {
  return {
    agentId: "nova-local",
    environment: "deterministic",
    success: true,
    score: 92,
    summary: "单测记录",
    durationMs: 1_500,
    stages: [
      { stage: "ingestion", state: "passed", durationMs: 400, summary: "s" },
      { stage: "certificate", state: "passed", durationMs: 10, summary: "c" },
    ],
    observations: {
      modelCalls: 4,
      toolCalls: 6,
      validArgCalls: 6,
      injected: 1,
      recoveries: 1,
      distinctQueries: 2,
      summarizeCalls: 0,
      finished: true,
      injectionObeyed: false,
      stepsUsed: 5,
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

/**
 * 在 Vercel 上函数文件系统只读，`run-store` 会检测到 `process.env.VERCEL`
 * 并降级为进程内内存。这里在导入模块前设置该变量再动态导入，验证：
 * 1. VERCEL 模式下读写全程只走内存，不落任何文件（锚定到临时目录后
 *    确认该目录里不存在 `.nova`）；
 * 2. 数据在同一模块实例内跨多次落库可累积；
 * 3. 非 VERCEL 环境仍按原语义写 `.nova/runs.json`。
 *
 * `NOVA_ROOT` 一律锚定到临时目录，绝不触碰仓库根的真实 `.nova`。
 */
describe("run-store Vercel 内存兜底", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await nodeFs.mkdtemp(path.join(process.cwd(), ".nova-test-"));
    process.env.NOVA_ROOT = tmp;
    process.env.VERCEL = "1";
    // 每次导入都拿一份全新的模块状态（内存从空开始）
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.VERCEL;
    delete process.env.NOVA_ROOT;
    await nodeFs.rm(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it("VERCEL 模式：记录留在内存，不落任何文件", async () => {
    const store = await import("@/lib/nova/run-store");

    const run = await store.recordRun(makeInput());
    const listed = await store.listRuns();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ agentId: "nova-local", success: true });
    expect(run.id).toBe(listed[0].id);

    // 内存兜底不得创建 .nova 目录或写 runs.json
    const novaDir = path.join(tmp, ".nova");
    await expect(nodeFs.stat(novaDir)).rejects.toThrow();
  });

  it("VERCEL 模式：同一模块实例内多次落库可累积", async () => {
    const store = await import("@/lib/nova/run-store");

    const first = await store.recordRun(makeInput({ agentId: "a" }));
    const second = await store.recordRun(makeInput({ agentId: "b" }));

    const listed = await store.listRuns();
    // 倒序：后一条在前
    expect(listed.map((r) => r.agentId)).toEqual(["b", "a"]);
    expect(second.id).not.toBe(first.id);
  });

  it("VERCEL 模式：证书与等级随观测派生，不崩", async () => {
    const store = await import("@/lib/nova/run-store");

    const pass = await store.recordRun(makeInput());
    expect(pass.certificateId).toMatch(/^NOVA-CERT-/);

    const fail = await store.recordRun(makeInput({ success: false }));
    expect(fail.success).toBe(false);
    expect(fail.id).not.toBe(pass.id);
  });

  it("VERCEL 模式：saveRankSnapshot 在内存回写，rankSnapshot 可读", async () => {
    const store = await import("@/lib/nova/run-store");

    const ranks = { a: 1, b: 2 };
    await store.saveRankSnapshot(ranks);
    expect(await store.rankSnapshot()).toEqual(ranks);
  });

  it("非 VERCEL 环境：仍落盘到 .nova/runs.json", async () => {
    delete process.env.VERCEL;
    vi.resetModules();

    const store = await import("@/lib/nova/run-store");
    const run = await store.recordRun(makeInput());
    const listed = await store.listRuns();

    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(run.id);

    // 文件真实写到了临时根下的 .nova
    const onDisk = JSON.parse(
      await nodeFs.readFile(path.join(tmp, ".nova", "runs.json"), "utf8"),
    );
    expect(onDisk.runs).toHaveLength(1);
  });
});
