import type { Route } from "next";
import {
  CAPABILITY_VECTORS,
  CHAOS_KINDS,
  ENVIRONMENTS,
  MODEL_REGISTRY,
} from "./constants";
import { formatNumber } from "./format";
import type { AgentProfile } from "./types";

/**
 * 全局搜索索引。
 *
 * 索引对象是"控制台里能指过去的东西"，因此只收录三类：页面、Agent 档案、
 * 评测口径里的名词（能力向量 / 混沌注入 / 沙盒环境 / 可选模型）。凡是界面上
 * 看得到、用户可能用名字去找的东西都该在这里出现一次。
 *
 * 导航项与 Agent 档案都由调用方注入而不是在这里 import：
 * `components/layout/nav-config.ts` 属于外壳层，领域层不允许反向依赖它；
 * Agent 档案读的是运行时落库的真实结果，只有服务端页面拿得到。
 */

/** 搜索结果的分组，决定展示顺序 */
export const SEARCH_GROUPS = [
  "页面",
  "Agent",
  "能力向量",
  "混沌注入",
  "沙盒环境",
  "模型",
] as const;

export type SearchGroup = (typeof SEARCH_GROUPS)[number];

/** 一条可跳转的搜索结果 */
export interface SearchEntry {
  /** 稳定主键，用于 React key 与键盘导航的 aria-activedescendant */
  id: string;
  group: SearchGroup;
  /** 主标题 */
  title: string;
  /** 副标题，说明这条结果是什么 */
  description: string;
  /** 额外可匹配词：英文缩写、指标名、模型 id 等界面不直接展示的字符串 */
  keywords: string;
  /** 跳转地址；`Route` 由 `typedRoutes` 保证是真实存在的页面 */
  href: Route;
}

/** 导航项的最小契约：只要有地址和标题就能进索引 */
export interface SearchableNavItem {
  href: Route;
  label: string;
  caption: string;
}

/** 指标、名称等文本统一小写后再匹配，中英文混排时大小写不敏感 */
function normalize(text: string): string {
  return text.toLowerCase();
}

/**
 * 构建索引。
 *
 * 刻意做成纯函数而不是模块常量：导航项在运行时才拿得到，
 * 而索引本身只依赖静态配置，不需要缓存。
 */
export function buildSearchIndex(
  navItems: readonly SearchableNavItem[],
  agents: readonly AgentProfile[] = [],
): SearchEntry[] {
  return [
    ...navItems.map<SearchEntry>((item) => ({
      id: `page:${item.href}`,
      group: "页面",
      title: item.label,
      description: item.caption,
      keywords: item.href,
      href: item.href,
    })),
    ...agents.map<SearchEntry>((agent) => ({
      id: `agent:${agent.id}`,
      group: "Agent",
      title: `${agent.name} · ${agent.codename}`,
      description: `${agent.model} · ${agent.owner} · ${agent.tagline}`,
      keywords: `${agent.id} ${agent.version} ${agent.model}`,
      href: "/agents",
    })),
    ...CAPABILITY_VECTORS.map<SearchEntry>((vector) => ({
      id: `vector:${vector.id}`,
      group: "能力向量",
      title: vector.label,
      description: `${vector.description} · 权重 ${(vector.weight * 100).toFixed(0)}%`,
      keywords: `${vector.abbreviation} ${vector.id} ${vector.metrics.join(" ")}`,
      href: "/matrix",
    })),
    ...CHAOS_KINDS.map<SearchEntry>((item) => ({
      id: `chaos:${item.kind}`,
      group: "混沌注入",
      title: item.label,
      description: item.description,
      keywords: `${item.kind} 最小间隔 ${item.spacing} 步`,
      href: "/sandbox",
    })),
    ...ENVIRONMENTS.map<SearchEntry>((item) => ({
      id: `env:${item.id}`,
      group: "沙盒环境",
      title: item.label,
      description: item.description,
      keywords: `${item.id} 注入上限 ${(item.chaosCeiling * 100).toFixed(0)}%`,
      href: "/sandbox",
    })),
    ...MODEL_REGISTRY.map<SearchEntry>((model) => ({
      id: `model:${model.id}`,
      group: "模型",
      title: model.label,
      description: `${model.provider} · 上下文 ${formatNumber(
        model.contextWindow,
      )} token · ${model.description}`,
      keywords: model.id,
      href: "/sandbox",
    })),
  ];
}

/** 单组结果在匹配时的权重：标题命中比描述命中更可能是用户想要的 */
function groupRank(group: SearchGroup): number {
  return SEARCH_GROUPS.indexOf(group);
}

/** 单一查询下的结果上限，避免长尾关键词把列表刷成墙 */
const RESULT_LIMIT = 12;

/**
 * 执行搜索。
 *
 * 匹配规则是"任一分段包含即命中"，得分按 标题 > 关键词 > 副标题 递减，
 * 同分再按分组顺序排 —— 这样结果列表是稳定的，输入每个字符不会看到条目乱跳。
 *
 * 空查询返回全量：命令面板刚唤起时应当是一份可浏览的目录，
 * 而不是一块空白等用户先想好搜什么。
 */
export function searchEntries(
  index: readonly SearchEntry[],
  query: string,
  group?: SearchGroup,
): SearchEntry[] {
  const needle = normalize(query.trim());
  const pool =
    group === undefined
      ? index
      : index.filter((entry) => entry.group === group);

  if (!needle) {
    return SEARCH_GROUPS.flatMap((name) =>
      pool.filter((e) => e.group === name),
    );
  }

  return pool
    .map((entry) => ({ entry, score: scoreEntry(entry, needle) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        groupRank(a.entry.group) - groupRank(b.entry.group) ||
        a.entry.title.localeCompare(b.entry.title, "zh-CN"),
    )
    .slice(0, RESULT_LIMIT)
    .map((item) => item.entry);
}

function scoreEntry(entry: SearchEntry, needle: string): number {
  if (normalize(entry.title).includes(needle)) return 300;
  if (normalize(entry.keywords).includes(needle)) return 200;
  if (normalize(entry.description).includes(needle)) return 100;
  return 0;
}
