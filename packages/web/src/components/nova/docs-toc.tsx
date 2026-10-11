"use client";

import { cn } from "cn";
import { useEffect, useState } from "react";

/** 文档中心目录项 */
export interface DocsTocItem {
  /** 对应章节的 DOM id（`<section id=…>`） */
  id: string;
  /** 目录展示文案 */
  label: string;
  /** 章节号，如 "01" */
  index: string;
}

/**
 * 文档中心的粘性目录。
 *
 * 用 IntersectionObserver 做滚动定位：阅读位置对应的章节在目录里高亮，
 * 点击目录平滑滚动到章节 —— 与控制台「键盘与指针都能完成导航」的交互约定一致。
 * 观察器在卸载时断开；items 变化时重建（当前内容是静态的，这是防御性约定）。
 */
export function DocsToc({ items }: { items: readonly DocsTocItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // 可见章节里取 DOM 顺序最靠前的作为当前章节；
        // 都不可见（快速滚动间隙）时保持上一个高亮，避免目录闪烁
        const current = items.find((item) => visible.has(item.id));
        if (current) setActiveId(current.id);
      },
      // 视口上沿 15% 到下沿 60% 之间的章节视为「正在阅读」
      { rootMargin: "-15% 0px -40% 0px" },
    );

    for (const item of items) {
      const section = document.getElementById(item.id);
      if (section) observer.observe(section);
    }

    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="文档目录" className="space-y-1">
      <p className="nova-mono-label px-3 pb-2 text-muted-foreground/60">
        本页目录
      </p>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={activeId === item.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            document
              .getElementById(item.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={cn(
            "flex items-baseline gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
            activeId === item.id
              ? "bg-nova-accent/10 text-nova-accent"
              : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
          )}
        >
          <span className="font-mono text-[0.625rem] opacity-60">
            {item.index}
          </span>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
