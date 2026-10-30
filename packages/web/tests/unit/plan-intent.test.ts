import { describe, expect, it, vi } from "vitest";
import {
  type IntentCandidate,
  parseIntentOutput,
  resolveDispatchTarget,
  sanitizeIntentCandidates,
} from "@/lib/nova";

/**
 * [V-08] 意图解析与单发兜底。
 *
 * 对应 docs/agent-protocol.md §4.1。本任务含两条缺陷回归：
 * - D-01：候选 id 互为前缀时短 id 抢先命中；
 * - D-02：分类器返回候选外的 id 被原样透传。
 */

const CANDIDATES: IntentCandidate[] = [
  {
    id: "agt-local-research",
    name: "NOVA-RESEARCH",
    model: "nova-research-agent",
    description: "专职调研",
  },
  {
    id: "agt-local-coder",
    name: "NOVA-CODER",
    model: "nova-coder-agent",
    description: "专职工程实现",
  },
];

describe("[V-08] 意图解析与单发兜底", () => {
  it("精确等于 id 时直接命中", () => {
    const resolved = parseIntentOutput("agt-local-coder", CANDIDATES);
    expect(resolved).toMatchObject({
      agentId: "agt-local-coder",
      matchedBy: "id",
    });
  });

  it("id 前后带标点或大小写差异仍按 id 命中", () => {
    const resolved = parseIntentOutput(
      "结果：AGT-LOCAL-RESEARCH。",
      CANDIDATES,
    );
    expect(resolved?.agentId).toBe("agt-local-research");
    expect(resolved?.matchedBy).toBe("id");
  });

  it("模型回代号时按名称命中", () => {
    const resolved = parseIntentOutput("NOVA-CODER", CANDIDATES);
    expect(resolved).toMatchObject({
      agentId: "agt-local-coder",
      matchedBy: "name",
    });
  });

  it("模型 id 含名称前缀时按名称命中", () => {
    const resolved = parseIntentOutput("nova-research-agent", CANDIDATES);
    expect(resolved?.matchedBy).toBe("name");
    expect(resolved?.agentId).toBe("agt-local-research");
  });

  it("D-01 回归：候选 id 互为前缀时取更长的那个", () => {
    const tricky: IntentCandidate[] = [
      { id: "agt-local-a", name: "A" },
      { id: "agt-local-ab", name: "AB" },
    ];
    const resolved = parseIntentOutput("路由结果：agt-local-ab。", tricky);

    expect(resolved?.agentId).toBe("agt-local-ab");
    expect(resolved?.matchedBy).toBe("id");
  });

  it("D-01 回归：名称互为前缀时同样取更长者", () => {
    const tricky: IntentCandidate[] = [
      { id: "agt-a", name: "NOVA-A" },
      { id: "agt-ab", name: "NOVA-AB" },
    ];
    const resolved = parseIntentOutput("选择 NOVA-AB", tricky);

    expect(resolved?.agentId).toBe("agt-ab");
    expect(resolved?.matchedBy).toBe("name");
  });

  it("无法解析时兜底首个候选，且只产生一个目标", () => {
    for (const output of ["", "   ", "我不知道", "<none>", "1"]) {
      const resolved = parseIntentOutput(output, CANDIDATES);
      expect(resolved?.agentId).toBe("agt-local-research");
      expect(resolved?.matchedBy).toBe("fallback");
      expect(resolved?.agentId).not.toContain(",");
    }
  });

  it("空候选返回 null，由调用方前置校验兜住", () => {
    expect(parseIntentOutput("agt-local-coder", [])).toBeNull();
  });

  it("单候选直落，不触发分类器（省一次模型调用）", async () => {
    const classify = vi.fn();
    const routed = await resolveDispatchTarget(
      "任意消息",
      [CANDIDATES[0]],
      classify,
    );

    expect(routed).toEqual({ agentId: "agt-local-research", fallback: false });
    expect(classify).not.toHaveBeenCalled();
  });

  it("多候选分类成功：采用候选内的结论", async () => {
    const routed = await resolveDispatchTarget(
      "帮我改 bug",
      CANDIDATES,
      async () => ({
        agentId: "agt-local-coder",
        output: "agt-local-coder",
        matchedBy: "id",
      }),
    );

    expect(routed).toEqual({ agentId: "agt-local-coder", fallback: false });
  });

  it("分类器抛错（含超时）：兜底首个候选并标注 fallback", async () => {
    const routed = await resolveDispatchTarget(
      "任意消息",
      CANDIDATES,
      async () => {
        throw new Error("分类超时");
      },
    );

    expect(routed).toEqual({ agentId: "agt-local-research", fallback: true });
  });

  it("D-02 回归：分类器返回候选外的 id 时兜底首个，不透传", async () => {
    const routed = await resolveDispatchTarget(
      "任意消息",
      CANDIDATES,
      async () => ({
        agentId: "agt-local-ghost",
        output: "agt-local-ghost",
        matchedBy: "id",
      }),
    );

    expect(routed).toEqual({ agentId: "agt-local-research", fallback: true });
    expect(CANDIDATES.map((item) => item.id)).toContain(routed.agentId);
  });

  it("候选整形：只有领域描述的条目也保留，超过 10 条截断", () => {
    const shaped = sanitizeIntentCandidates([
      { description: "只有领域" },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `a${index}`,
        name: `n${index}`,
      })),
    ]);

    expect(shaped).toHaveLength(10);
    expect(shaped[0].description).toBe("只有领域");
  });
});
