"use client";

import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavList } from "./nav-list";
import { NovaLogo } from "./nova-logo";

/** 移动端导航抽屉 */
export function MobileNav() {
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
        className="w-72 border-white/10 bg-sidebar/95 p-0"
      >
        <SheetHeader className="border-b border-white/8 px-5 py-4">
          <SheetTitle>
            <NovaLogo />
          </SheetTitle>
        </SheetHeader>
        <div className="px-3 py-5">
          <NavList onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
