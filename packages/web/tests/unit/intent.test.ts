import { describe, expect, it, vi } from "vitest";
import {
  buildIntentPrompt,
  INTENT_DESCRIPTION_MAX_CHARS,
  INTENT_MAX_AGENTS,
  INTENT_MAX_TEXT_CHARS,
  type IntentCandidate,
  parseIntentOutput,
  resolveDispatchTarget,
  sanitizeIntentCandidates,
} from "@/lib/nova";

/**
 * 意图分类领域层测试，对应 docs/agent-protocol.md 的分发语义：
 * 解析逐级放宽（id → 名称 → 兜底首个候选）、兜底单发绝不广播。
 */

const CANDIDATES: IntentCandidate[] = [
  {
    id: "agt-local-research",
    name: "NOVA-RESEARCH",
    model: "nova-research-agent",
    description: "专职调研：多侧面检索、交叉验证与数据缺口分析",
  },
  {
    id: "agt-local-coder",
    name: "NOVA-CODER",
    model: "nova-coder-agent",
    description: "专职工程实现：编码、调试与脚本验证",
  },
];

describe("parseIntentOutput", () => {
  it("id 原文命中：输出即候选 id", () => {
    const resolved = parseIntentOutput("agt-local-coder", CANDIDATES);
    expect(resolved).toMatchObject({
      agentId: "agt-local-coder",
      matchedBy: "id",
    });
  });

  it("id 命中不区分大小写，且容忍模型附带解释文字", () => {
    const resolved = parseIntentOutput(
      "最合适的是 AGT-LOCAL-RESEARCH。",
      CANDIDATES,
    );
    expect(resolved?.matchedBy).toBe("id");
    expect(resolved?.agentId).toBe("agt-local-research");
  });

  it("名称命中：模型回代号也能定位", () => {
    const resolved = parseIntentOutput("NOVA-CODER", CANDIDATES);
    expect(resolved).toMatchObject({
      agentId: "agt-local-coder",
      matchedBy: "name",
    });
  });

  it("模型 id 含名称前缀时按名称命中（不区分大小写）", () => {
    const resolved = parseIntentOutput("nova-research-agent", CANDIDATES);
    expect(resolved?.matchedBy).toBe("name");
    expect(resolved?.agentId).toBe("agt-local-research");
  });

  it("兜底：输出无法解析时落第一个候选，且单发不广播", () => {
    for (const output of ["", "   ", "我不知道", "<none>", "1"]) {
      const resolved = parseIntentOutput(output, CANDIDATES);
      expect(resolved).not.toBeNull();
      expect(resolved?.matchedBy).toBe("fallback");
      expect(resolved?.agentId).toBe("agt-local-research");
      // 单发语义：一次解析只产生一个目标
      expect(String(resolved?.agentId)).not.toContain(",");
    }
  });

  it("候选为空返回 null，由调用方前置校验兜住", () => {
    expect(parseIntentOutput("agt-local-research", [])).toBeNull();
  });

  it("名称相同 id 优先：id 判级先于名称", () => {
    const tricky: IntentCandidate[] = [
      { id: "agt-local-a", name: "shared" },
      { id: "agt-local-b", name: "shared" },
    ];
    const resolved = parseIntentOutput("shared agt-local-b", tricky);
    expect(resolved?.matchedBy).toBe("id");
    expect(resolved?.agentId).toBe("agt-local-b");
  });
});

