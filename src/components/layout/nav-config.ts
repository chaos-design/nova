import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  FlaskConical,
  LayoutDashboard,
  Orbit,
  Trophy,
} from "lucide-react";
import type { Route } from "next";

/** 侧边导航项 */
export interface NavItem {
  /** 路由地址，`typedRoutes` 保证其一定是真实存在的页面 */
  href: Route;
  /** 中文标题 */
  label: string;
  /** 英文副标题 */
  caption: string;
  icon: LucideIcon;
  /** 右侧角标计数，为空则不渲染 */
  badge?: string;
}

/** 侧边导航分组 */
export interface NavSection {
  /** 分组标识 */
  id: string;
  /** 分组标题 */
  label: string;
  items: readonly NavItem[];
}

/**
 * 主导航。
 *
 * 路由路径是 `(nova)` 路由组的公开地址，不带分组前缀。
 * 分组只影响侧边栏的排版层次，不代表权限或路由层级。
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "observe",
    label: "观测",
    items: [
      {
        href: "/dashboard",
        label: "遥测中枢",
        caption: "Telemetry Hub",
        icon: LayoutDashboard,
      },
      {
        href: "/agents",
        label: "Agent 注册表",
        caption: "Registry",
        icon: Boxes,
        badge: "8",
      },
    ],
  },
  {
    id: "verify",
    label: "验证",
    items: [
      {
        href: "/matrix",
        label: "能力矩阵",
        caption: "Capability Matrix",
        icon: Orbit,
      },
      {
        href: "/sandbox",
        label: "沙盒模拟器",
        caption: "Sandbox Simulator",
        icon: FlaskConical,
      },
      {
        href: "/leaderboard",
        label: "排行榜",
        caption: "Leaderboard & Reports",
        icon: Trophy,
      },
    ],
  },
];

/** 展平后的全部导航项，供搜索索引等需要"单个列表"的消费方使用 */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap(
  (section) => section.items,
);

/** 侧边栏底部的运行时状态 */
export const RUNTIME_STATUS = {
  /** 集群标识 */
  cluster: "nova-edge-07",
  /** 服务状态 */
  state: "运行正常",
  /** 最近一次巡检距锚点的分钟数 */
  inspectedMinutesAgo: 2,
} as const;

/** 侧边栏收起状态的存储键 */
export const SIDEBAR_STORAGE_KEY = "nova:sidebar:v1";
