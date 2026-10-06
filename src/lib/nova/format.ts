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

/* -------------------------------------------------------------------------- */
/* 时间                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 全站展示时区。
 *
 * 刻意固定为东八区而不是跟随浏览器 / 服务器：
 * - NOVA 的运营口径就是北京时间，异地看同一个数字不该有两种解释；
 * - `Date#getHours()` 取的是运行环境的本地时区，服务端预渲染与浏览器
 *   水合一旦落在不同时区，同一段文案就会产生 hydration 差异。
 *   用 `Intl` + 固定 `timeZone` 把这条差异从根上消除。
 */
export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

/** 时区在界面上的短标签 */
export const DISPLAY_TIME_ZONE_LABEL = "UTC+8";

/** `hourCycle: h23` 而非 `hour12: false`：后者在午夜会输出 `24:00` */
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const CLOCK_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * 拆出格式化结果的分量。
 *
 * 不直接拼 `toLocaleString` 的产物：区域格式里日期与时间的分隔符位置是
 * 格式的一部分，跨 ICU 版本不保证一致，按分量拼接才稳定。
 */
function toParts(formatter: Intl.DateTimeFormat, at: string | Date) {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(at))) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** ISO 时间戳 → `YYYY-MM-DD HH:mm:ss`（北京时间） */
export function formatDateTime(iso: string): string {
  const p = toParts(TIMESTAMP_FORMATTER, iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** ISO 时间戳 → `MM-DD HH:mm:ss`（北京时间） */
export function formatTimestamp(iso: string): string {
  const p = toParts(TIMESTAMP_FORMATTER, iso);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** ISO 时间戳 → `HH:mm:ss`（北京时间） */
export function formatClock(iso: string): string {
  const p = toParts(CLOCK_FORMATTER, iso);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 任意时刻 → `HH:mm:ss`（北京时间），供实时时钟使用 */
export function formatClockNow(at: Date = new Date()): string {
  const p = toParts(CLOCK_FORMATTER, at);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 年份（北京时间），用于证书编号这类按年编号的场景 */
export function formatYear(iso: string): string {
  return toParts(TIMESTAMP_FORMATTER, iso).year ?? "";
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
