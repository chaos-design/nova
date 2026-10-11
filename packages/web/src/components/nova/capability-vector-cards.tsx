import { cn } from "cn";
import { Brain, Gauge, MemoryStick, Waypoints } from "lucide-react";
import type { CapabilityVectorId } from "@/lib/nova";
import { ACCENT_TEXT, CAPABILITY_VECTORS } from "@/lib/nova";

/** 四大能力向量的图标（服务端可直接渲染） */
const VECTOR_ICONS = {
  autonomy: Gauge,
  toolUsage: Waypoints,
  memory: MemoryStick,
  reasoning: Brain,
} satisfies Record<
  CapabilityVectorId,
  React.ComponentType<{ className?: string }>
>;

/**
 * 能力向量说明卡。
 *
 * 这是 NOVA 评测标准的可视化：四个向量、各自的评测指标与权重，
 * 与 `docs/nova-standard.md` 第 1 节一一对应。
 */
export function CapabilityVectorCards({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {CAPABILITY_VECTORS.map((vector) => {
        const Icon = VECTOR_ICONS[vector.id];

        return (
          <div key={vector.id} className="nova-panel rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg bg-white/4",
                  ACCENT_TEXT[vector.accent],
                )}
              >
                <Icon className="size-4" />
              </div>
              <span className="nova-mono-label text-muted-foreground/70">
                权重 {Math.round(vector.weight * 100)}%
              </span>
            </div>

            <p className="mt-3 font-heading text-base font-medium text-nova-starlight">
              {vector.label}
              <span className="ml-2 font-mono text-[0.625rem] text-muted-foreground">
                {vector.abbreviation}
              </span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {vector.description}
            </p>

            <ul className="mt-3 flex flex-wrap gap-1.5">
              {vector.metrics.map((metric) => (
                <li
                  key={metric}
                  className="rounded-md border border-white/8 bg-white/3 px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
                >
                  {metric}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
