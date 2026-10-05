"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logIdOf, type SimulationPlan } from "@/lib/nova/simulation";
import type { SimulationLog } from "@/lib/nova/types";

/** 沙盒播放状态机 */
export type SimulationStatus = "idle" | "running" | "completed";

/** 把剧本切片转换为带累计偏移量的日志序列 */
function toLogs(plan: SimulationPlan, cursor: number): SimulationLog[] {
  const logs: SimulationLog[] = [];
  let atMs = 0;

  for (const step of plan.steps) {
    if (step.step > cursor) break;
    atMs += step.delayMs;
    logs.push({
      id: logIdOf(step.step),
      atMs,
      step: step.step,
      level: step.level,
      actor: step.actor,
      message: step.message,
      detail: step.detail,
    });
  }

  return logs;
}

/**
 * 沙盒剧本播放器。
 *
 * 只持有 `cursor` 一个状态，日志、得分、进度全部由剧本 + cursor 派生，
 * 因此不存在"状态与日志不一致"这类问题，暂停/重放也只是移动游标。
 */
export function useSimulationRun(plan: SimulationPlan | null) {
  const [cursor, setCursor] = useState(-1);
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const lastPlan = useRef(plan);

  const reset = useCallback(() => {
    setCursor(-1);
    setStatus("idle");
  }, []);

  // 配置变化意味着剧本变化，直接回到初始态
  useEffect(() => {
    if (lastPlan.current === plan) return;
    lastPlan.current = plan;
    reset();
  }, [plan, reset]);

  const start = useCallback(() => {
    setCursor(-1);
    setStatus("running");
  }, []);

  const stop = useCallback(() => setStatus("idle"), []);

  useEffect(() => {
    if (status !== "running" || !plan) return;

    const lastStep = plan.steps.length - 1;
    if (cursor >= lastStep) {
      setStatus("completed");
      return;
    }

    const delay = plan.steps[cursor + 1]?.delayMs ?? 0;
    const timer = window.setTimeout(() => setCursor(cursor + 1), delay);
    return () => window.clearTimeout(timer);
  }, [status, plan, cursor]);

  const logs = useMemo(
    () => (plan && cursor >= 0 ? toLogs(plan, cursor) : []),
    [plan, cursor],
  );

  return useMemo(() => {
    const total = plan?.steps.length ?? 0;
    const played = plan ? Math.min(cursor + 1, total) : 0;

    return {
      status,
      cursor,
      logs,
      total,
      played,
      progress: total === 0 ? 0 : played / total,
      /** 当前累计得分，尚未开始时为满分 */
      score:
        plan && cursor >= 0 ? (plan.steps[cursor]?.scoreAfter ?? 100) : 100,
      /** 仅在播放完成后才有结论 */
      result: status === "completed" && plan ? plan.result : null,
      start,
      stop,
      reset,
    };
  }, [status, cursor, logs, plan, start, stop, reset]);
}
