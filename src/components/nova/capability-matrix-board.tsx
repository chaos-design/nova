"use client";

import { cn } from "cn";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  ACCENT_BAR_CLASS,
  ACCENT_TEXT,
  CAPABILITY_VECTORS,
  formatNumber,
  VECTOR_META,
} from "@/lib/nova";
import type {
  AgentProfile,
  CapabilityScore,
  CapabilityVectorId,
} from "@/lib/nova/types";

/** 触发一次向量复测的模拟耗时（毫秒） */
const TEST_DURATION_MS = 1_800;

/** 复测结果的确定性抖动：同一 Agent 的同一向量结果恒定，范围 ±1.5 分 */
function retestDelta(agentId: string, vector: CapabilityVectorId): number {
  const key = `${agentId}:${vector}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 1_000;
  }
  return ((hash % 31) - 15) / 10;
}

/**
 * 能力测试矩阵。
 *
 * 交互模型刻意做成"点哪一格就复测哪一格"：
 * 矩阵本身就是评测量表的二维投影，复测结果直接落回原位，
 * 不需要额外的选择-提交-查询往返。
 */
export function CapabilityMatrixBoard({
  agents,
  baseline,
}: {
  agents: readonly AgentProfile[];
  /** 集群平均得分，作为雷达图的对照基线 */
  baseline: readonly CapabilityScore[];
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [retests, setRetests] = useState<Record<string, number>>({});
  const [focusId, setFocusId] = useState(agents[0]?.id ?? "");
  const timer = useRef<number | null>(null);

  // 组件卸载时清掉待触发的复测定时器
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const focusAgent = useMemo(
    () => agents.find((agent) => agent.id === focusId) ?? agents[0],
    [agents, focusId],
  );

  const triggerTest = (agent: AgentProfile, vector: CapabilityVectorId) => {
    const key = `${agent.id}:${vector}`;
    if (running) return;

    setRunning(key);
    timer.current = window.setTimeout(() => {
      setRetests((prev) => ({ ...prev, [key]: retestDelta(agent.id, vector) }));
      setRunning(null);
      timer.current = null;
    }, TEST_DURATION_MS);
  };

  const resetRetests = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setRunning(null);
    setRetests({});
  };

  const resolved = (agent: AgentProfile): CapabilityScore[] =>
    agent.capabilities.map((item) => {
      const key = `${agent.id}:${item.vector}`;
      const delta = retests[key];
      return delta === undefined
        ? item
        : {
            ...item,
            score: Math.round((item.score + delta) * 10) / 10,
            delta: Math.round((item.delta + delta) * 10) / 10,
          };
    });

  const runningCount = Object.keys(retests).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>测试矩阵</CardTitle>
          <CardDescription>
            行 = Agent，列 = 能力向量 · 点击任意单元格触发该向量的定向复测
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={resetRetests}
              disabled={!runningCount && !running}
            >
              <RotateCcw />
              清除复测
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
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
                {agents.map((agent) => {
                  const scores = resolved(agent);

                  return (
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

                      {scores.map((item) => {
                        const meta = VECTOR_META[item.vector];
                        const key = `${agent.id}:${item.vector}`;
                        const active = running === key;
                        const retested = retests[key] !== undefined;

                        return (
                          <td key={item.vector} className="p-0.5">
                            <button
                              type="button"
                              onClick={() => triggerTest(agent, item.vector)}
                              disabled={running !== null && !active}
                              aria-label={`复测 ${agent.name} 的${meta.label}得分`}
                              className={cn(
                                "relative w-full rounded-lg border px-3 py-2 text-left transition-all",
                                "border-transparent hover:border-nova-cyan/30 hover:bg-nova-cyan/4",
                                active &&
                                  "animate-nova-pulse border-nova-cyan/50 bg-nova-cyan/8",
                                "disabled:opacity-50",
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
                                {active && (
                                  <Loader2 className="size-3.5 animate-spin text-nova-cyan" />
                                )}
                                {!active && retested && (
                                  <span className="font-mono text-[0.625rem] text-nova-cyan">
                                    复测
                                  </span>
                                )}
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
                            </button>
                          </td>
                        );
                      })}

                      <td className="px-3 py-2 text-right">
                        <span className="font-mono text-sm font-semibold tabular-nums text-nova-starlight">
                          {formatNumber(agent.compositeScore, 1)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                {running ? "复测进行中" : `已复测 ${runningCount} 项`}
              </Badge>
            </CardAction>
          </CardHeader>

          <CardContent className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <CapabilityRadar
              capabilities={resolved(focusAgent)}
              compare={baseline}
            />
            <ScoreBreakdown capabilities={resolved(focusAgent)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
