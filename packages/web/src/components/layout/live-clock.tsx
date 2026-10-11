"use client";

import { Radio } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DISPLAY_TIME_ZONE,
  DISPLAY_TIME_ZONE_LABEL,
  formatClockNow,
} from "@/lib/nova";

/**
 * 挂载后渲染的真实时钟（北京时间）。
 *
 * 首帧不渲染真实时间：客户端与服务端各算一次必然有偏差，
 * 那是 hydration 不一致的经典来源，不如留一个等宽占位符。
 */
export function LiveClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(formatClockNow());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time
      className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums"
      title={`北京时间 · ${DISPLAY_TIME_ZONE} (${DISPLAY_TIME_ZONE_LABEL})`}
    >
      <Radio className="size-3 text-nova-accent" />
      北京 {time ?? "--:--:--"}
    </time>
  );
}
