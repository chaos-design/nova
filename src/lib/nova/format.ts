import type { TelemetryMetricMeta } from "./types";

/** 数值裁剪到 [min, max] 区间 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 保留指定小数位并返回数值 */
export function round(value: number, precision = 1): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** 千分位格式化 */
export function formatNumber(value: number, precision = 0): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** 按指标元信息格式化数值，自动拼接单位 */
export function formatMetric(
  value: number,
  meta: Pick<TelemetryMetricMeta, "unit" | "precision">,
): string {
  return `${formatNumber(value, meta.precision)}${meta.unit}`;
}

/** 变化量符号格式化，如 `+2.4` / `-1.1` */
export function formatDelta(delta: number, precision = 1): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(delta), precision)}`;
}

/** 百分比格式化 */
export function formatPercent(value: number, precision = 1): string {
  return `${formatNumber(value, precision)}%`;
}

/** 时长格式化：小于 1 秒显示毫秒，否则显示秒 */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${formatNumber(ms / 1000, 1)}s`;
}

/** ISO 时间戳 → `MM-DD HH:mm:ss` */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** ISO 时间戳 → `HH:mm:ss` */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

/** 相对当前时间的粗粒度描述 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/** 数值 → 语义等级，供进度条、徽章着色复用 */
export type ScoreTone = "high" | "mid" | "low";

/** 得分语义等级：≥ 85 高、≥ 72 中、其余低 */
export function scoreTone(score: number): ScoreTone {
  if (score >= 85) return "high";
  if (score >= 72) return "mid";
  return "low";
}
