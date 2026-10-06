/**
 * 界面外观偏好（主色 / 动效）。
 *
 * 为什么不用 `next-themes`：NOVA 只提供深空一套配色（见
 * `docs/architecture.md` §7.1），需要切换的从来不是明暗，而是"这套深空
 * 用哪个霓虹主色"和"要不要动画"。为此引入一个主题库不划算 —— 实际需求
 * 只有两个字符串，写在 `<html>` 的 data 属性上就够了。
 *
 * 两个属性都由内联引导脚本在首帧之前落定，避免"先亮一下再变暗"的闪变；
 * 偏好本身存在 `localStorage`，不随请求传递，因此不需要服务端参与。
 */

/** 界面主色预设，标识与 `nova-theme.css` 的 `[data-nova-accent]` 一一对应 */
export type AccentPreset =
  | "cyan"
  | "violet"
  | "fuchsia"
  | "sky"
  | "amber"
  | "rose";

/** 动效档位，标识与 `[data-nova-motion]` 一一对应 */
export type MotionPreference = "full" | "reduced";

/** 主色预设清单，色块不写死在 TS 里，见 `AccentSwatch` 的说明 */
export const ACCENT_PRESETS: readonly {
  id: AccentPreset;
  label: string;
}[] = [
  { id: "cyan", label: "深空青" },
  { id: "violet", label: "星云紫" },
  { id: "fuchsia", label: "新星品红" },
  { id: "sky", label: "极地天蓝" },
  { id: "amber", label: "恒星琥珀" },
  { id: "rose", label: "超新星玫" },
];

/** 动效档位清单 */
export const MOTION_PRESETS: readonly {
  id: MotionPreference;
  label: string;
  description: string;
}[] = [
  { id: "full", label: "完整动效", description: "扫描线、脉冲与漂移全部播放" },
  {
    id: "reduced",
    label: "精简动效",
    description: "关闭循环动画与过渡，保留状态色",
  },
];

export const DEFAULT_ACCENT: AccentPreset = "cyan";
export const DEFAULT_MOTION: MotionPreference = "full";

export const ACCENT_STORAGE_KEY = "nova:appearance:accent";
export const MOTION_STORAGE_KEY = "nova:appearance:motion";

/** 读偏好时使用的属性名 */
export const ACCENT_ATTRIBUTE = "data-nova-accent";
export const MOTION_ATTRIBUTE = "data-nova-motion";

/**
 * 首帧引导脚本。
 *
 * 必须在样式生效之前同步执行，因此内联在 `<body>` 起始处而不是作为组件。
 * 主色属性**总是**写入而不是有偏好才写：CSS 侧的 shadcn 令牌重挂依赖这个
 * 属性存在，缺属性就等于退回中性色。没有偏好时写默认值，行为与无脚本一致。
 *
 * 逻辑刻意只有"读 → 写属性"两步：任何异常（隐私模式禁用了 localStorage）
 * 都应该静默回落到 CSS 默认值，而不是让页面白屏。
 */
export const APPEARANCE_BOOTSTRAP = [
  "(function(){try{",
  "var e=document.documentElement,s=window.localStorage,",
  `a=s.getItem("${ACCENT_STORAGE_KEY}"),`,
  `m=s.getItem("${MOTION_STORAGE_KEY}");`,
  'if(!m){m=window.matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"full";}',
  `e.setAttribute("${ACCENT_ATTRIBUTE}",a||"${DEFAULT_ACCENT}");`,
  `e.setAttribute("${MOTION_ATTRIBUTE}",m);`,
  "}catch(_){}})()",
].join("");

/** 把偏好应用到 `<html>`，切换后立即生效 */
export function applyAppearance(
  accent: AccentPreset,
  motion: MotionPreference,
): void {
  const root = document.documentElement;
  root.setAttribute(ACCENT_ATTRIBUTE, accent);
  root.setAttribute(MOTION_ATTRIBUTE, motion);
}
