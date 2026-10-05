import { cn } from "cn";
import { Sparkles } from "lucide-react";
import { NOVA_BRAND } from "@/lib/nova";

/** NOVA 品牌标识：轨道环 + 星芒 + 中英文字标 */
export function NovaLogo({
  className,
  compact = false,
}: {
  className?: string;
  /** 紧凑模式只显示图形，不显示文字 */
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative grid size-9 shrink-0 place-items-center">
        <div className="absolute inset-0 rounded-full border border-nova-cyan/40" />
        <div className="absolute inset-[5px] animate-nova-pulse rounded-full border border-nova-violet/50" />
        <Sparkles className="size-4 text-nova-cyan nova-glow-text" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="font-heading text-base font-semibold tracking-[0.18em] text-nova-starlight">
            {NOVA_BRAND.fullName}
          </div>
          <div className="nova-mono-label whitespace-nowrap text-[0.625rem] tracking-[0.12em] text-nova-cyan/70">
            {NOVA_BRAND.logoTag}
          </div>
        </div>
      )}
    </div>
  );
}
