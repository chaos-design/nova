"use client";

import { ArrowRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  buildSearchIndex,
  SEARCH_GROUPS,
  type SearchEntry,
  type SearchGroup,
  searchEntries,
} from "@/lib/nova";
import { NAV_ITEMS } from "./nav-config";

/**
 * 全局搜索。
 *
 * 索引覆盖页面、Agent 档案与评测口径里的名词，见 `lib/nova/search.ts`。
 * 交互按「命令面板」而不是「搜索结果页」做：⌘K 唤起、↑↓ 移动、Enter 跳转，
 * 全程不需要鼠标 —— 控制台里这些名词（混沌类型、模型 id）用户更记得住名字。
 */
export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<SearchGroup | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildSearchIndex(NAV_ITEMS), []);
  const results = useMemo(
    () => searchEntries(index, query, group ?? undefined),
    [group, index, query],
  );
  /** 未筛选时按分组顺序展示，因此需要按 group 切段 */
  const sections = useMemo(
    () =>
      (group ? [group] : SEARCH_GROUPS).map((name) => ({
        name,
        entries: results.filter((entry) => entry.group === name),
      })),
    [group, results],
  );

  // 键盘移动时把当前项滚进可视区，否则连按 ↓ 会一路飘出列表
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  // 查询条件变化时把高亮项退回第一条：与结果同步重置，而不是等渲染后再纠正
  function updateQuery(value: string) {
    setQuery(value);
    setActiveIndex(0);
  }

  function updateGroup(value: SearchGroup | null) {
    setGroup(value);
    setActiveIndex(0);
  }

  function openEntry(entry: SearchEntry) {
    onOpenChange(false);
    router.push(entry.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const entry = results[activeIndex];
      if (!entry) return;
      event.preventDefault();
      openEntry(entry);
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setGroup(null);
      setActiveIndex(0);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12svh] flex max-h-[72svh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>全局搜索</DialogTitle>
          <DialogDescription>
            搜索页面、Agent 档案与评测口径名词。
          </DialogDescription>
        </DialogHeader>

        <div className="nova-hairline flex items-center gap-2 border-b border-white/8 px-4">
          <Search className="size-4 shrink-0 text-nova-accent" />
          <Input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="nova-search-results"
            aria-label="搜索页面、Agent 或评测名词"
            aria-activedescendant={results[activeIndex]?.id}
            placeholder="搜索页面、Agent、混沌类型或模型…"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />{" "}
          <kbd className="nova-mono-label hidden shrink-0 rounded border border-white/12 px-1.5 py-0.5 text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        {/* 换行而不是横向滚动：横向滚动条会把靠后的分组藏起来，
            而"哪些分组可选"正是这个面板需要一眼交代的信息 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/8 px-3 py-2">
          <FilterChip
            active={group === null}
            count={results.length}
            onClick={() => updateGroup(null)}
          >
            全部
          </FilterChip>
          {SEARCH_GROUPS.map((name) => (
            <FilterChip
              key={name}
              active={group === name}
              count={results.filter((entry) => entry.group === name).length}
              onClick={() => updateGroup(group === name ? null : name)}
            >
              {name}
            </FilterChip>
          ))}
        </div>

        <div
          ref={listRef}
          id="nova-search-results"
          role="listbox"
          aria-label="搜索结果"
          className="min-h-40 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {results.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-center">
              <div>
                <p className="text-sm font-medium">
                  {query.trim() ? "没有匹配项" : "没有可展示的条目"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {query.trim()
                    ? "试试 Agent 代号、混沌类型，或「矩阵」「沙盒」这类页面名。"
                    : "换一组筛选看看。"}
                </p>
              </div>
            </div>
          ) : (
            sections.map((section) =>
              section.entries.length > 0 ? (
                <section key={section.name} className="py-1">
                  <h2 className="nova-mono-label px-2 py-1 text-muted-foreground/70">
                    {section.name}
                  </h2>
                  {section.entries.map((entry) => {
                    const index = results.indexOf(entry);
                    return (
                      <button
                        key={entry.id}
                        id={entry.id}
                        data-index={index}
                        type="button"
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => openEntry(entry)}
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                          index === activeIndex
                            ? "bg-white/8 text-foreground"
                            : "text-muted-foreground hover:bg-white/4"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {entry.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {entry.description}
                          </span>
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 opacity-50" />
                      </button>
                    );
                  })}
                </section>
              ) : null,
            )
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-white/8 px-4 py-2 text-[0.6875rem] text-muted-foreground/70">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span className="ml-auto">共 {index.length} 项可检索</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 分组筛选片 */
function FilterChip({
  active,
  children,
  count,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  count: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="xs"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 gap-1.5"
    >
      {children}
      <span className="font-mono text-[0.625rem] opacity-60">{count}</span>
    </Button>
  );
}

/** 侧边栏里的搜索入口 */
export function SearchTrigger({
  collapsed = false,
  onClick,
}: {
  collapsed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="全局搜索"
      aria-keyshortcuts="Meta+K Control+K"
      title="全局搜索"
      className={`flex h-8 w-full items-center gap-2 rounded-lg border border-white/8 bg-white/3 text-sm text-muted-foreground transition-colors hover:border-nova-accent/35 hover:text-foreground ${
        collapsed ? "justify-center px-0" : "px-2.5"
      }`}
    >
      <Search className="size-3.5 shrink-0" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-left">搜索…</span>
          <kbd className="nova-mono-label shrink-0 rounded border border-white/12 px-1 py-0.5 text-[0.5625rem]">
            ⌘K
          </kbd>
        </>
      )}
    </button>
  );
}
