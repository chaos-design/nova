import { cn } from "cn";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  ACCENT_BAR_CLASS,
  ACCENT_TEXT,
  formatDelta,
  formatNumber,
  VECTOR_META,
} from "@/lib/nova";
import type { CapabilityScore } from "@/lib/nova/types";

/**
 * 能力向量得分条。
 *
 * 一行 = 一个能力向量：分数、环比变化、子项指标达标情况。
 * 既是矩阵页的主视图，也是 Agent 详情里的评分依据。
 */
export function ScoreBreakdown({
  capabilities,
  showReadings = true,
  className,
}: {
  capabilities: readonly CapabilityScore[];
  showReadings?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3", className)}>
      {capabilities.map((item) => {
        const meta = VECTOR_META[item.vector];
        const positive = item.delta > 0;
        const negative = item.delta < 0;
        const DeltaIcon = positive
          ? ArrowUpRight
          : negative
            ? ArrowDownRight
            : Minus;

        return (
          <li key={item.vector} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums",
                    ACCENT_TEXT[meta.accent],
                  )}
                >
                  {formatNumber(item.score, 1)}
                </span>
                <span className="text-sm text-foreground">{meta.label}</span>
                <span className="nova-mono-label text-[0.5625rem] text-muted-foreground/60">
                  {meta.abbreviation} · 权重 {Math.round(meta.weight * 100)}%
                </span>
              </div>

              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-mono text-xs tabular-nums",
                  positive
                    ? "text-nova-cyan"
                    : negative
                      ? "text-nova-rose"
                      : "text-muted-foreground",
                )}
              >
                <DeltaIcon className="size-3" />
                {formatDelta(item.delta, 1)}
              </span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/6">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700",
                  ACCENT_BAR_CLASS[meta.accent],
                )}
                style={{ width: `${Math.min(Math.max(item.score, 0), 100)}%` }}
              />
            </div>

            {showReadings && (
              <ul className="grid gap-1 sm:grid-cols-2">
                {item.readings.map((reading) => {
                  const ratio = reading.target
                    ? Math.min(reading.value / reading.target, 1)
                    : 0;

                  return (
                    <li
                      key={reading.label}
                      className="flex items-center justify-between gap-2 rounded-md bg-white/3 px-2 py-1"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            ratio >= 1
                              ? "bg-nova-cyan"
                              : ratio >= 0.8
                                ? "bg-nova-amber"
                                : "bg-nova-rose",
                          )}
                        />
                        <span className="truncate text-[0.6875rem] text-muted-foreground">
                          {reading.label}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-foreground/90">
                        {formatNumber(
                          reading.value,
                          reading.unit === "次" ? 1 : 1,
                        )}
                        <span className="text-muted-foreground/70">
                          /{reading.target}
                          {reading.unit}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
