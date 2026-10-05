import { cn } from "cn";
import { Orbit } from "lucide-react";
import { NOVA_BRAND } from "@/lib/nova";
import { RUNTIME_STATUS } from "./nav-config";
import { NavList } from "./nav-list";
import { NovaLogo } from "./nova-logo";

/** 桌面端固定侧边栏（lg 以下隐藏，改用 MobileNav） */
export function NovaSidebar({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "hidden w-64 shrink-0 flex-col border-r border-white/8 bg-sidebar/70 backdrop-blur-xl lg:flex",
        className,
      )}
    >
      <div className="flex h-16 items-center border-b border-white/8 px-5">
        <NovaLogo />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5">
        <p className="nova-mono-label px-3 pb-3 text-muted-foreground/60">
          控制台
        </p>
        <NavList />
      </div>

      <div className="space-y-3 border-t border-white/8 p-4">
        <div className="nova-panel rounded-lg p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="nova-mono-label text-muted-foreground">集群</span>
            <span className="font-mono text-xs text-nova-cyan">
              {RUNTIME_STATUS.cluster}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-nova-cyan/70" />
              <span className="relative inline-flex size-2 rounded-full bg-nova-cyan" />
            </span>
            <span className="text-xs text-muted-foreground">
              {RUNTIME_STATUS.state}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg px-1 py-1 text-[0.6875rem] leading-relaxed text-muted-foreground/70">
          <Orbit className="mt-0.5 size-3.5 shrink-0 text-nova-violet" />
          <span>{NOVA_BRAND.sloganZh}</span>
        </div>
      </div>
    </aside>
  );
}
