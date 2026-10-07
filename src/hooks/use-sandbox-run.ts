"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  type ExecutorId,
  type ExecutorResult,
  type SandboxEvent,
  stepToLog,
} from "@/lib/nova/executor";
import { runSimulation } from "@/lib/nova/executors/simulation";
import type {
  AgentProfile,
  SimulationConfig,
  SimulationLog,
} from "@/lib/nova/types";

/** 运行状态机 */
export type RunStatus = "idle" | "running" | "completed" | "failed";

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
 * 两种执行器共用这一条状态机：
 * - `simulation` 在本进程内消费异步生成器，零网络开销；
 * - `live` 通过 `POST /api/sandbox/run` 消费 SSE 流。
 *
 * 事件语义相同，因此 UI 层只有一份渲染代码、一个进度条、一套错误处理。
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

  /** 本地仿真执行器 */
  const runLocal = useCallback(
    async (config: SimulationConfig, agent: AgentProfile) => {
      const controller = prepare();

      try {
        for await (const event of runSimulation(
          config,
          agent,
          controller.signal,
        )) {
          consume(event, config.maxSteps);
        }
      } catch (caught) {
        setError({ message: describe(caught) });
        setStatus("failed");
      }
    },
    [consume, prepare],
  );

  /** 真实执行器：单次 POST + SSE 流式读取 */
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

        await readSse(response.body, controller.signal, (event) =>
          consume(event, config.maxSteps),
        );
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError({ message: describe(caught) });
        setStatus("failed");
      }
    },
    [consume, prepare],
  );

  /** 主动中止：执行器会在下一个检查点退出 */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("completed");
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
      runLocal,
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
      runLocal,
      runRemote,
      stop,
      reset,
    ],
  );
}

/** 读取 SSE 流并逐帧回调 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: SandboxEvent) => void,
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
          onEvent(JSON.parse(data) as SandboxEvent);
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
