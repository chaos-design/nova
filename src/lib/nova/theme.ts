import type { AccentColor, AgentStatus, NovaGrade } from "./types";

/**
 * 视图层颜色映射。
 *
 * 霓虹色板定义在 `src/app/nova-theme.css` 的 `:root` 中，这里只做
 * "语义 → Tailwind 类名" 的静态映射。
 *
 * 注意：所有类名必须以完整字面量书写。Tailwind 的静态扫描无法识别
 * 模板字符串拼接出来的类名（如 `text-${accent}`）。
 */

export const ACCENT_TEXT: Record<AccentColor, string> = {
  cyan: "text-nova-cyan",
  violet: "text-nova-violet",
  fuchsia: "text-nova-fuchsia",
  sky: "text-nova-sky",
  amber: "text-nova-amber",
  rose: "text-nova-rose",
};

export const ACCENT_BG: Record<AccentColor, string> = {
  cyan: "bg-nova-cyan/10",
  violet: "bg-nova-violet/10",
  fuchsia: "bg-nova-fuchsia/10",
  sky: "bg-nova-sky/10",
  amber: "bg-nova-amber/10",
  rose: "bg-nova-rose/10",
};

export const ACCENT_RING: Record<AccentColor, string> = {
  cyan: "ring-nova-cyan/30",
  violet: "ring-nova-violet/30",
  fuchsia: "ring-nova-fuchsia/30",
  sky: "ring-nova-sky/30",
  amber: "ring-nova-amber/30",
  rose: "ring-nova-rose/30",
};

/** 霓虹辉光，用于卡片与图表容器 */
export const ACCENT_GLOW: Record<AccentColor, string> = {
  cyan: "shadow-[0_0_32px_-12px_var(--nova-cyan)]",
  violet: "shadow-[0_0_32px_-12px_var(--nova-violet)]",
  fuchsia: "shadow-[0_0_32px_-12px_var(--nova-fuchsia)]",
  sky: "shadow-[0_0_32px_-12px_var(--nova-sky)]",
  amber: "shadow-[0_0_32px_-12px_var(--nova-amber)]",
  rose: "shadow-[0_0_32px_-12px_var(--nova-rose)]",
};

/** 图表可直接消费的颜色变量 */
export const ACCENT_CHART_VAR: Record<AccentColor, string> = {
  cyan: "var(--nova-cyan)",
  violet: "var(--nova-violet)",
  fuchsia: "var(--nova-fuchsia)",
  sky: "var(--nova-sky)",
  amber: "var(--nova-amber)",
  rose: "var(--nova-rose)",
};

/** 实心圆点（表头标识） */
export const ACCENT_DOT_CLASS: Record<AccentColor, string> = {
  cyan: "bg-nova-cyan",
  violet: "bg-nova-violet",
  fuchsia: "bg-nova-fuchsia",
  sky: "bg-nova-sky",
  amber: "bg-nova-amber",
  rose: "bg-nova-rose",
};

/** 实心进度条（分数条） */
export const ACCENT_BAR_CLASS: Record<AccentColor, string> = ACCENT_DOT_CLASS;

export const STATUS_META: Record<
  AgentStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  verified: {
    label: "已验证",
    badgeClass: "border-nova-cyan/30 bg-nova-cyan/10 text-nova-cyan",
    dotClass: "bg-nova-cyan",
  },
  testing: {
    label: "验证中",
    badgeClass: "border-nova-amber/30 bg-nova-amber/10 text-nova-amber",
    dotClass: "bg-nova-amber animate-pulse",
  },
  queued: {
    label: "排队中",
    badgeClass: "border-nova-slate/30 bg-nova-slate/10 text-nova-slate",
    dotClass: "bg-nova-slate",
  },
  regression: {
    label: "回归异常",
    badgeClass: "border-nova-rose/30 bg-nova-rose/10 text-nova-rose",
    dotClass: "bg-nova-rose animate-pulse",
  },
};

export const GRADE_META: Record<
  NovaGrade,
  { label: string; textClass: string; chipClass: string }
> = {
  S: {
    label: "S · 超新星",
    textClass: "text-nova-fuchsia",
    chipClass: "border-nova-fuchsia/40 bg-nova-fuchsia/10 text-nova-fuchsia",
  },
  A: {
    label: "A · 亮星",
    textClass: "text-nova-cyan",
    chipClass: "border-nova-cyan/40 bg-nova-cyan/10 text-nova-cyan",
  },
  B: {
    label: "B · 主序星",
    textClass: "text-nova-sky",
    chipClass: "border-nova-sky/40 bg-nova-sky/10 text-nova-sky",
  },
  C: {
    label: "C · 矮星",
    textClass: "text-nova-amber",
    chipClass: "border-nova-amber/40 bg-nova-amber/10 text-nova-amber",
  },
};

/** 日志级别 → 文本颜色 */
export const LOG_LEVEL_CLASS = {
  info: "text-nova-slate",
  success: "text-nova-cyan",
  warn: "text-nova-amber",
  error: "text-nova-rose",
  reflect: "text-nova-violet",
} as const;

/** 日志级别 → 左侧信号条颜色 */
export const LOG_LEVEL_BAR_CLASS = {
  info: "bg-nova-slate/60",
  success: "bg-nova-cyan",
  warn: "bg-nova-amber",
  error: "bg-nova-rose",
  reflect: "bg-nova-violet",
} as const;
