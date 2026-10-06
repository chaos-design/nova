"use client";

import { Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  type AccentPreset,
  applyAppearance,
  DEFAULT_ACCENT,
  DEFAULT_MOTION,
  MOTION_PRESETS,
  MOTION_STORAGE_KEY,
  type MotionPreference,
} from "@/lib/nova";

/** 主色色块：在自身上声明预设，靠 CSS 变量把该预设的颜色解出来，不在 TS 里重复色值 */
function AccentSwatch({ preset }: { preset: AccentPreset }) {
  return (
    <span
      aria-hidden="true"
      data-nova-accent={preset}
      className="size-3.5 shrink-0 rounded-full bg-nova-accent ring-1 ring-white/15"
    />
  );
}

/**
 * 界面设置。
 *
 * 只有主色与动效两项 —— 明暗不在其中：NOVA 的深空是产品识别符号而不是默认
 * 皮肤（`docs/architecture.md` §7.1）。改动立刻写进 `<html>` 的 data 属性，
 * 不刷新页面，因此界面组件不需要订阅这份状态。
 */
export function AppearanceMenu({
  className,
  collapsed = false,
  variant = "ghost",
}: {
  className?: string;
  /** 侧边栏收起态下只留图标 */
  collapsed?: boolean;
  variant?: "ghost" | "outline";
}) {
  const [accent, setAccent] = useState<AccentPreset>(DEFAULT_ACCENT);
  const [motion, setMotion] = useState<MotionPreference>(DEFAULT_MOTION);

  // 服务端不知道 localStorage，首帧统一按默认值渲染，挂载后再对齐真实偏好
  useEffect(() => {
    const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    const storedMotion = window.localStorage.getItem(MOTION_STORAGE_KEY);
    if (storedAccent && isAccent(storedAccent)) setAccent(storedAccent);
    if (storedMotion && isMotion(storedMotion)) setMotion(storedMotion);
  }, []);

  function changeAccent(next: string) {
    if (!isAccent(next)) return;
    setAccent(next);
    window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    applyAppearance(next, motion);
  }

  function changeMotion(next: string) {
    if (!isMotion(next)) return;
    setMotion(next);
    window.localStorage.setItem(MOTION_STORAGE_KEY, next);
    applyAppearance(accent, next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={collapsed ? "icon-sm" : "sm"}
          className={className}
          aria-label="界面设置"
        >
          <Palette data-icon={collapsed ? undefined : "inline-start"} />
          {!collapsed && "界面设置"}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>界面主色</DropdownMenuLabel>
          <p className="px-1.5 pb-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground/80">
            仅作用于导航、焦点环与星云辉光；图表与状态色是语义色，不随主色变化。
          </p>
          <DropdownMenuRadioGroup value={accent} onValueChange={changeAccent}>
            {ACCENT_PRESETS.map((preset) => (
              <DropdownMenuRadioItem
                key={preset.id}
                value={preset.id}
                className="pl-2"
              >
                <AccentSwatch preset={preset.id} />
                {preset.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>动效</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={motion} onValueChange={changeMotion}>
            {MOTION_PRESETS.map((preset) => (
              <DropdownMenuRadioItem
                key={preset.id}
                value={preset.id}
                className="pl-2"
              >
                {preset.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isAccent(value: string): value is AccentPreset {
  return ACCENT_PRESETS.some((preset) => preset.id === value);
}

function isMotion(value: string): value is MotionPreference {
  return MOTION_PRESETS.some((preset) => preset.id === value);
}
