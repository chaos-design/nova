"use client";

import { cn } from "cn";
import { Orbit, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NOVA_BRAND } from "@/lib/nova";
import { AppearanceMenu } from "./appearance-menu";
import { SearchTrigger } from "./global-search";
import { RUNTIME_STATUS, SIDEBAR_STORAGE_KEY } from "./nav-config";
import { NavList } from "./nav-list";
import { NovaLogo } from "./nova-logo";

/**
 * 桌面端固定侧边栏（lg 以下隐藏，改用 MobileNav）。
 *
 * 高度锁在视口内、导航区自己滚动、底部状态区 `mt-auto` 吸底 ——
 * 这样运行时状态与操作入口在长页面下也始终可见，不用滚回去找。
 */
export function NovaSidebar({
  className,
  onOpenSearch,
}: {
  className?: string;
  onOpenSearch?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // 收起状态存在本地：服务端不知道，首帧统一按展开渲染，挂载后再对齐
  useEffect(() => {
    setCollapsed(
      window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed",
    );
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        next ? "collapsed" : "expanded",
      );
      return next;
    });
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-16 hidden h-[calc(100svh-4rem)] shrink-0 flex-col border-r border-white/8 bg-sidebar/70 backdrop-blur-xl transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-64",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-white/8",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        <NovaLogo compact={collapsed} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <PanelLeftOpen className="text-nova-accent" />
              ) : (
                <PanelLeftClose />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "展开侧边栏" : "收起侧边栏"}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className={cn("shrink-0 py-4", collapsed ? "px-2" : "px-3")}>
        <SearchTrigger
          collapsed={collapsed}
          onClick={onOpenSearch ?? (() => {})}
        />
      </div>

      <div
        className={cn(
          "nova-hairline mx-4 h-px shrink-0 opacity-40",
          collapsed && "mx-3",
        )}
      />

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain py-4",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <NavList collapsed={collapsed} />
      </div>

      {/* 吸底状态区：主色、集群与标准始终留在视野里 */}
      <div
        className={cn(
          "mt-auto shrink-0 space-y-3 border-t border-white/8",
          collapsed ? "p-2" : "p-4",
        )}
      >
        <RuntimeStatus collapsed={collapsed} />

        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="presentation"
                aria-label={NOVA_BRAND.sloganZh}
                className="mx-auto grid size-9 cursor-default place-items-center rounded-lg px-1 py-1 text-[0.6875rem] leading-relaxed text-muted-foreground/70"
              >
                <Orbit className="size-3.5 shrink-0 text-nova-accent-2" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{NOVA_BRAND.sloganZh}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-start gap-2 rounded-lg px-1 py-1 text-[0.6875rem] leading-relaxed text-muted-foreground/70">
            <Orbit className="mt-0.5 size-3.5 shrink-0 text-nova-accent-2" />
            <span>{NOVA_BRAND.sloganZh}</span>
          </div>
        )}

        <AppearanceMenu collapsed={collapsed} className="w-full" />
      </div>
    </aside>
  );
}

/** 集群运行状态：展开时是面板，收起时是一个带提示的圆点 */
function RuntimeStatus({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="presentation"
            aria-label={`集群 ${RUNTIME_STATUS.cluster} · ${RUNTIME_STATUS.state}`}
            className="nova-panel mx-auto grid size-9 cursor-default place-items-center rounded-lg"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-nova-accent/70" />
              <span className="relative inline-flex size-2 rounded-full bg-nova-accent" />
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          集群 {RUNTIME_STATUS.cluster} · {RUNTIME_STATUS.state}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="nova-panel rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="nova-mono-label text-muted-foreground">集群</span>
        <span className="font-mono text-xs text-nova-accent">
          {RUNTIME_STATUS.cluster}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-nova-accent/70" />
          <span className="relative inline-flex size-2 rounded-full bg-nova-accent" />
        </span>
        <span className="text-xs text-muted-foreground">
          {RUNTIME_STATUS.state}
        </span>
      </div>
    </div>
  );
}
