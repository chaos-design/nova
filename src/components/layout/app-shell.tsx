"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentProfile } from "@/lib/nova/types";
import { CosmicBackground } from "./cosmic-background";
import { GlobalSearch } from "./global-search";
import { NovaSidebar } from "./nova-sidebar";
import { NovaTopBar } from "./nova-top-bar";

/**
 * 控制台外壳：固定侧边栏 + 吸顶顶栏 + 内容区。
 *
 * `(nova)` 路由组的所有页面共享此布局，切换页面时不重挂载，
 * 因此侧边栏与背景不会闪烁。
 *
 * 之所以是客户端组件：搜索弹窗与 ⌘K 快捷键是全局交互，状态只能挂在这一个
 * 常驻实例上。若由侧边栏与顶栏各自持有一份，会注册两个键盘监听，
 * 一次按键把弹窗开了又关。
 */
export function AppShell({
  children,
  agents = [],
}: {
  children: React.ReactNode;
  /** 已产生真实结果的 Agent 档案，供全局搜索索引；由服务端布局注入 */
  agents?: readonly AgentProfile[];
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSearch = useCallback(() => {
    setSearchOpen((current) => !current);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      // 输入框里按 ⌘K 仍然是"打开搜索"，而不是被浏览器当成别的快捷键
      event.preventDefault();
      toggleSearch();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSearch]);

  return (
    <div className="flex min-h-screen">
      <CosmicBackground />
      <NovaSidebar onOpenSearch={toggleSearch} />

      <div className="flex min-w-0 flex-1 flex-col">
        <NovaTopBar onOpenSearch={toggleSearch} />
        <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <footer className="border-t border-white/8 px-4 py-4 lg:px-8">
          <p className="text-xs text-muted-foreground/70">
            NOVA 控制台 · 所有指标来自本地真实运行记录，由{" "}
            <code className="mx-1 font-mono text-nova-accent/80">
              src/lib/nova/run-store.ts
            </code>{" "}
            落库于{" "}
            <code className="mx-1 font-mono text-nova-accent/80">
              .nova/runs.json
            </code>
            ，不含预置演示数据。
          </p>
        </footer>
      </div>

      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        agents={agents}
      />
    </div>
  );
}
