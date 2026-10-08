import { Activity, ArrowRight, FlaskConical, Sparkles } from "lucide-react";
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
  formatDelta,
  LIFECYCLE_FLOW,
  NOVA_BRAND,
} from "@/lib/nova";
import {
  clusterStats,
  listRuns,
  telemetrySeries,
  verifiedAgents,
} from "@/lib/nova/run-store";

/**
 * 遥测中枢（Telemetry Hub）。
 *
 * 每个数字都来自本地真实跑完的沙盒验证（`.nova/runs.json`）。
 * 一次都没跑过时页面如实给出空态，而不是拿一份预置数据把界面填满。
 * 因为读的是运行时文件，本页必须按请求渲染。
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [runs, agents, stats, telemetry] = await Promise.all([
    listRuns(),
    verifiedAgents(),
    clusterStats(),
    telemetrySeries(),
  ]);

  const latestRun = runs[0] ?? null;
  const latestAgent = latestRun
    ? agents.find((agent) => agent.id === latestRun.agentId)
    : undefined;
  const topAgents = agents.slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Telemetry Hub"
        title="遥测中枢"
        subtitle="汇总本机的验证进度、实测性能与事件流。所有指标由真实运行记录派生，混沌事件计数随注入次数累加。"
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
          <CardDescription>
            数据源：本地真实运行记录 · {NOVA_BRAND.standard}
          </CardDescription>
          <CardAction>
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-nova-cyan">
              <Activity className="size-3 animate-nova-blink" />
              {runs.length > 0 ? "RECORDING" : "IDLE"}
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
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
      <TelemetryHub points={telemetry} />

      {/* 最近一次验证流水线 + 事件流 */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <CardHeader>
            <CardTitle>最近一次验证流水线</CardTitle>
            <CardDescription>
              {latestRun
                ? `${latestAgent?.name ?? latestRun.agentId} · ${latestRun.id}`
                : "尚无运行记录"}
            </CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono text-[0.625rem]">
                {latestRun ? "已归档" : "待投放"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {latestRun ? (
              <VerificationStepper run={latestRun} />
            ) : (
              <div className="nova-panel rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  还没有任何验证运行。到沙盒里投放一次，这里就会显示那条
                  真实跑出来的流水线。
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/sandbox">
                    <FlaskConical data-icon="inline-start" />
                    去沙盒投放
                  </Link>
                </Button>
              </div>
            )}

            <div className="nova-panel rounded-lg p-3">
              <p className="nova-mono-label text-muted-foreground">
                生命周期流程
              </p>
              <p className="mt-2 font-mono text-xs leading-relaxed text-nova-cyan/85">
                {LIFECYCLE_FLOW}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {latestRun
                  ? latestRun.notes
                  : "流水线由真实执行器驱动：接入 → 静态校验 → 场景执行 → 爆发评估 → 证书判定。"}
              </p>
            </div>
          </CardContent>
        </Card>

        <LiveLogTerminal runs={runs} />
      </div>

      {/* 榜首快照 */}
      <Card>
        <CardHeader>
          <CardTitle>综合评分 TOP 4</CardTitle>
          <CardDescription>
            按 NOVA 综合评分排序 · 仅收录已跑出真实结果的 Agent
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
        <CardContent>
          {topAgents.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              还没有 Agent 跑出评分。排行榜在第一次真实验证完成后才会出现。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
