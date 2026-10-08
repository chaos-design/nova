import { AppShell } from "@/components/layout/app-shell";
import { verifiedAgents } from "@/lib/nova/run-store";

/**
 * `(nova)` 路由组共享控制台外壳。
 *
 * 外壳需要 Agent 名单来喂全局搜索，而名单来自运行时落库的真实结果，
 * 因此这里按请求取数并注入客户端外壳（外壳本身不直接读存储）。
 */
export default async function NovaLayout({ children }: LayoutProps<"/">) {
  const agents = await verifiedAgents();

  return <AppShell agents={agents}>{children}</AppShell>;
}
