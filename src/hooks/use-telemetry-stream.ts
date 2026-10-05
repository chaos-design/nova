"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { telemetryPointAt } from "@/lib/nova/mock-data";
import type { TelemetryPoint } from "@/lib/nova/types";

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_WINDOW = 60;

interface StreamState {
  points: TelemetryPoint[];
  /** 已推进到的采样点序号 */
  cursor: number;
}

/**
 * 实时遥测流。
 *
 * 采样值由 `telemetryPointAt(cursor)` 纯函数推导：序号连续，服务端预渲染的
 * 种子与客户端后续采样天然衔接，不会出现 hydration 不一致或曲线跳变。
 */
export function useTelemetryStream({
  seed,
  intervalMs = DEFAULT_INTERVAL_MS,
  windowSize = DEFAULT_WINDOW,
  paused: initialPaused = false,
}: {
  seed: readonly TelemetryPoint[];
  intervalMs?: number;
  windowSize?: number;
  paused?: boolean;
}) {
  const [state, setState] = useState<StreamState>(() => ({
    points: [...seed],
    cursor: seed.length - 1,
  }));
  const [paused, setPaused] = useState(initialPaused);

  useEffect(() => {
    if (paused) return;

    const timer = window.setInterval(() => {
      setState((prev) => {
        const cursor = prev.cursor + 1;
        const points = [...prev.points, telemetryPointAt(cursor)];
        return {
          cursor,
          points:
            points.length > windowSize
              ? points.slice(points.length - windowSize)
              : points,
        };
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [paused, intervalMs, windowSize]);

  const toggle = useCallback(() => setPaused((prev) => !prev), []);

  return useMemo(
    () => ({
      points: state.points,
      latest: state.points[state.points.length - 1],
      cursor: state.cursor,
      paused,
      toggle,
      setPaused,
    }),
    [state, paused, toggle],
  );
}
