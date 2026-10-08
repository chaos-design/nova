import { Boxes, ServerCog } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentCard } from "@/components/nova/agent-card";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { AgentOnboardingDialog } from "@/components/nova/agent-onboarding-dialog";
import { LocalAgentCard } from "@/components/nova/local-agent-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ENVIRONMENTS,
  formatNumber,
  formatTimestamp,
  LOCAL_AGENTS,
} from "@/lib/nova";
import { listRuns, verifiedAgents } from "@/lib/nova/run-store";
import type { AgentStatus, EnvironmentId } from "@/lib/nova/types";

export const metadata: Metadata = {
  title: "Agent 注册表",
  description: "NOVA 沙盒内已接入的 Agent 档案、验证状态与最近运行记录。",
};

/** 注册表读运行时落库的真实结果，必须按请求渲染 */
export const dynamic = "force-dynamic";

/** 状态统计口径 */
const STATUS_LABELS: Record<AgentStatus, string> = {
  verified: "已验证",
  testing: "验证中",
  queued: "排队中",
  regression: "回归异常",
};

const ENVIRONMENT_LABELS: Record<EnvironmentId, string> = Object.fromEntries(
  ENVIRONMENTS.map((item) => [item.id, item.label]),
) as Record<EnvironmentId, string>;

/** Agent 注册表。 */
export default async function AgentsPage() {
  const [agents, runs] = await Promise.all([verifiedAgents(), listRuns()]);

  const counts = agents.reduce<Record<AgentStatus, number>>(
    (acc, agent) => {
      acc[agent.status] += 1;
      return acc;
    },
    { verified: 0, testing: 0, queued: 0, regression: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent Registry"
        title="Agent 注册表"
        subtitle="登记在这里的 Agent 才能被投放。跑完一次沙盒验证后，它会拿到真实评分、进入排行榜与能力矩阵。"
        actions={<AgentOnboardingDialog />}
      />

      <Card>
        <CardHeader>
          <CardTitle>接入概览</CardTitle>
          <CardDescription>
            登记 {LOCAL_AGENTS.length} 个 · 已产生评分 {agents.length} 个
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(STATUS_LABELS) as AgentStatus[]).map((status) => (
            <div key={status} className="nova-panel rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                {STATUS_LABELS[status]}
              </p>
              <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-nova-starlight">
                {counts[status]}
              </p>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground/70">
                占比{" "}
                {agents.length === 0
                  ? "—"
                  : `${formatNumber((counts[status] / agents.length) * 100, 0)}%`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {agents.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>已验证档案</CardTitle>
            <CardDescription>还没有 Agent 跑完过完整验证</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              档案不是预置的：先在下方登记一个本地 Agent，到沙盒跑一次真实执行，
              这里就会出现它的档案卡。
            </p>
          </CardContent>
        </Card>
      )}

      <Card id="local-agents" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="size-4 text-nova-accent" />
            本地接入
          </CardTitle>
          <CardDescription>
            登记在{" "}
            <code className="font-mono text-nova-accent/80">
              src/lib/nova/local-agents.ts
            </code>{" "}
            的本地 Agent。未跑完验证前没有评分，因此不进入排行榜与能力矩阵。
            如何在本地开发 Agent 再接入？见{" "}
            <code className="font-mono text-nova-accent/80">
              docs/local-agent.md
            </code>
            。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {LOCAL_AGENTS.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {LOCAL_AGENTS.map((agent) => (
                <LocalAgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                还没有本地 Agent。点右上角「接入新
                Agent」按三步走：确认端点、登记档案、落地配置。
              </p>
              <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground/80">
                <li>
                  1 · 起一个 OpenAI 兼容端点（Ollama / vLLM / LM Studio），
                  必须支持 function
                  calling；也可以直接跑仓库自带的零依赖执行体：
                  <code className="font-mono">
                    {" "}
                    node examples/local-agent/nova-agent.mjs
                  </code>
                </li>
                <li>
                  2 · 把 <code className="font-mono">LLM_API_KEY</code> 写进{" "}
                  <code className="font-mono">.env.local</code>
                </li>
                <li>
                  3 · 往 <code className="font-mono">LOCAL_AGENTS</code>{" "}
                  追加一条登记，重启开发服务器后它就会出现在这里
                </li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-nova-violet" />
            最近的验证运行
          </CardTitle>
          <CardDescription>
            按开始时间倒序 · 共 {runs.length} 条记录
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有运行记录。投放一次沙盒验证后，这里会按时间倒序列出每一次真实运行。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>运行编号</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>环境</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead className="text-right">综合评分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const agent = agents.find((item) => item.id === run.agentId);

                  return (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs text-nova-cyan">
                        {run.id}
                      </TableCell>
                      <TableCell>
                        {agent ? (
                          <AgentIdentity agent={agent} />
                        ) : (
                          <span className="text-sm">{run.agentId}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ENVIRONMENT_LABELS[run.environment]}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatTimestamp(run.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {`${formatNumber(run.durationMs / 1_000, 1)}s`}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {run.compositeScore > 0 ? run.compositeScore : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
