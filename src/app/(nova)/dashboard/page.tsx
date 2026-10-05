import { Activity, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { GradeChip } from "@/components/nova/grade-chip";
import { LiveLogTerminal } from "@/components/nova/live-log-terminal";
import { TelemetryHub } from "@/components/nova/telemetry-hub";
import { VerificationStepper } from "@/components/nova/verification-stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ACCENT_TEXT,
  AGENTS_BY_SCORE,
  agentById,
  CLUSTER_STATS,
  formatDelta,
  LIFECYCLE_FLOW,
  NOVA_BRAND,
  TELEMETRY_SEED,
  VERIFICATION_RUNS,
} from "@/lib/nova";

/**
 * 遥测中枢（Telemetry Hub）。
 *
 * 服务端负责取数与首屏渲染（遥测种子、验证运行、Agent 快照），
 * 只有真正需要时间推进的部分（遥测流、事件总线）进入客户端边界。
 */
export default function DashboardPage() {
  const runningRun =
    VERIFICATION_RUNS.find((run) => run.finishedAt === null) ??
    VERIFICATION_RUNS[0];
  const topAgents = AGENTS_BY_SCORE.slice(0, 4);
  const latest = TELEMETRY_SEED[TELEMETRY_SEED.length - 1];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Telemetry Hub"
        title="遥测中枢"
        subtitle="汇总全集群的验证进度、实时性能与事件流。所有指标由遥测中枢每 2 秒聚合一次，异常会直接反映在混沌事件计数上。"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/sandbox">
                投放沙盒
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild>
              <Link href="/matrix">
                <Sparkles data-icon="inline-start" />
                发起能力复测
              </Link>
            </Button>
          </>
        }
      />

      {/* 集群概览 */}
      <Card>
        <CardHeader>
          <CardTitle>集群概览</CardTitle>
          <CardDescription>距演示锚点 · {NOVA_BRAND.standard}</CardDescription>
          <CardAction>
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-nova-cyan">
              <Activity className="size-3 animate-nova-blink" />
              STREAMING
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CLUSTER_STATS.map((stat) => (
            <div key={stat.id} className="nova-panel rounded-lg p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {stat.label}
                </span>
                <span
                  className={`font-mono text-xs tabular-nums ${
                    stat.delta >= 0 ? "text-nova-cyan" : "text-nova-rose"
                  }`}
                >
                  {formatDelta(stat.delta, 0)}
                </span>
              </div>
              <p className="mt-1.5 flex items-baseline gap-1">
                <span
                  className={`font-mono text-2xl font-semibold tabular-nums ${ACCENT_TEXT[stat.accent]}`}
                >
                  {stat.value}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {stat.unit}
                </span>
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 遥测 KPI 与曲线 */}
      <TelemetryHub seed={TELEMETRY_SEED} />

      {/* 当前验证流水线 + 事件流 */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <CardHeader>
            <CardTitle>当前验证流水线</CardTitle>
            <CardDescription>
              {agentById(runningRun.agentId).name} · {runningRun.id} ·{" "}
              {runningRun.environment === "stochastic"
                ? "随机环境"
                : runningRun.environment === "arena"
                  ? "多智能体竞技场"
                  : "确定性环境"}
            </CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono text-[0.625rem]">
                {runningRun.finishedAt === null ? "运行中" : "已归档"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <VerificationStepper run={runningRun} />

            <div className="nova-panel rounded-lg p-3">
              <p className="nova-mono-label text-muted-foreground">
                生命周期流程
              </p>
              <p className="mt-2 font-mono text-xs leading-relaxed text-nova-cyan/85">
                {LIFECYCLE_FLOW}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {runningRun.notes}。最新遥测采样点：任务成功率{" "}
                {latest.successRate}% · 响应延迟 {latest.latencyMs}ms · 记忆占用{" "}
                {latest.memoryUtilization}%。
              </p>
            </div>
          </CardContent>
        </Card>

        <LiveLogTerminal runs={VERIFICATION_RUNS} />
      </div>

      {/* 榜首快照 */}
      <Card>
        <CardHeader>
          <CardTitle>综合评分 TOP 4</CardTitle>
          <CardDescription>
            按 NOVA 综合评分排序 · 完整榜单见排行榜页
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/leaderboard">
                查看完整榜单
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {topAgents.map((agent, index) => (
            <Link
              key={agent.id}
              href="/leaderboard"
              className="nova-panel group rounded-lg p-3 transition-colors hover:border-nova-cyan/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="nova-mono-label text-muted-foreground">
                  RANK {String(index + 1).padStart(2, "0")}
                </span>
                <GradeChip grade={agent.grade} />
              </div>
              <AgentIdentity agent={agent} className="mt-3" />
              <p className="mt-3 flex items-baseline gap-1">
                <span className="font-mono text-2xl font-semibold tabular-nums text-nova-starlight">
                  {agent.compositeScore}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  / 100
                </span>
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
