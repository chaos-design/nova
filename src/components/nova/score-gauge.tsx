import { cn } from "cn";
import { ACCENT_GLOW, ACCENT_TEXT, formatNumber } from "@/lib/nova";
import type { AccentColor } from "@/lib/nova/types";

/** 刻度数量，纯装饰 */
const TICKS = 48;

/** 坐标保留两位小数，消除 SSR 与客户端的浮点尾数差异 */
function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 径向评分仪表。
 *
 * 不使用图表库：单个分数用 SVG 表达最直接，也省掉一份 bundle。
 * 弧线从 12 点方向顺时针增长，长度即分数占比。
 */
export function ScoreGauge({
  value,
  label,
  caption,
  size = 148,
  accent = "cyan",
  className,
}: {
  /** 0 ~ 100 */
  value: number;
  /** 中心数值上方的标签 */
  label: string;
  /** 中心数值下方的说明 */
  caption?: string;
  size?: number;
  accent?: AccentColor;
  className?: string;
}) {
  const stroke = 10;
  const radius = (size - stroke * 2 - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), 100);
  const dash = (clamped / 100) * circumference;

  return (
    <div
      className={cn(
        "relative grid place-items-center",
        ACCENT_GLOW[accent],
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={`${label} ${clamped}`}
      >
        {/* 外圈刻度 */}
        <g opacity="0.35">
          {Array.from({ length: TICKS }, (_, index) => {
            const angle = (index / TICKS) * 2 * Math.PI;
            const outer = size / 2 - 2;
            const inner = outer - (index % 4 === 0 ? 7 : 4);

            return (
              <line
                key={angle}
                // 坐标统一保留两位小数：避免 SSR 与客户端因浮点尾数
                // 差异产生 hydration 不一致
                x1={px(size / 2 + Math.cos(angle) * inner)}
                y1={px(size / 2 + Math.sin(angle) * inner)}
                x2={px(size / 2 + Math.cos(angle) * outer)}
                y2={px(size / 2 + Math.sin(angle) * outer)}
                stroke="currentColor"
                strokeWidth="1"
                className="text-nova-slate"
              />
            );
          })}
        </g>

        {/* 轨道 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-white/8"
        />

        {/* 进度弧 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={ACCENT_TEXT[accent]}
          style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p
            className={cn(
              "font-mono text-3xl font-semibold tabular-nums",
              ACCENT_TEXT[accent],
            )}
          >
            {formatNumber(clamped, 1)}
          </p>
          <p className="nova-mono-label mt-1 text-muted-foreground">{label}</p>
          {caption && (
            <p className="mt-1 text-[0.6875rem] text-muted-foreground/70">
              {caption}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