describe("sanitizeIntentCandidates", () => {
  it("截断超长字段并保留合法条目", () => {
    const shaped = sanitizeIntentCandidates([
      {
        id: "agt-local-research",
        name: "NOVA-RESEARCH",
        model: "nova-research-agent",
        description: "领".repeat(500),
      },
    ]);
    expect(shaped).toHaveLength(1);
    expect(shaped[0].description).toHaveLength(INTENT_DESCRIPTION_MAX_CHARS);
    expect(shaped[0].model).toBe("nova-research-agent");
  });

  it("丢弃没有 name/model/description 的条目", () => {
    const shaped = sanitizeIntentCandidates([
      { id: "empty" },
      { id: "agt-local-coder", name: "NOVA-CODER" },
    ]);
    expect(shaped).toHaveLength(1);
    expect(shaped[0].id).toBe("agt-local-coder");
  });

  it("id 缺失或空白时补默认 id，不抛错", () => {
    const shaped = sanitizeIntentCandidates([
      { name: "NOVA-RESEARCH" },
      { id: "   ", model: "m" },
    ]);
    expect(shaped.map((item) => item.id)).toEqual(["agent-0", "agent-1"]);
  });

  it("候选数量钳到上限", () => {
    const shaped = sanitizeIntentCandidates(
      Array.from({ length: 30 }, (_, index) => ({
        id: `a${index}`,
        name: `n${index}`,
      })),
    );
    expect(shaped).toHaveLength(INTENT_MAX_AGENTS);
  });

  it("非数组输入返回空数组", () => {
    expect(sanitizeIntentCandidates(undefined)).toEqual([]);
    expect(sanitizeIntentCandidates("agents")).toEqual([]);
    expect(sanitizeIntentCandidates({ id: "agt-local-coder" })).toEqual([]);
  });
});

describe("buildIntentPrompt", () => {
  it("领域描述进入候选清单，系统侧写明按领域匹配与兜底规则", () => {
    const prompt = buildIntentPrompt("帮我调研可观测性", CANDIDATES);
    expect(prompt.user).toContain("领域：专职调研");
    expect(prompt.user).toContain("领域：专职工程实现");
    expect(prompt.system).toContain("优先按领域匹配");
    expect(prompt.system).toContain("没有任何领域匹配时选第一个");
    expect(prompt.system).toContain("只输出该 Agent 的 id 原文");
  });

  it("无领域描述时候选行退化为 id + 名称 + 模型", () => {
    const prompt = buildIntentPrompt("任意消息", [
      { id: "agt-local-coder", name: "NOVA-CODER", model: "nova-coder-agent" },
    ]);
    expect(prompt.user).toContain(
      "id=agt-local-coder 名称=NOVA-CODER 模型=nova-coder-agent",
    );
    expect(prompt.user).not.toContain("领域：");
  });

  it("用户消息钳到长度上限", () => {
    const prompt = buildIntentPrompt(
      "字".repeat(INTENT_MAX_TEXT_CHARS + 100),
      CANDIDATES,
    );
    const messageLine = prompt.user.split("用户消息：")[1] ?? "";
    expect(messageLine.startsWith("字".repeat(INTENT_MAX_TEXT_CHARS))).toBe(
      true,
    );
    expect(messageLine.length).toBeLessThan(INTENT_MAX_TEXT_CHARS + 100);
  });
});

describe("resolveDispatchTarget", () => {
  it("单候选直落：不调用分类器，省一次模型调用", async () => {
    const classify = vi.fn();
    const routed = await resolveDispatchTarget(
      "任意消息",
      [CANDIDATES[0]],
      classify,
    );

    expect(routed).toEqual({ agentId: "agt-local-research", fallback: false });
    expect(classify).not.toHaveBeenCalled();
  });

  it("多候选分类成功：采用分类器的结论且不标注 fallback", async () => {
    const classify = vi.fn(async () => ({
      agentId: "agt-local-coder",
      output: "agt-local-coder",
      matchedBy: "id" as const,
    }));
    const routed = await resolveDispatchTarget(
      "帮我改 bug",
      CANDIDATES,
      classify,
    );

    expect(routed).toEqual({ agentId: "agt-local-coder", fallback: false });
    expect(classify).toHaveBeenCalledWith("帮我改 bug", CANDIDATES);
  });

  it("分类失败（含超时）：兜底单发首个候选并标注 fallback，绝不广播", async () => {
    const classify = vi.fn(async () => {
      throw new Error("无法连接模型服务");
    });
    const routed = await resolveDispatchTarget(
      "任意消息",
      CANDIDATES,
      classify,
    );

    expect(routed).toEqual({ agentId: "agt-local-research", fallback: true });
  });

  it("兜底结论始终落在候选清单内", async () => {
    const routed = await resolveDispatchTarget(
      "任意消息",
      CANDIDATES,
      async () => {
        throw new Error("boom");
      },
    );

    expect(CANDIDATES.map((item) => item.id)).toContain(routed.agentId);
  });
});
