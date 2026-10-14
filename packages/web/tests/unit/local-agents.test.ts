import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_AGENTS } from "@/lib/nova";

/**
 * 登记表的 e2e 门控测试（local-agents.ts 的 E2E_AGENTS）。
 *
 * 离线执行体 nova-local 只允许出现在 NOVA_E2E=1 的进程里：
 * 正常启动（用户 dev server / 生产构建）登记表必须没有它，
 * 端到端验证进程则靠它走通「探测 → 沙盒 → 落库」全链路。
 *
 * 登记在模块求值时读取环境变量，因此这里用 resetModules +
 * 动态 import 让每个用例拿到按当前 env 求值的新模块。
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("LOCAL_AGENTS 的 e2e 门控", () => {
  it("正常启动（未设 NOVA_E2E）：登记表不含离线执行体", async () => {
    vi.stubEnv("NOVA_E2E", "");
    vi.resetModules();
    const { LOCAL_AGENTS: withoutE2E } = await import("@/lib/nova");

    expect(LOCAL_AGENTS.every((item) => item.id !== "agt-local-nova")).toBe(
      true,
    );
    expect(withoutE2E.every((item) => item.id !== "agt-local-nova")).toBe(true);
  });

  it("NOVA_E2E=1：登记表注入离线执行体，端点与模型指向 nova-local", async () => {
    vi.stubEnv("NOVA_E2E", "1");
    vi.resetModules();
    const { LOCAL_AGENTS: withE2E } = await import("@/lib/nova");

    const e2eEntry = withE2E.find((item) => item.id === "agt-local-nova");
    expect(e2eEntry).toBeDefined();
    expect(e2eEntry?.model).toBe("nova-local-agent");
    expect(e2eEntry?.endpoint).toBe("http://127.0.0.1:43110/v1");
    expect(e2eEntry?.codename).toBe("离线执行体");
  });

  it("静态导入（模块随测试进程求值，env 未设）与正常启动一致", () => {
    expect(LOCAL_AGENTS.every((item) => item.id !== "agt-local-nova")).toBe(
      true,
    );
  });

  it("其余登记不受门控影响：两个领域 Agent 条目恒在", async () => {
    const ids = LOCAL_AGENTS.map((item) => item.id);
    for (const id of ["agt-local-travel", "agt-local-writer"]) {
      expect(ids).toContain(id);
    }
  });

  it("登记表只收真实大模型端点：裸模型与离线执行体都不在", () => {
    const ids = LOCAL_AGENTS.map((item) => item.id);

    // 裸模型端点（无领域人格 / 无工具）与规则执行体都不该出现在登记表里
    for (const id of [
      "agt-local-llm",
      "agt-local-agnes-25",
      "agt-local-nova",
    ]) {
      expect(ids).not.toContain(id);
    }
  });
});
