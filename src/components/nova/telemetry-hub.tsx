"use client";

import {
  Activity,
  Cpu,
  MemoryStick,
  Pause,
  Play,
  Timer,
  Zap,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard } from "@/components/nova/kpi-card";
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
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTelemetryStream } from "@/hooks/use-telemetry-stream";
import { formatNumber } from "@/lib/nova";
import { TELEMETRY_METRICS } from "@/lib/nova/constants";
import type { TelemetryMetricId, TelemetryPoint } from "@/lib/nova/types";

/** 图表配色：直接引用 NOVA 霓虹色板变量 */
const CHART_CONFIG = {
  successRate: { label: "任务成功率", color: "var(--nova-cyan)" },
  latencyMs: { label: "响应延迟", color: "var(--nova-violet)" },
  memoryUtilization: { label: "记忆占用率", color: "var(--nova-fuchsia)" },
  throughputTps: { label: "并发吞吐", color: "var(--nova-sky)" },
} satisfies ChartConfig;

/** KPI 卡片图标 */
const METRIC_ICONS: Record<
  TelemetryMetricId,
  React.ComponentType<{ className?: string }>
> = {
  successRate: Activity,
  latencyMs: Timer,
  memoryUtilization: MemoryStick,
  throughputTps: Zap,
};

/** 各指标的达标阈值，用于图上的参考线与卡片口径 */
const METRIC_TARGETS: Record<TelemetryMetricId, number> = {
  successRate: 92,
  latencyMs: 800,
  memoryUtilization: 75,
  throughputTps: 1_400,
};

/**
 * 遥测中枢的交互部分：KPI 行 + 实时曲线。
 *
 * 遥测流是纯客户端状态（服务端不持有连接），因此这一层必须位于
 * 客户端边界内；种子数据由服务端页面传入，保证首屏与服务端渲染一致。
 */
export function TelemetryHub({ seed }: { seed: readonly TelemetryPoint[] }) {
  const stream = useTelemetryStream({ seed });
  const [metric, setMetric] = useState<TelemetryMetricId>("successRate");
  const gradientId = useId().replace(/:/g, "");

  const activeMeta = TELEMETRY_METRICS.find((item) => item.id === metric);
  const target = METRIC_TARGETS[metric];

  const chartData = useMemo(
    () => stream.points.map((point) => ({ t: point.t, value: point[metric] })),
    [stream.points, metric],
  );

  const deltas = useMemo(() => {
    const first = stream.points[0];
    const last = stream.latest;
    return Object.fromEntries(
      TELEMETRY_METRICS.map((item) => [
        item.id,
        first && last ? Number((last[item.id] - first[item.id]).toFixed(1)) : 0,
      ]),
    ) as Record<TelemetryMetricId, number>;
  }, [stream.points, stream.latest]);

  const yDomain = useMemo<[number, number]>(() => {
    const values = chartData.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(
      (max - min) * 0.25,
      metric === "latencyMs" ? 40 : 2,
    );
    return [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];
  }, [chartData, metric]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TELEMETRY_METRICS.map((item) => (
          <KpiCard
            key={item.id}
            label={item.label}
            caption={`窗口内变化 · 目标 ${formatNumber(target, item.precision)}${item.unit}`}
            value={stream.latest?.[item.id] ?? 0}
            unit={item.unit}
            precision={item.precision}
            delta={deltas[item.id]}
            higherIsBetter={item.higherIsBetter}
            accent={item.accent}
            icon={METRIC_ICONS[item.id]}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>实时遥测曲线</CardTitle>
          <CardDescription>
            采样间隔 2 秒 · 保留最近 {stream.points.length} 个点
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={stream.toggle}
              aria-pressed={stream.paused}
            >
              {stream.paused ? <Play /> : <Pause />}
              {stream.paused ? "继续" : "暂停"}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as TelemetryMetricId)}
          >
            <TabsList>
              {TELEMETRY_METRICS.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <ChartContainer
            config={CHART_CONFIG}
            className="h-72 w-full aspect-auto"
          >
            <AreaChart
              data={chartData}
              margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={`var(--color-${metric})`}
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="100%"
                    stopColor={`var(--color-${metric})`}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>

              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="t"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tickMargin={8}
              />
              <YAxis
                domain={yDomain}
                tickLine={false}
                axisLine={false}
                width={48}
                tickMargin={4}
              />
              <ReferenceLine
                y={target}
                stroke="var(--nova-amber)"
                strokeDasharray="4 4"
                label={{
                  value: `目标 ${formatNumber(target, activeMeta?.precision ?? 0)}${activeMeta?.unit ?? ""}`,
                  position: "insideTopRight",
                  fill: "var(--nova-amber)",
                  fontSize: 10,
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(label) => `采样时刻 ${label}`}
                  />
                }
              />
              <Area
                dataKey="value"
                name={activeMeta?.label}
                stroke={`var(--color-${metric})`}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="size-3 text-nova-cyan" />
              采样序号 {stream.cursor}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="size-3 text-nova-fuchsia" />
              当前指标 {activeMeta?.label} ·{" "}
              {formatNumber(
                stream.latest?.[metric] ?? 0,
                activeMeta?.precision ?? 1,
              )}
              {activeMeta?.unit}
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
