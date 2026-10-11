import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { AgentStatusBadge } from "@/components/nova/agent-status-badge";
import { GradeChip } from "@/components/nova/grade-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import type { AgentProfile } from "@/lib/nova";
import {
  ACCENT_BAR_CLASS,
  ACCENT_TEXT,
  CAPABILITY_VECTORS,
  formatNumber,
  formatTimestamp,
  passRateOf,
} from "@/lib/nova";

/**
 * Agent 档案卡。
 *
 * 一张卡要回答三个问题：它是谁、它有多强、它现在处于什么状态。
 * 因此信息密度偏高，但按"身份 → 分数 → 向量 → 状态"顺序线性排列。
 */
export function AgentCard({ agent }: { agent: AgentProfile }) {
  const passRate = passRateOf(agent);

  return (
    <Card className="group h-full transition-colors hover:border-nova-cyan/25">
      <CardHeader>
        <AgentIdentity agent={agent} showOwner />
        <CardDescription className="mt-2 line-clamp-2 leading-relaxed">
          {agent.tagline}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="nova-mono-label text-muted-foreground">综合评分</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-3xl font-semibold tabular-nums text-nova-starlight">
                {formatNumber(agent.compositeScore, 1)}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                / 100
              </span>
            </p>
          </div>
          <div className="text-right">
            <GradeChip
              grade={agent.grade}
              score={agent.compositeScore}
              showHint
            />
            <p className="mt-1.5 font-mono text-[0.6875rem] text-muted-foreground">
              场景 {agent.scenarios.passed}/{agent.scenarios.total} ·{" "}
              {formatNumber(passRate, 1)}%
            </p>
          </div>
        </div>

        <ul className="space-y-1.5">
          {CAPABILITY_VECTORS.map((vector) => {
            const score = agent.capabilities.find(
              (item) => item.vector === vector.id,
            );

            return (
              <li key={vector.id} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[0.6875rem] text-muted-foreground">
                  {vector.label}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                  <span
                    className={`block h-full rounded-full ${ACCENT_BAR_CLASS[vector.accent]}`}
                    style={{
                      width: `${Math.min(Math.max(score?.score ?? 0, 0), 100)}%`,
                    }}
                  />
                </span>
                <span
                  className={`w-10 shrink-0 text-right font-mono text-[0.6875rem] tabular-nums ${ACCENT_TEXT[vector.accent]}`}
                >
                  {formatNumber(score?.score ?? 0, 1)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <CardFooter className="justify-between gap-2">
        <div className="min-w-0">
          <AgentStatusBadge status={agent.status} />
          <p className="mt-1.5 truncate text-[0.6875rem] text-muted-foreground">
            {agent.lastVerifiedAt
              ? `最近验证 ${formatTimestamp(agent.lastVerifiedAt)}`
              : "尚未完成验证"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {agent.certificateId && (
            <span
              className="inline-flex items-center gap-1 font-mono text-[0.625rem] text-nova-cyan"
              title={agent.certificateId}
            >
              <ShieldCheck className="size-3" />
              已发证
            </span>
          )}
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              href="/leaderboard"
              aria-label={`查看 ${agent.name} 的评分详情`}
            >
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
