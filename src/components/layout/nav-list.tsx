"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-config";

/**
 * 主导航列表（客户端）。
 *
 * 之所以独立成组件：激活态依赖 `usePathname()`，
 * 而侧边栏的其余部分（品牌、运行时状态）是纯服务端渲染。
 */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="主导航" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            data-active={active}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
              active
                ? "bg-gradient-to-r from-nova-cyan/16 via-nova-violet/8 to-transparent text-nova-starlight"
                : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
            )}
          >
            {/* 激活态的霓虹指示条 */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1.5 -left-px w-0.5 rounded-full bg-nova-cyan transition-all",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <Icon
              className={cn(
                "size-4 shrink-0 transition-colors",
                active
                  ? "text-nova-cyan"
                  : "text-muted-foreground group-hover:text-nova-violet",
              )}
            />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="nova-mono-label block truncate text-[0.5625rem] text-muted-foreground/70">
                {item.caption}
              </span>
            </span>
            {item.badge && (
              <span className="nova-mono-label rounded-full border border-nova-cyan/25 bg-nova-cyan/10 px-1.5 py-0.5 text-nova-cyan">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
