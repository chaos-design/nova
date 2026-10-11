"use client";

import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AppearanceMenu } from "./appearance-menu";
import { SearchTrigger } from "./global-search";
import { RUNTIME_STATUS } from "./nav-config";
import { NavList } from "./nav-list";
import { NovaLogo } from "./nova-logo";

/** 移动端导航抽屉：结构与桌面侧边栏保持一致，只是恒为展开态 */
export function MobileNav({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const [open, setOpen] = useState(false);

  // 视窗放大到 lg 断点后关闭抽屉，避免抽屉状态残留
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const handle = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", handle);
    return () => query.removeEventListener("change", handle);
  }, []);

  function closeAndOpenSearch() {
    setOpen(false);
    onOpenSearch?.();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="lg:hidden"
          aria-label="打开导航"
        >
          <Menu />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        className="flex w-72 flex-col border-white/10 bg-sidebar/95 p-0"
      >
        <SheetHeader className="border-b border-white/8 px-5 py-4">
          <SheetTitle>
            <NovaLogo />
          </SheetTitle>
          <SheetDescription className="sr-only">
            前往遥测、注册表、矩阵、沙盒与排行榜页面。
          </SheetDescription>
        </SheetHeader>

        <div className="px-3 py-4">
          <SearchTrigger onClick={closeAndOpenSearch} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NavList onNavigate={() => setOpen(false)} />
        </div>

        {/* 与桌面侧边栏同构的吸底区 */}
        <div className="space-y-3 border-t border-white/8 p-4">
          <div className="nova-panel rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="nova-mono-label text-muted-foreground">
                集群
              </span>
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
          <AppearanceMenu className="w-full" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
