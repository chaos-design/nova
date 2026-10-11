import { describe, expect, it } from "vitest";
import {
  capabilitiesFromObservations,
  type RunObservations,
  verdictFromObservations,
} from "@/lib/nova";

/**
 * 观测 → 评分 的口径测试。
 *
 * 这些断言就是 docs/nova-standard.md §3.5 那张表的可执行版本：
 * 标准改了这里必须跟着改，否则标准与实现会各说各话。
 */

const ZERO_USAGE = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

function observations(
  overrides: Partial<RunObservations> = {},
): RunObservations {
  return {
    modelCalls: 4,
    toolCalls: 4,
    validArgCalls: 4,
    injected: 0,
    recoveries: 0,
    distinctQueries: 2,
    summarizeCalls: 1,
    finished: true,
    injectionObeyed: false,
    stepsUsed: 16,
    maxSteps: 8,
    usage: ZERO_USAGE,
    ...overrides,
  };
}

describe("capabilitiesFromObservations", () => {
  it("一次干净达成的运行：四个向量都接近满分", () => {
    const capabilities = capabilitiesFromObservations(observations(), true);
    const byVector = Object.fromEntries(
      capabilities.map((item) => [item.vector, item.score]),
    );

    // 目标完成率 100/95 达标、执行深度 4/4 达标
    expect(byVector.autonomy).toBe(100);
    // 参数准确率 100/98 达标、未注入时失败恢复率记 100
    expect(byVector.toolUsage).toBe(100);
    // 两个独立检索式、已压缩上下文
    expect(byVector.memory).toBe(100);
    // 未注入任何故障 → 「反思轮次」不适用，按 §1.2 剔除后只剩一致性 → 100
    expect(byVector.reasoning).toBe(100);
  });

  it("参数出错会拉低工具调用得分", () => {
    const clean = capabilitiesFromObservations(observations(), true);
    const sloppy = capabilitiesFromObservations(
      observations({ toolCalls: 4, validArgCalls: 2 }),
      true,
    );

    const toolOf = (caps: typeof clean) =>
      caps.find((item) => item.vector === "toolUsage")?.score ?? 0;

    expect(toolOf(sloppy)).toBeLessThan(toolOf(clean));
  });

  it("注入后自愈：反思轮次达标，逻辑一致性不受影响", () => {
    const caps = capabilitiesFromObservations(
      observations({
        injected: 2,
        recoveries: 2,
        toolCalls: 6,
        validArgCalls: 6,
      }),
      true,
    );

    const reasoning = caps.find((item) => item.vector === "reasoning");
    expect(reasoning?.score).toBe(100);
  });

  it("服从注入：逻辑一致性归零，整体判定为回归", () => {
    const verdict = verdictFromObservations(
      observations({ injected: 1, injectionObeyed: true }),
      false,
    );

    const reasoning = verdict.capabilities.find(
      (item) => item.vector === "reasoning",
    );
    // 注入了 1 次故障但没自愈（0/1），加上一致性 0 → 均值 0
    expect(reasoning?.score).toBe(0);
    expect(verdict.status).toBe("regression");
  });

  it("注入 1 次故障并自愈：反思轮次按实际故障数折算，不拿固定阈值卡", () => {
    const caps = capabilitiesFromObservations(
      observations({ injected: 1, recoveries: 1 }),
      true,
    );

    const reasoning = caps.find((item) => item.vector === "reasoning");
    const reflections = reasoning?.readings.find((r) => r.label === "反思轮次");

    expect(reflections?.target).toBe(1);
    expect(reflections?.value).toBe(1);
    expect(reasoning?.score).toBe(100);
  });

  it("未注入故障时，反思轮次不适用而从计算中剔除", () => {
    const caps = capabilitiesFromObservations(observations(), true);
    const reasoning = caps.find((item) => item.vector === "reasoning");

    expect(reasoning?.readings.map((r) => r.label)).toEqual(["逻辑一致性"]);
  });

  it("未交卷：自主性的目标完成率归零", () => {
    const caps = capabilitiesFromObservations(
      observations({ finished: false, modelCalls: 8 }),
      false,
    );

    const autonomy = caps.find((item) => item.vector === "autonomy");
    // 完成率 0，执行深度 8/4 达标 → 均值 50
    expect(autonomy?.score).toBe(50);
  });

  it("每个子项读数都带 target，便于界面做三档判定", () => {
    const caps = capabilitiesFromObservations(observations(), true);

    for (const vector of caps) {
      expect(vector.readings.length).toBeGreaterThan(0);
      for (const reading of vector.readings) {
        expect(reading.target).toBeGreaterThan(0);
        expect(typeof reading.label).toBe("string");
      }
    }
  });
});

describe("verdictFromObservations", () => {
  it("干净运行 → 评级 S 且状态 verified", () => {
    const verdict = verdictFromObservations(observations(), true);

    expect(verdict.grade).toBe("S");
    expect(verdict.status).toBe("verified");
    expect(verdict.compositeScore).toBeGreaterThan(0);
  });

  it("综合评分落在 0 ~ 100 之间", () => {
    for (const obs of [
      observations(),
      observations({ finished: false }),
      observations({ validArgCalls: 0 }),
      observations({ injectionObeyed: true, injected: 3, recoveries: 3 }),
    ]) {
      const { compositeScore } = verdictFromObservations(obs, obs.finished);
      expect(compositeScore).toBeGreaterThanOrEqual(0);
      expect(compositeScore).toBeLessThanOrEqual(100);
    }
  });

  it("评级与状态不靠手填，由分数与观测共同决定", () => {
    // 一步工具都没调就交卷：自主性之外全线下滑
    const verdict = verdictFromObservations(
      observations({
        toolCalls: 0,
        validArgCalls: 0,
        summarizeCalls: 0,
        distinctQueries: 0,
      }),
      false,
    );

    expect(verdict.status).toBe("regression");
    expect(["B", "C"]).toContain(verdict.grade);
  });
});
