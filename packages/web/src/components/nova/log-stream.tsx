"use client";

import { cn } from "cn";
import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SimulationLog } from "@/lib/nova";
import {
  formatDuration,
  LOG_LEVEL_BAR_CLASS,
  LOG_LEVEL_CLASS,
} from "@/lib/nova";

/**
 * 日志流视图。
 *
 * 遥测中枢的事件总线与沙盒模拟的运行日志共用本组件：
 * 等级配色、发言方标记、时间基准全部一致，
 * 因此两处终端看起来是同一套东西。
 */
export function LogStream({
  logs,
  className,
  emptyHint = "等待事件…",
}: {
  logs: readonly SimulationLog[];
  className?: string;
  emptyHint?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const lastLogId = logs.at(-1)?.id ?? "";

  // 新增日志时跟随到底部；用户主动上滑查看历史时则不打断
  useEffect(() => {
    const node = viewport.current;
    if (!node || !lastLogId) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance < 56) node.scrollTop = node.scrollHeight;
  }, [lastLogId]);

  if (logs.length === 0) {
    return (
      <div
        className={cn(
          "grid h-72 place-items-center font-mono text-xs text-muted-foreground",
          className,
        )}
      >
        {emptyHint}
      </div>
    );
  }

  return (
    <ScrollArea ref={viewport} className={cn("h-72", className)}>
      <ol className="space-y-1 pr-3 font-mono text-xs">
        {logs.map((log) => (
          <li
            key={log.id}
            className="grid grid-cols-[auto_1fr] items-start gap-2 rounded px-1 py-0.5 transition-colors hover:bg-white/3"
          >
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "h-3 w-0.5 rounded-full",
                  LOG_LEVEL_BAR_CLASS[log.level],
                )}
              />
              <span className="text-muted-foreground/70 tabular-nums">
                {formatDuration(log.atMs)}
              </span>
            </span>
            <span className="min-w-0">
              <span className="text-muted-foreground/50">#{log.step}</span>{" "}
              <span className={cn("uppercase", LOG_LEVEL_CLASS[log.level])}>
                [{log.actor}]
              </span>{" "}
              <span className="text-foreground/90">{log.message}</span>
              {log.detail && (
                <span className="block truncate text-[0.6875rem] text-muted-foreground/70">
                  ↳ {log.detail}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}
