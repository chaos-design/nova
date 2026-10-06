import { Boxes, ServerCog } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentCard } from "@/components/nova/agent-card";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { AgentOnboardingDialog } from "@/components/nova/agent-onboarding-dialog";
import { AgentStatusBadge } from "@/components/nova/agent-status-badge";
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
  AGENTS,
  ENVIRONMENTS,
  formatNumber,
  formatTimestamp,
  LOCAL_AGENTS,
  VERIFICATION_RUNS,
} from "@/lib/nova";
import type { AgentStatus, EnvironmentId } from "@/lib/nova/types";

export const metadata: Metadata = {
  title: "Agent 注册表",
  description: "NOVA 沙盒内已接入的 Agent 档案、验证状态与最近运行记录。",
};

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
export default function AgentsPage() {
  const counts = AGENTS.reduce<Record<AgentStatus, number>>(
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
        subtitle="所有进入 NOVA 沙盒的 Agent 都在这里登记：模型版本、能力向量画像、场景通过率与证书状态。接入即开始接受验证。"
        actions={<AgentOnboardingDialog />}
      />

      <Card>
        <CardHeader>
          <CardTitle>接入概览</CardTitle>
          <CardDescription>共 {AGENTS.length} 个已登记 Agent</CardDescription>
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
                占比 {formatNumber((counts[status] / AGENTS.length) * 100, 0)}%
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

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
                Agent」按三步走：确认端点、登记档案、 落地配置。
              </p>
              <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground/80">
                <li>
                  1 · 起一个 OpenAI 兼容端点（Ollama / vLLM / LM Studio），
                  必须支持 function calling
                </li>
                <li>
                  2 · 把 <code className="font-mono">LLM_BASE_URL</code>、{" "}
                  <code className="font-mono">LLM_API_KEY</code>、{" "}
                  <code className="font-mono">LLM_MODEL</code> 写进{" "}
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
            按开始时间倒序 · 共 {VERIFICATION_RUNS.length} 条记录
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              {[...VERIFICATION_RUNS].reverse().map((run) => {
                const agent = AGENTS.find((item) => item.id === run.agentId);
                const finished = run.finishedAt
                  ? new Date(run.finishedAt).getTime() -
                    new Date(run.startedAt).getTime()
                  : null;

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
                      {finished === null ? (
                        <AgentStatusBadge status="testing" />
                      ) : (
                        `${formatNumber(finished / 1_000, 1)}s`
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {run.compositeScore > 0 ? run.compositeScore : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
