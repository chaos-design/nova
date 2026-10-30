import { describe, expect, it } from "vitest";
import {
  type AgentProfile,
  buildCertificate,
  buildCertificates,
  buildReport,
  clamp,
  formatClock,
  formatDateTime,
  formatDelta,
  formatDuration,
  formatTimestamp,
  formatYear,
  passRateOf,
  round,
  scoreTone,
  type VerificationRun,
} from "@/lib/nova";

/**
 * [V-14] 报告契约与展示口径。
 *
 * 对应 docs/nova-standard.md §7：报告字段稳定、可机读；时间一律北京时间，
 * 不能跟随服务器或浏览器时区漂移。
 */

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agt-local-research",
    name: "NOVA-RESEARCH",
    codename: "深度调研员",
    model: "nova-research-agent",
    owner: "本地开发",
    version: "v0.1.0",
    status: "verified",
    registeredAt: "2026-10-14T00:00:00.000Z",
    lastVerifiedAt: "2026-10-30T10:00:00.000Z",
    scenarios: { passed: 3, total: 4 },
    capabilities: [
      {
        vector: "autonomy",
        score: 90,
        delta: 0,
        readings: [{ label: "目标完成率", value: 100, unit: "%", target: 95 }],
      },
      { vector: "toolUsage", score: 80, delta: 0, readings: [] },
      { vector: "memory", score: 70, delta: 0, readings: [] },
      { vector: "reasoning", score: 60, delta: 0, readings: [] },
    ],
    compositeScore: 76.5,
    grade: "B",
    certificateId: "NOVA-CERT-2026-0007",
    tagline: "稳定通过交叉验证",
    ...overrides,
  };
}

function run(): VerificationRun {
  return {
    id: "run-2026-303-001",
    agentId: "agt-local-research",
    environment: "deterministic",
    startedAt: "2026-10-30T09:00:00.000Z",
    finishedAt: "2026-10-30T09:00:02.000Z",
    currentStage: "certificate",
    stages: [
      {
        stage: "lint",
        state: "passed",
        durationMs: 12,
        summary: "静态校验通过",
      },
      {
        stage: "execution",
        state: "passed",
        durationMs: 1_800,
        summary: "执行完成",
      },
    ],
    compositeScore: 76.5,
    notes: "验证记录",
  };
}

describe("[V-14] 报告契约与展示口径", () => {
  it("报告固定输出四个能力向量且顺序稳定", () => {
    const report = buildReport(profile(), null);

    expect(report.reportVersion).toBe("1.0.0");
    expect(report.capabilities.map((item) => item.vector)).toEqual([
      "autonomy",
      "toolUsage",
      "memory",
      "reasoning",
    ]);
    expect(report.capabilities.map((item) => item.label)).toEqual([
      "自主性",
      "工具调用",
      "记忆留存",
      "逻辑推理",
    ]);
  });

  it("缺失的能力向量补 0 分与空读数，不省略条目", () => {
    const report = buildReport(
      profile({
        capabilities: [
          { vector: "autonomy", score: 90, delta: 0, readings: [] },
        ],
      }),
      null,
    );

    const memory = report.capabilities.find((item) => item.vector === "memory");
    expect(memory).toEqual({
      vector: "memory",
      label: "记忆留存",
      weight: 0.2,
      score: 0,
      readings: [],
    });
  });

  it("报告携带档案与判定快照，生命周期为空时是空数组", () => {
    const report = buildReport(profile(), null);

    expect(report.generator).toContain("NOVA Console");
    expect(report.standard).toBe("Agent 验证核心标准 v1.0");
    expect(report.agent).toEqual({
      id: "agt-local-research",
      name: "NOVA-RESEARCH",
      codename: "深度调研员",
      model: "nova-research-agent",
      version: "v0.1.0",
    });
    expect(report.verdict).toEqual({
      compositeScore: 76.5,
      grade: "B",
      certificateId: "NOVA-CERT-2026-0007",
    });
    expect(report.lifecycle).toEqual([]);
  });

  it("传入运行记录时生命周期镜像各阶段", () => {
    const report = buildReport(profile(), run());

    expect(report.lifecycle).toEqual([
      {
        stage: "lint",
        state: "passed",
        durationMs: 12,
        summary: "静态校验通过",
      },
      {
        stage: "execution",
        state: "passed",
        durationMs: 1_800,
        summary: "执行完成",
      },
    ]);
  });

  it("没有证书编号时不生成证书对象", () => {
    expect(buildCertificate(profile({ certificateId: null }))).toBeNull();
  });

  it("证书校验码稳定：同一档案两次生成一致，版本变化则不同", () => {
    const agent = profile();
    const first = buildCertificate(agent);
    const second = buildCertificate(agent);
    const upgraded = buildCertificate(profile({ version: "v0.2.0" }));

    expect(first?.checksum).toMatch(/^[0-9A-F]{8}$/);
    expect(second?.checksum).toBe(first?.checksum);
    expect(upgraded?.checksum).not.toBe(first?.checksum);
    expect(first?.vectorSnapshot).toEqual({
      autonomy: 90,
      toolUsage: 80,
      memory: 70,
      reasoning: 60,
    });
  });

  it("批量生成证书时过滤掉未发证档案", () => {
    const certificates = buildCertificates([
      profile(),
      profile({ id: "b", certificateId: null }),
    ]);

    expect(certificates).toHaveLength(1);
    expect(certificates[0].agentId).toBe("agt-local-research");
  });

  it("场景通过率：零分母记 0，其余保留一位小数", () => {
    expect(passRateOf(profile({ scenarios: { passed: 0, total: 0 } }))).toBe(0);
    expect(passRateOf(profile({ scenarios: { passed: 3, total: 4 } }))).toBe(
      75,
    );
    expect(passRateOf(profile({ scenarios: { passed: 1, total: 3 } }))).toBe(
      33.3,
    );
  });

  it("时间统一显示为北京时间，午夜使用 h23 不出现 24:00", () => {
    expect(formatDateTime("2026-10-30T10:00:00.000Z")).toBe(
      "2026-10-30 18:00:00",
    );
    expect(formatDateTime("2026-10-29T16:00:00.000Z")).toBe(
      "2026-10-30 00:00:00",
    );
    expect(formatTimestamp("2026-10-30T10:00:00.000Z")).toBe("10-30 18:00:00");
    expect(formatClock("2026-10-30T10:00:00.000Z")).toBe("18:00:00");
    expect(formatYear("2026-12-31T16:30:00.000Z")).toBe("2027");
  });

  it("得分语义分档的边界严格按 85 / 72", () => {
    expect(scoreTone(100)).toBe("high");
    expect(scoreTone(85)).toBe("high");
    expect(scoreTone(84.9)).toBe("mid");
    expect(scoreTone(72)).toBe("mid");
    expect(scoreTone(71.9)).toBe("low");
  });

  it("数值工具函数按四舍五入与固定精度工作", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-1, 0, 100)).toBe(0);
    expect(round(1.2345, 2)).toBe(1.23);
    expect(round(1.2355, 2)).toBe(1.24);
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1_500)).toBe("1.5s");
    expect(formatDelta(2.44)).toBe("+2.4");
    expect(formatDelta(-2.44)).toBe("−2.4");
    expect(formatDelta(0)).toBe("0.0");
  });
});
