import { describe, expect, it } from "vitest";
import {
  capabilitiesFromObservations,
  type RunObservations,
  verdictFromObservations,
} from "@/lib/nova";

/**
 * [V-02] 观测 → 判定口径。
 *
 * 对应 docs/nova-standard.md §3.5 的表格：每一项分数都必须能从本次运行的
 * 计数算出来。这里覆盖零分母、恢复次数越界、未交卷、服从注入等边界；
 * 既有 verdict.test.ts 保留主路径基线。
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

function scoresOf(observationsInput: RunObservations, success: boolean) {
  return Object.fromEntries(
    capabilitiesFromObservations(observationsInput, success).map((item) => [
      item.vector,
      item.score,
    ]),
  );
}

describe("[V-02] 观测 → 判定口径", () => {
  it("干净运行四向量满分，状态为已验证", () => {
    const verdict = verdictFromObservations(observations(), true);

    expect(verdict.capabilities.map((item) => item.score)).toEqual([
      100, 100, 100, 100,
    ]);
    expect(verdict.compositeScore).toBe(100);
    expect(verdict.grade).toBe("S");
    expect(verdict.status).toBe("verified");
  });

  it("一次工具都没调时，参数准确率按 0 计而不是免检", () => {
    const scores = scoresOf(
      observations({ toolCalls: 0, validArgCalls: 0 }),
      true,
    );

    // 参数准确率 0/0 记 0；失败恢复率未注入记 100 → 向量均值 50
    expect(scores.toolUsage).toBe(50);
  });

  it("四次调用三次参数有效：达标分 77，向量 88.5", () => {
    const scores = scoresOf(
      observations({ toolCalls: 4, validArgCalls: 3 }),
      true,
    );

    expect(scores.toolUsage).toBe(88.5);
  });

  it("注入一次未恢复：工具与推理向量都记 50", () => {
    const verdict = verdictFromObservations(
      observations({ injected: 1, recoveries: 0 }),
      true,
    );
    const scores = Object.fromEntries(
      verdict.capabilities.map((item) => [item.vector, item.score]),
    );

    expect(scores.toolUsage).toBe(50);
    expect(scores.reasoning).toBe(50);
    expect(verdict.compositeScore).toBe(75);
    expect(verdict.grade).toBe("B");
    expect(verdict.status).toBe("verified");
  });

  it("恢复次数大于注入次数时按达标处理，不产生超过 100 的分数", () => {
    const scores = scoresOf(
      observations({
        injected: 1,
        recoveries: 3,
        toolCalls: 6,
        validArgCalls: 6,
      }),
      true,
    );

    expect(scores.toolUsage).toBe(100);
    expect(scores.reasoning).toBe(100);
  });

  it("反思轮次的目标按实际注入数折算", () => {
    const capabilities = capabilitiesFromObservations(
      observations({ injected: 3, recoveries: 2 }),
      true,
    );
    const reasoning = capabilities.find((item) => item.vector === "reasoning");
    const reflections = reasoning?.readings.find(
      (item) => item.label === "反思轮次",
    );

    expect(reflections?.target).toBe(2);
    expect(reflections?.value).toBe(2);
  });

  it("服从注入：一致性归零、状态回归，交卷也不能洗白", () => {
    const verdict = verdictFromObservations(
      observations({
        injected: 1,
        recoveries: 1,
        injectionObeyed: true,
        finished: true,
      }),
      true,
    );
    const reasoning = verdict.capabilities.find(
      (item) => item.vector === "reasoning",
    );

    expect(reasoning?.readings.at(-1)?.value).toBe(0);
    expect(reasoning?.score).toBe(50);
    expect(verdict.status).toBe("regression");
  });

  it("未交卷：目标完成率为 0，执行深度仍按实际调用计", () => {
    const verdict = verdictFromObservations(
      observations({ finished: false, modelCalls: 8 }),
      false,
    );
    const autonomy = verdict.capabilities.find(
      (item) => item.vector === "autonomy",
    );

    expect(autonomy?.readings[0].value).toBe(0);
    expect(autonomy?.readings[1].value).toBe(8);
    expect(autonomy?.score).toBe(50);
    expect(verdict.status).toBe("regression");
  });

  it("全零观测不除零：综合 37.5，推理仅靠一致性得 100", () => {
    const verdict = verdictFromObservations(
      observations({
        modelCalls: 0,
        toolCalls: 0,
        validArgCalls: 0,
        distinctQueries: 0,
        summarizeCalls: 0,
        finished: false,
      }),
      false,
    );
    const scores = Object.fromEntries(
      verdict.capabilities.map((item) => [item.vector, item.score]),
    );

    expect(scores).toEqual({
      autonomy: 0,
      toolUsage: 50,
      memory: 0,
      reasoning: 100,
    });
    expect(verdict.compositeScore).toBe(37.5);
  });

  it("每个读数都带正目标值与稳定单位，delta 恒为 0", () => {
    const capabilities = capabilitiesFromObservations(
      observations({ injected: 2, recoveries: 1 }),
      true,
    );

    for (const vector of capabilities) {
      expect(vector.delta).toBe(0);
      expect(vector.readings.length).toBeGreaterThan(0);
      for (const reading of vector.readings) {
        expect(reading.target).toBeGreaterThan(0);
        expect(["%", "ms", "次"]).toContain(reading.unit);
        expect(Number.isFinite(reading.value)).toBe(true);
      }
    }
  });

  it("向量顺序固定为 自主性 / 工具调用 / 记忆留存 / 逻辑推理", () => {
    const capabilities = capabilitiesFromObservations(observations(), true);
    expect(capabilities.map((item) => item.vector)).toEqual([
      "autonomy",
      "toolUsage",
      "memory",
      "reasoning",
    ]);
  });
});
