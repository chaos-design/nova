import { cn } from "cn";
import { Cpu } from "lucide-react";
import type { AgentProfile } from "@/lib/nova/types";

/** Agent 身份块：代号 + 中文别名 + 模型与版本 */
export function AgentIdentity({
  agent,
  className,
  showOwner = false,
}: {
  agent: AgentProfile;
  className?: string;
  showOwner?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div
        className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-nova-cyan/25 bg-nova-cyan/8 font-mono text-xs font-semibold text-nova-cyan"
        aria-hidden="true"
      >
        {agent.name.slice(0, 2)}
        <span className="absolute inset-x-0 top-0 h-px bg-nova-cyan/60" />
      </div>

      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {agent.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {agent.codename}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.6875rem] text-muted-foreground/80">
          <Cpu className="size-3" />
          <span className="truncate">{agent.model}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="shrink-0">{agent.version}</span>
          {showOwner && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="truncate">{agent.owner}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
