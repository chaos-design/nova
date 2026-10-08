"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ExecutorId,
  type ExecutorResult,
  type SandboxEvent,
  stepToLog,
} from "@/lib/nova/executor";
import type { SimulationConfig, SimulationLog } from "@/lib/nova/types";

/** 运行状态机 */
export type RunStatus = "idle" | "running" | "completed" | "failed" | "stopped";

/** 元信息（由执行器的 meta 事件提供） */
export interface RunMeta {
  executor: ExecutorId;
  agentId: string;
  agentName: string;
  model: string;
  /** 计划总轮数；真实执行器可能为 null（轮数由模型决定） */
  totalSteps: number | null;
}

/** 运行失败信息 */
export interface RunError {
  message: string;
  hint?: string;
}

/** 单次运行保留的最大日志条数，防止长跑撑爆内存 */
const MAX_BUFFER_LOGS = 400;

/**
 * 沙盒运行的统一状态机。
 *
 * 通过 `POST /api/sandbox/run` 消费 SSE 流驱动：服务端真实执行、
 * 逐帧回传事件，客户端只做渲染与中止。
 * 状态里只有 6 个字段，全部由事件单向驱动，没有任何派生副本。
 */
export function useSandboxRun() {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [logs, setLogs] = useState<SimulationLog[]>([]);
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [result, setResult] = useState<ExecutorResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const [score, setScore] = useState(100);
  const [round, setRound] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);

  // 离开沙盒页时中止进行中的运行：真实执行器可能还在流式消耗模型 token，
  // 本地仿真也在继续推进 —— 卸载不清理等于把运行变成脱缰的野马
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setLogs([]);
    setMeta(null);
    setResult(null);
    setError(null);
    setScore(100);
    setRound(0);
  }, []);

  /** 统一的事件处理：两种执行器的差异到此为止 */
  const consume = useCallback((event: SandboxEvent, fallbackTotal: number) => {
    const elapsed = Date.now() - startedAt.current;

    switch (event.type) {
      case "meta":
        setMeta({
          executor: event.executor,
          agentId: event.agentId,
          agentName: event.agentName,
          model: event.model,
          totalSteps: event.totalSteps ?? fallbackTotal,
        });
        break;

      case "step":
        setLogs((prev) =>
          prev.length >= MAX_BUFFER_LOGS
            ? [
                ...prev.slice(-(MAX_BUFFER_LOGS - 1)),
                stepToLog(event.step, elapsed),
              ]
            : [...prev, stepToLog(event.step, elapsed)],
        );
        setScore(event.step.scoreAfter);
        setRound(event.step.round);
        break;

      case "done":
        setResult(event.result);
        setScore(event.result.score);
        setStatus("completed");
        break;

      case "error":
        setError({ message: event.message, hint: event.hint });
        setStatus("failed");
        break;

      default: {
        // 类型层面已穷尽分支；此处是运行时兜底（服务端与客户端版本不一致）
        const unknown = event as { type?: string };
        setError({ message: `收到未知事件类型：${unknown.type ?? "?"}` });
        setStatus("failed");
      }
    }
  }, []);

  /** 启动一次运行前的统一准备 */
  const prepare = useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    startedAt.current = Date.now();

    setStatus("running");
    setLogs([]);
    setResult(null);
    setError(null);
    setScore(100);
    setRound(0);

    return controller;
  }, []);

  /** 单次 POST + SSE 流式读取 */
  const runRemote = useCallback(
    async (config: SimulationConfig) => {
      const controller = prepare();

      try {
        const response = await fetch("/api/sandbox/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: config.agentId,
            systemPrompt: config.systemPrompt,
            environment: config.environment,
            chaos: config.chaos,
            maxSteps: config.maxSteps,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
            hint?: string;
          } | null;
          setError({
            message: body?.message ?? `请求失败（${response.status}）`,
            hint: body?.hint,
          });
          setStatus("failed");
          return;
        }

        await readSse(response.body, controller.signal, (event) => {
          consume(event, config.maxSteps);
          // 结论或错误已落定：没有必要继续读到 EOF，立即断流省掉空转
          return event.type === "done" || event.type === "error"
            ? "stop"
            : "continue";
        });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError({ message: describe(caught) });
        setStatus("failed");
      }
    },
    [consume, prepare],
  );

  /** 主动中止：执行器会在下一个检查点退出；空闲时按下不做任何事 */
  const stop = useCallback(() => {
    if (abortRef.current === null) return;
    abortRef.current.abort();
    abortRef.current = null;
    // 中止不是完成：单独成态，让界面能区分「跑完了」与「被手动停了」
    setStatus("stopped");
  }, []);

  const total = meta?.totalSteps ?? 0;

  return useMemo(
    () => ({
      status,
      logs,
      meta,
      result,
      error,
      score,
      round,
      total,
      /** 已产出的日志条数 */
      played: logs.length,
      progress: total === 0 ? 0 : Math.min(round / total, 1),
      running: status === "running",
      runRemote,
      stop,
      reset,
    }),
    [
      status,
      logs,
      meta,
      result,
      error,
      score,
      round,
      total,
      runRemote,
      stop,
      reset,
    ],
  );
}

/** 读取 SSE 流并逐帧回调；回调返回 "stop" 时立即取消读取 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: SandboxEvent) => "continue" | "stop",
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abortHandler = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abortHandler);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分帧；末尾可能是不完整的片段，留给下一批
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;

        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);

        if (!data) continue;

        try {
          if (onEvent(JSON.parse(data) as SandboxEvent) === "stop") {
            await reader.cancel().catch(() => undefined);
            return;
          }
        } catch {
          // 单帧解析失败不应中断整条流
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }
}

function describe(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
