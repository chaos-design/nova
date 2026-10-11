import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SandboxPlayground } from "@/components/nova/sandbox-playground";
import {
  CHAOS_KINDS,
  DEFAULT_SANDBOX_CONFIG,
  ENVIRONMENTS,
  LOCAL_AGENTS,
  localAgentProfile,
} from "@/lib/nova";

export const metadata: Metadata = {
  title: "沙盒模拟器",
  description:
    "自定义系统提示词、注入混沌故障并实时观察 Agent 的自我纠错过程。沙盒只走真实执行：结果由被测 Agent 的真实行为决定。",
};

/** 可投放的 Agent 由本地登记派生，读的是运行时登记，按请求渲染 */
export const dynamic = "force-dynamic";

/**
 * 沙盒模拟器（Sandbox Simulator）。
 *
 * 页面本身只做取数与说明，真正的交互（配置 → 执行 → 事件流）
 * 全部收敛在 `SandboxPlayground` 这一个客户端组件里。
 */
export default function SandboxPage() {
  const agents = LOCAL_AGENTS.map(localAgentProfile);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sandbox Simulator"
        title="沙盒模拟器"
        subtitle="选定 Agent、写下系统提示词、注入网络延迟或畸形载荷，然后观察它如何在失败中自我纠正。沙盒只保留真实执行一条路径：分数由被测 Agent 的真实行为算出，可横向对照。"
      />

      <SandboxPlayground agents={agents} localAgents={LOCAL_AGENTS} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="nova-panel rounded-xl p-4 lg:col-span-2">
          <h2 className="font-heading text-base font-medium text-nova-starlight">
            可注入的混沌类型
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            每一类故障都有独立的基准代价；注入强度会被当前环境的 chaos ceiling
            二次裁剪，实际生效值在配置面板中实时显示。
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {CHAOS_KINDS.map((item) => (
              <li
                key={item.kind}
                className="rounded-lg border border-white/8 bg-white/2 px-3 py-2"
              >
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
                <p className="mt-1 font-mono text-[0.625rem] text-nova-violet">
                  最小间隔 {item.spacing} 步
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="nova-panel rounded-xl p-4">
          <h2 className="font-heading text-base font-medium text-nova-starlight">
            三类测试环境
          </h2>
          <ul className="mt-3 space-y-2">
            {ENVIRONMENTS.map((item) => (
              <li key={item.id} className="rounded-lg bg-white/3 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.label}</p>
                  <span className="font-mono text-[0.625rem] text-nova-cyan">
                    上限 {Math.round(item.chaosCeiling * 100)}%
                  </span>
                </div>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
            默认配置：
            {
              ENVIRONMENTS.find(
                (item) => item.id === DEFAULT_SANDBOX_CONFIG.environment,
              )?.label
            }
            ，最大 {DEFAULT_SANDBOX_CONFIG.maxSteps} 步。
          </p>
        </div>
      </div>
    </div>
  );
}
