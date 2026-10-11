"use client";

import { cn } from "cn";
import { ArrowRight, FlaskConical } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { CapabilityRadar } from "@/components/nova/capability-radar";
import { ScoreBreakdown } from "@/components/nova/score-breakdown";
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
import type { AgentProfile, CapabilityScore } from "@/lib/nova";
import {
  ACCENT_BAR_CLASS,
  ACCENT_TEXT,
  CAPABILITY_VECTORS,
  compositeScore,
  formatNumber,
  VECTOR_META,
} from "@/lib/nova";

/**
 * 能力测试矩阵。
 *
 * 矩阵里的每个分数都是**已落库的真实结论**：点单元格不会"本地抖出一个新分数"，
 * 而是把你送到沙盒去真的再跑一次。定向复测的产物必须是一次真实运行，
 * 否则矩阵就变成了一个可以自己给自己改分的玩具。
 */
export function CapabilityMatrixBoard({
  agents,
  baseline,
}: {
  agents: readonly AgentProfile[];
  /** 集群平均得分，作为雷达图的对照基线 */
  baseline: readonly CapabilityScore[];
}) {
  const [focusId, setFocusId] = useState(agents[0]?.id ?? "");

  const focusAgent = useMemo(
    () => agents.find((agent) => agent.id === focusId) ?? agents[0],
    [agents, focusId],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>测试矩阵</CardTitle>
          <CardDescription>
            行 = Agent，列 = 能力向量 · 数值取自最近一次真实验证 ·
            点击单元格去沙盒复测
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link href="/sandbox">
                <FlaskConical />
                发起定向复测
              </Link>
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有 Agent
              跑出过评分。到沙盒投放一次真实执行，矩阵会立刻出现该行。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-3xl border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="nova-mono-label px-3 pb-1 font-normal text-muted-foreground">
                      Agent
                    </th>
                    {CAPABILITY_VECTORS.map((vector) => (
                      <th
                        key={vector.id}
                        className="nova-mono-label px-3 pb-1 font-normal text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-1.5 rounded-full",
                              ACCENT_BAR_CLASS[vector.accent],
                            )}
                          />
                          {vector.label}
                        </span>
                      </th>
                    ))}
                    <th className="nova-mono-label px-3 pb-1 text-right font-normal text-muted-foreground">
                      综合
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id} className="group">
                      <th
                        scope="row"
                        className="px-3 py-1 text-left font-normal"
                      >
                        <button
                          type="button"
                          onClick={() => setFocusId(agent.id)}
                          className={cn(
                            "w-full rounded-lg px-1 py-1 text-left transition-colors",
                            focusId === agent.id && "bg-nova-cyan/6",
                          )}
                        >
                          <AgentIdentity agent={agent} />
                        </button>
                      </th>

                      {agent.capabilities.map((item) => {
                        const meta = VECTOR_META[item.vector];

                        return (
                          <td key={item.vector} className="p-0.5">
                            <Link
                              href="/sandbox"
                              aria-label={`到沙盒复测 ${agent.name} 的${meta.label}得分`}
                              className={cn(
                                "relative block w-full rounded-lg border px-3 py-2 text-left transition-all",
                                "border-transparent hover:border-nova-cyan/30 hover:bg-nova-cyan/4",
                              )}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span
                                  className={cn(
                                    "font-mono text-sm tabular-nums",
                                    ACCENT_TEXT[meta.accent],
                                  )}
                                >
                                  {formatNumber(item.score, 1)}
                                </span>
                                <ArrowRight className="size-3.5 text-muted-foreground/50" />
                              </span>

                              <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-white/8">
                                <span
                                  className={cn(
                                    "block h-full rounded-full",
                                    ACCENT_BAR_CLASS[meta.accent],
                                  )}
                                  style={{
                                    width: `${Math.min(Math.max(item.score, 0), 100)}%`,
                                  }}
                                />
                              </span>
                            </Link>
                          </td>
                        );
                      })}

                      <td className="px-3 py-2 text-right">
                        <span className="font-mono text-sm font-semibold tabular-nums text-nova-starlight">
                          {formatNumber(compositeScore(agent.capabilities), 1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {focusAgent && (
        <Card>
          <CardHeader>
            <CardTitle>向量拆解 · {focusAgent.name}</CardTitle>
            <CardDescription>
              雷达图实线为当前得分，虚线为集群平均（{baseline.length} 个样本）
            </CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono text-[0.625rem]">
                {focusAgent.grade} ·{" "}
                {formatNumber(focusAgent.compositeScore, 1)}
              </Badge>
            </CardAction>
          </CardHeader>

          <CardContent className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <CapabilityRadar
              capabilities={focusAgent.capabilities}
              compare={baseline}
            />
            <ScoreBreakdown capabilities={focusAgent.capabilities} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
