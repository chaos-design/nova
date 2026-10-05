import { cn } from "cn";
import { Check, CircleDashed, Loader2, X } from "lucide-react";
import { formatDuration, VERIFICATION_STAGES } from "@/lib/nova";
import type { VerificationRun } from "@/lib/nova/types";

/** 阶段状态 → 图标与配色 */
const STATE_STYLE = {
  passed: {
    icon: Check,
    text: "text-nova-cyan",
    ring: "ring-nova-cyan/40",
    bg: "bg-nova-cyan/10",
  },
  failed: {
    icon: X,
    text: "text-nova-rose",
    ring: "ring-nova-rose/40",
    bg: "bg-nova-rose/10",
  },
  running: {
    icon: Loader2,
    text: "text-nova-amber",
    ring: "ring-nova-amber/40",
    bg: "bg-nova-amber/10",
  },
  pending: {
    icon: CircleDashed,
    text: "text-muted-foreground",
    ring: "ring-white/10",
    bg: "bg-white/4",
  },
} as const;

/**
 * 验证生命周期进度条。
 *
 * 展示 `AGENTS.md` 定义的五阶段流水线：接入 → 静态校验 → 场景执行 →
 * 爆发评估 → 发证。失败阶段会中断其后的推进（视觉上不再点亮）。
 */
export function VerificationStepper({
  run,
  className,
}: {
  run: VerificationRun;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <ol className="grid gap-3 sm:grid-cols-5">
        {VERIFICATION_STAGES.map((stage, index) => {
          const result =
            run.stages.find((item) => item.stage === stage.id) ??
            run.stages[index];
          const state = result?.state ?? "pending";
          const style = STATE_STYLE[state];
          const Icon = style.icon;

          return (
            <li key={stage.id} className="relative">
              {/* 阶段连接线 */}
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-4 -left-3 hidden h-px w-3 bg-white/10 sm:block"
                />
              )}

              <div className="flex items-center gap-2 sm:block">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full ring-1",
                      style.bg,
                      style.ring,
                      style.text,
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4",
                        state === "running" && "animate-spin",
                      )}
                    />
                  </span>
                  <span className="nova-mono-label text-[0.5625rem] text-muted-foreground/70 sm:hidden">
                    {index + 1}/{VERIFICATION_STAGES.length}
                  </span>
                </div>

                <div className="mt-0 min-w-0 sm:mt-3">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      state === "pending"
                        ? "text-muted-foreground/70"
                        : "text-foreground",
                    )}
                  >
                    {stage.label}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
                    {result?.summary ?? stage.description}
                  </p>
                  {result && result.durationMs > 0 && (
                    <p className="mt-1 font-mono text-[0.625rem] text-muted-foreground/60">
                      耗时 {formatDuration(result.durationMs)}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
