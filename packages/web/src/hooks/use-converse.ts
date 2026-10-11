"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConverseChatMessage,
  type ConverseEvent,
  type ConverseOverrides,
  type ConverseStep,
  type ConverseTurnResult,
  readSseStream,
  type SimulationLog,
} from "@/lib/nova";

/** 单轮状态 */
export type ConverseTurnStatus = "running" | "completed" | "failed" | "stopped";

/** 一条对话轮：用户消息 + 服务端执行产物 */
export interface ConverseTurn {
  id: string;
  /** 归属 Agent：多选目标后合并流里按它标注与分桶 */
  agentId: string;
  /** 创建时间戳：多 Agent 会话合并展示时排序用 */
  createdAt: number;
  userText: string;
  status: ConverseTurnStatus;
  logs: SimulationLog[];
  result: ConverseTurnResult | null;
  error: { message: string; hint?: string } | null;
}

/** 会话级累计观测（按 Agent 分别计算） */
export interface ConverseSessionTotals {
  turns: number;
  completedTurns: number;
  totalTokens: number;
  totalToolCalls: number;
  injectionObeyed: boolean;
}

/**
 * 多 Agent 对话验证状态机。
 *
 * 会话按 agentId 分桶：每个 Agent 一条独立会话，切换目标不丢历史，
 * 「清空会话」只清当前 Agent。流式执行按 Agent 各自持有
 * AbortController，因此可以**并行**验证多个 Agent 而互不取消；
 * 同一 Agent 的上一轮没跑完时不叠发（SSE 流是单条的）。
 *
 * 历史只由**成功完成的轮次**拼出：失败轮不确定是否被 Agent 读到，
 * 拼进去会让"没送达的话"参与下一轮决策。
 */
