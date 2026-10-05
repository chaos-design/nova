"use client";

import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { VECTOR_META } from "@/lib/nova/constants";
import type { CapabilityScore } from "@/lib/nova/types";

/**
 * 能力雷达图。
 *
 * 四个轴对应 NOVA 标准里的四大能力向量；传入 `compare` 时叠加
 * 参照对象（例如集群均值），用于一眼看出短板。
 */
export function CapabilityRadar({
  capabilities,
  compare,
  compareLabel = "集群均值",
  className,
}: {
  capabilities: readonly CapabilityScore[];
  /** 可选的对照得分 */
  compare?: readonly CapabilityScore[];
  compareLabel?: string;
  className?: string;
}) {
  const data = useMemo(
    () =>
      capabilities.map((item) => {
        const meta = VECTOR_META[item.vector];
        const baseline = compare?.find((other) => other.vector === item.vector);

        return {
          vector: meta.id,
          label: meta.label,
          score: item.score,
          baseline: baseline?.score ?? 0,
          fullMark: 100,
        };
      }),
    [capabilities, compare],
  );

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: "rgba(235,240,255,0.75)", fontSize: 12 }}
          />
          <Radar
            name="基线"
            dataKey="baseline"
            stroke="var(--nova-violet)"
            strokeWidth={1}
            strokeDasharray="4 4"
            fill="var(--nova-violet)"
            fillOpacity={0.08}
            isAnimationActive={false}
          />
          <Radar
            name={compare ? "当前" : "得分"}
            dataKey="score"
            stroke="var(--nova-cyan)"
            strokeWidth={2}
            fill="var(--nova-cyan)"
            fillOpacity={0.22}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>

      {compare && (
        <p className="mt-1 text-center font-mono text-[0.6875rem] text-muted-foreground">
          <span className="text-nova-cyan">━ 当前</span>
          <span className="mx-3 text-nova-violet">┄ {compareLabel}</span>
        </p>
      )}
    </div>
  );
}
