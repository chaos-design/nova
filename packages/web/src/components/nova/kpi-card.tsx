import { cn } from "cn";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { AccentColor } from "@/lib/nova";
import {
  ACCENT_BAR_CLASS,
  ACCENT_GLOW,
  ACCENT_TEXT,
  formatDelta,
  formatNumber,
} from "@/lib/nova";

/**
 * 遥测 KPI 卡片。
 *
 * `trend` 的语义由调用方决定（越大越好 / 越小越好），
 * 组件只负责按符号着色，避免在每个使用处重复写判断。
 */
export function KpiCard({
  label,
  caption,
  value,
  unit,
  precision = 1,
  delta,
  higherIsBetter = true,
  accent = "cyan",
  icon: Icon,
  className,
}: {
  label: string;
  /** 指标口径说明 */
  caption: string;
  value: number;
  unit: string;
  precision?: number;
  delta: number;
  higherIsBetter?: boolean;
  accent?: AccentColor;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const positive = delta > 0;
  const negative = delta < 0;
  const good = positive ? higherIsBetter : negative ? !higherIsBetter : null;

  const TrendIcon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;

  return (
    <div
      className={cn(
        "nova-panel group relative overflow-hidden rounded-xl p-4 transition-colors hover:border-nova-cyan/25",
        ACCENT_GLOW[accent],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 flex items-baseline gap-1">
            <span
              className={cn(
                "font-mono text-3xl font-semibold tabular-nums",
                ACCENT_TEXT[accent],
              )}
            >
              {formatNumber(value, precision)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {unit}
            </span>
          </p>
        </div>
        <Icon
          className={cn(
            "size-4 shrink-0 opacity-70 transition-opacity group-hover:opacity-100",
            ACCENT_TEXT[accent],
          )}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-0.5 font-mono text-xs tabular-nums",
            good === null
              ? "text-muted-foreground"
              : good
                ? "text-nova-cyan"
                : "text-nova-rose",
          )}
        >
          <TrendIcon className="size-3" />
          {formatDelta(delta, precision)}
        </span>
        <span className="truncate text-[0.6875rem] text-muted-foreground/70">
          {caption}
        </span>
      </div>

      {/* 顶部霓虹描边 */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 h-px opacity-60",
          ACCENT_BAR_CLASS[accent],
        )}
      />
    </div>
  );
}
