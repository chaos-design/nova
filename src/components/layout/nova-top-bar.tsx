import { LiveClock } from "./live-clock";
import { MobileNav } from "./mobile-nav";
import { RUNTIME_STATUS } from "./nav-config";

/** 全局顶栏：移动端导航 + 集群运行状态 */
export function NovaTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/8 bg-background/70 px-4 backdrop-blur-xl lg:px-6">
      <MobileNav />

      <div className="flex items-center gap-2 text-xs text-muted-foreground lg:hidden">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-nova-cyan/70" />
          <span className="relative inline-flex size-2 rounded-full bg-nova-cyan" />
        </span>
        <span className="font-mono">{RUNTIME_STATUS.cluster}</span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="nova-mono-label rounded-md border border-nova-violet/25 bg-nova-violet/10 px-2 py-1 text-nova-violet">
            深空模式
          </span>
        </div>
        <div className="nova-hairline h-5 w-px" />
        <LiveClock />
      </div>
    </header>
  );
}
