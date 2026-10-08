"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_SECTIONS, type NavSection } from "./nav-config";

/**
 * 主导航列表（客户端）。
 *
 * 之所以独立成组件：激活态依赖 `usePathname()`，
 * 而侧边栏的其余部分（品牌、运行时状态）是纯服务端渲染。
 */
export function NavList({
  collapsed = false,
  onNavigate,
  sections = NAV_SECTIONS,
  topAction,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  sections?: readonly NavSection[];
  /** 渲染在第一组标题行右侧的操作位（如展开/收起按钮） */
  topAction?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="主导航" className="flex flex-col gap-5">
      {sections.map((section, index) => (
        <section key={section.id} className="flex flex-col gap-1">
          <div
            className={cn(
              "flex items-center pb-2",
              collapsed ? "justify-center px-0" : "justify-between px-3",
            )}
          >
            <h2
              className={cn(
                "nova-mono-label text-muted-foreground/60",
                collapsed && "sr-only",
              )}
            >
              {section.label}
            </h2>
            {index === 0 ? topAction : undefined}
          </div>

          {section.items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;

            const link = (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-gradient-to-r from-nova-accent/16 via-nova-accent-2/8 to-transparent text-nova-starlight"
                    : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
                )}
              >
                {/* 激活态的霓虹指示条 */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-1.5 -left-px w-0.5 rounded-full bg-nova-accent transition-all",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    active
                      ? "text-nova-accent"
                      : "text-muted-foreground group-hover:text-nova-accent-2",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 leading-tight",
                    collapsed && "sr-only",
                  )}
                >
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  <span className="nova-mono-label block truncate text-[0.5625rem] text-muted-foreground/70">
                    {item.caption}
                  </span>
                </span>
                {!collapsed && item.badge && (
                  <span className="nova-mono-label rounded-full border border-nova-accent/25 bg-nova-accent/10 px-1.5 py-0.5 text-nova-accent">
                    {item.badge}
                  </span>
                )}
              </Link>
            );

            if (!collapsed) return <div key={item.href}>{link}</div>;

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
