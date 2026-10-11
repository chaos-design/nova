"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ConverseChatMessage,
  type ConverseEvent,
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
  userText: string;
  status: ConverseTurnStatus;
  logs: SimulationLog[];
  result: ConverseTurnResult | null;
  error: { message: string; hint?: string } | null;
}

/** 会话级累计观测 */
export interface ConverseSessionTotals {
  turns: number;
  completedTurns: number;
  totalTokens: number;
  totalToolCalls: number;
  injectionObeyed: boolean;
}

/**
 * 对话验证状态机。
 *
 * 通过 `POST /api/agents/converse` 消费 SSE 流驱动：服务端真实执行、
 * 逐帧回传事件，客户端只做乐观渲染与中止。
 *
 * 历史只由**成功完成的轮次**拼出：失败轮不确定是否被 Agent 读到，
 * 拼进去会让"没送达的话"参与下一轮决策。
 */
export function useConverse() {
  const [turns, setTurns] = useState<ConverseTurn[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const turnSeqRef = useRef(0);
  const turnsRef = useRef<ConverseTurn[]>([]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // 离开对话页时中止进行中的轮次：真实执行器可能还在流式消耗模型 token
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
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
    (turnId: string, updater: (turn: ConverseTurn) => ConverseTurn) => {
      setTurns((prev) =>
        prev.map((turn) => (turn.id === turnId ? updater(turn) : turn)),
      );
    },
    [],
  );

  /** 事件 → 单轮状态；未知类型走兜底置 failed（服务端与客户端版本不一致时） */
  const consumeEvent = useCallback(
    (turnId: string, event: ConverseEvent) => {
      switch (event.type) {
        case "meta":
          break;

        case "step":
          patchTurn(turnId, (turn) => ({
            ...turn,
            logs: [
              ...turn.logs,
              stepToConverseLog(
                event.step,
                Date.now() - startedAtRef.current,
                turnId,
              ),
            ],
          }));
          break;

        case "turn":
          patchTurn(turnId, (turn) => ({
            ...turn,
            status: "completed",
            result: event.turn,
          }));
          break;

        case "error":
          patchTurn(turnId, (turn) => ({
            ...turn,
            status: "failed",
            error: { message: event.message, hint: event.hint },
          }));
          break;

        default: {
          const unknown = event as { type?: string };
          patchTurn(turnId, (turn) => ({
            ...turn,
            status: "failed",
            error: { message: `收到未知事件类型：${unknown.type ?? "?"}` },
          }));
        }
      }
    },
    [patchTurn],
  );

  /** 发送一条用户消息：乐观落台 + 服务端流式驱动回复 */
  const send = useCallback(
    async (agentId: string, text: string) => {
      const userMessage = text.trim();
      // 上一轮还在跑时不叠发：SSE 流是单条的，叠发只会互相取消
      if (!userMessage || abortRef.current !== null) return;

      const controller = new AbortController();
      abortRef.current = controller;
      startedAtRef.current = Date.now();
      turnSeqRef.current += 1;
      const turnId = `turn-${turnSeqRef.current}`;

      const history = buildHistory(turnsRef.current);

      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          userText: userMessage,
          status: "running",
          logs: [],
          result: null,
          error: null,
        },
      ]);

      try {
        const response = await fetch("/api/agents/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, history, userMessage }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
            hint?: string;
          } | null;

          patchTurn(turnId, (turn) => ({
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
            consumeEvent(turnId, event);
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
        patchTurn(turnId, (turn) => ({
          ...turn,
          status: "failed",
          error: { message: describe(caught) },
        }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [buildHistory, consumeEvent, patchTurn],
  );

  /** 主动中止：服务端在下一个检查点退出；空闲时按下不做任何事 */
  const stop = useCallback(() => {
    if (abortRef.current === null) return;
    abortRef.current.abort();
    abortRef.current = null;
    // 中止不是失败：单独成态，让界面能区分「跑完了」与「被手动停了」
    setTurns((prev) =>
      prev.map((turn) =>
        turn.status === "running" ? { ...turn, status: "stopped" } : turn,
      ),
    );
  }, []);

  /** 清空会话：下一轮的历史从头开始 */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    turnSeqRef.current = 0;
    setTurns([]);
  }, []);

  const sending = turns.some((turn) => turn.status === "running");

  const sessionTotals = useMemo<ConverseSessionTotals>(() => {
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
  }, [turns]);

  return useMemo(
    () => ({
      turns,
      sending,
      sessionTotals,
      send,
      stop,
      reset,
    }),
    [turns, sending, sessionTotals, send, stop, reset],
  );
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
