import { cn } from "cn";
import type { AgentStatus } from "@/lib/nova";
import { STATUS_META } from "@/lib/nova";

/** Agent 状态徽章：色点 + 中文状态 */
export function AgentStatusBadge({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        meta.badgeClass,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dotClass)} />
      {meta.label}
    </span>
  );
}
