"use client";

import { Radio } from "lucide-react";
import { useEffect, useState } from "react";

/** 挂载后渲染的真实时钟（UTC），挂载前显示占位符以避免 hydration 不一致 */
export function LiveClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      setTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          timeZone: "UTC",
        }),
      );
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums">
      <Radio className="size-3 text-nova-cyan" />
      UTC {time ?? "--:--:--"}
    </span>
  );
}