export function useConverse() {
  const [sessions, setSessions] = useState<Record<string, ConverseTurn[]>>({});

  /** 每个 Agent 一条流；键为 agentId */
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());
  const startedAtRef = useRef<Map<string, number>>(new Map());
  const turnSeqRef = useRef(0);
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 离开页面时中止所有在跑的流：真实执行器可能还在消耗模型 token
  useEffect(
    () => () => {
      for (const controller of abortMapRef.current.values()) {
        controller.abort();
      }
      abortMapRef.current.clear();
    },
    [],
  );

  /** 用已完成的轮次拼出本轮回发的完整对话上下文 */
  const buildHistory = useCallback(
    (source: readonly ConverseTurn[]): ConverseChatMessage[] => {
      const history: ConverseChatMessage[] = [];
      for (const turn of source) {
        if (turn.status !== "completed" || !turn.result) continue;
        history.push({ role: "user", content: turn.userText });
        history.push(...turn.result.replyMessages);
      }
      return history;
    },
    [],
  );

  const patchTurn = useCallback(
    (
      agentId: string,
      turnId: string,
      updater: (turn: ConverseTurn) => ConverseTurn,
    ) => {
      setSessions((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] ?? []).map((turn) =>
          turn.id === turnId ? updater(turn) : turn,
        ),
      }));
    },
    [],
  );

  /** 事件 → 单轮状态；未知类型走兜底置 failed（服务端与客户端版本不一致时） */
  const consumeEvent = useCallback(
    (agentId: string, turnId: string, event: ConverseEvent) => {
      switch (event.type) {
        case "meta":
          break;

        case "step":
          patchTurn(agentId, turnId, (turn) => ({
            ...turn,
            logs: [
              ...turn.logs,
              stepToConverseLog(
                event.step,
                Date.now() - (startedAtRef.current.get(agentId) ?? Date.now()),
                turnId,
              ),
            ],
          }));
          break;

        case "turn":
          patchTurn(agentId, turnId, (turn) => ({
            ...turn,
            status: "completed",
            result: event.turn,
          }));
          break;

        case "error":
          patchTurn(agentId, turnId, (turn) => ({
            ...turn,
            status: "failed",
            error: { message: event.message, hint: event.hint },
          }));
          break;

        default: {
          const unknown = event as { type?: string };
          patchTurn(agentId, turnId, (turn) => ({
            ...turn,
            status: "failed",
            error: { message: `收到未知事件类型：${unknown.type ?? "?"}` },
          }));
        }
      }
    },
    [patchTurn],
  );

  /** 发送一条用户消息：乐观落台 + 服务端流式驱动回复（可与其他 Agent 并行） */
  const send = useCallback(
    async (agentId: string, text: string, overrides?: ConverseOverrides) => {
      const userMessage = text.trim();
      if (!userMessage) return;
      // 同一 Agent 不叠发；不同 Agent 之间互不影响，可并行验证
      if (abortMapRef.current.has(agentId)) return;

      const controller = new AbortController();
      abortMapRef.current.set(agentId, controller);
      startedAtRef.current.set(agentId, Date.now());
      turnSeqRef.current += 1;
      const turnId = `turn-${agentId}-${turnSeqRef.current}`;

      const history = buildHistory(sessionsRef.current[agentId] ?? []);

      setSessions((prev) => ({
        ...prev,
        [agentId]: [
          ...(prev[agentId] ?? []),
          {
            id: turnId,
            agentId,
            createdAt: Date.now(),
            userText: userMessage,
            status: "running" as const,
            logs: [],
            result: null,
            error: null,
          },
        ],
      }));

      try {
        const response = await fetch("/api/agents/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            history,
            userMessage,
            overrides,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
            hint?: string;
          } | null;

          patchTurn(agentId, turnId, (turn) => ({
            ...turn,
            status: "failed",
            error: {
              message: body?.message ?? `请求失败（${response.status}）`,
              hint: body?.hint,
            },
          }));
          return;
        }

        await readSseStream<ConverseEvent>(
          response.body,
          controller.signal,
          (event) => {
            consumeEvent(agentId, turnId, event);
            // 结论或错误已落定：没有必要继续读到 EOF，立即断流省掉空转
            return event.type === "turn" || event.type === "error"
              ? "stop"
              : "continue";
          },
        );
      } catch (caught) {
        // 主动中止（stop / 卸载）不是失败：状态由 stop() 已置为 stopped
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        patchTurn(agentId, turnId, (turn) => ({
          ...turn,
          status: "failed",
          error: { message: describe(caught) },
        }));
      } finally {
        if (abortMapRef.current.get(agentId) === controller) {
          abortMapRef.current.delete(agentId);
        }
      }
    },
    [buildHistory, consumeEvent, patchTurn],
  );

  /** 中止指定 Agent 的在跑流；空闲时按下不做任何事 */
  const stop = useCallback((agentId: string) => {
    const controller = abortMapRef.current.get(agentId);
    if (!controller) return;
    controller.abort();
    abortMapRef.current.delete(agentId);
    // 中止不是失败：单独成态，让界面能区分「跑完了」与「被手动停了」
    setSessions((prev) => ({
      ...prev,
      [agentId]: (prev[agentId] ?? []).map((turn) =>
        turn.status === "running"
          ? { ...turn, status: "stopped" as const }
          : turn,
      ),
    }));
  }, []);

  /** 清空指定 Agent 的会话：下一轮的历史从头开始 */
  const reset = useCallback((agentId: string) => {
    const controller = abortMapRef.current.get(agentId);
    if (controller) {
      controller.abort();
      abortMapRef.current.delete(agentId);
    }
    setSessions((prev) => {
      if (!(agentId in prev)) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  return { sessions, send, stop, reset };
}

/** 单 Agent 会话的累计读数；组件里按激活会话调用 */
export function sessionTotalsOf(
  turns: readonly ConverseTurn[],
): ConverseSessionTotals {
  let completedTurns = 0;
  let totalTokens = 0;
  let totalToolCalls = 0;
  let injectionObeyed = false;

  for (const turn of turns) {
    if (turn.status !== "completed" || !turn.result) continue;
    completedTurns += 1;
    totalTokens += turn.result.usage.totalTokens;
    totalToolCalls += turn.result.toolCalls.length;
    if (turn.result.injectionObeyed) injectionObeyed = true;
  }

  return {
    turns: turns.length,
    completedTurns,
    totalTokens,
    totalToolCalls,
    injectionObeyed,
  };
}

/** 对话步 → 日志流条目；时间基准是本轮真实经过时间（与沙盒同一约定） */
function stepToConverseLog(
  step: ConverseStep,
  atMs: number,
  turnId: string,
): SimulationLog {
  return {
    id: `${turnId}-s${String(step.step).padStart(3, "0")}`,
    step: step.step,
    atMs,
    level: step.level,
    actor: step.actor,
    message: step.message,
    detail: step.detail,
  };
}

function describe(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
