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

/** 意图分发的候选（客户端视角，description 来自登记条目的领域描述） */
export interface DispatchCandidate {
  id: string;
  name: string;
  model?: string;
  description?: string;
}

/* -------------------------------------------------------------------------- */
/* 会话落盘（localStorage）                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 会话是**累计观测记录**：刷新页面不该等于把验证过程扔掉。
 *
 * 存在浏览器本地而不是服务端，理由与 AGENTS.md 的服务端专属存储一致 ——
 * 对话验证本来就是纯观测路径、不进评分体系，把它写进 `.nova/runs.json`
 * 反而会让"观测"与"评分记录"混在一处。代价是换设备就看不到，这对
 * 一个本地自托管的控制台是可接受的。
 */
const SESSIONS_KEY = "nova:converse:sessions";

/**
 * 每个 Agent 保留的轮次上限：会话是"累计的近期过程"，不是归档 ——
 * 留 30 轮足够回看，同时把单份存储压在 5MB 配额的安全区内
 * （单轮体积主要由日志决定，见下一条上限）。
 */
const MAX_STORED_TURNS = 30;
/** 单轮保留的日志条数上限：事件流看尾部最关键 */
const MAX_STORED_LOGS = 60;
/** 写盘节流：流式执行期间事件很密，攒住再写 */
const PERSIST_DEBOUNCE_MS = 600;

/** 落盘前归一：running 是"当时页面还开着"的残留，刷新后如实记为已中止 */
function toPersistedTurn(turn: ConverseTurn): ConverseTurn {
  return {
    ...turn,
    status: turn.status === "running" ? "stopped" : turn.status,
    logs: turn.logs.slice(-MAX_STORED_LOGS),
  };
}

/** 会话 → 可落盘形状；turnsLimit 用于配额撞墙后的降级重试 */
function toPersisted(
  sessions: Record<string, ConverseTurn[]>,
  turnsLimit = MAX_STORED_TURNS,
): Record<string, ConverseTurn[]> {
  const next: Record<string, ConverseTurn[]> = {};
  for (const [agentId, turns] of Object.entries(sessions)) {
    if (turns.length === 0) continue;
    next[agentId] = turns.slice(-turnsLimit).map(toPersistedTurn);
  }
  return next;
}

/** 写一次；失败（配额满 / 隐私模式）返回 false 由调用方决定是否降级 */
function writeSessions(sessions: Record<string, ConverseTurn[]>): boolean {
  try {
    window.localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify({ version: 1, sessions }),
    );
    return true;
  } catch {
    return false;
  }
}

/** 落盘：撞配额就砍一半历史再试，仍失败则放弃本次写入（下次变更还会再试） */
function persistSessions(sessions: Record<string, ConverseTurn[]>): void {
  if (typeof window === "undefined") return;
  if (writeSessions(toPersisted(sessions))) return;
  writeSessions(
    toPersisted(sessions, Math.max(1, Math.floor(MAX_STORED_TURNS / 2))),
  );
}

/** 逐条校验并归一外部数据；损坏的轮次直接丢弃而不是让整份会话作废 */
function sanitizeStoredTurn(raw: unknown): ConverseTurn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const agentId = typeof record.agentId === "string" ? record.agentId : "";
  const userText = typeof record.userText === "string" ? record.userText : "";
  if (!id || !agentId || !userText) return null;

  const status = record.status;
  return {
    id,
    agentId,
    createdAt:
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    userText,
    // 落盘时已被归一为终态；读到 running 只可能是手工改过，按已中止处理
    status: status === "completed" || status === "failed" ? status : "stopped",
    logs: Array.isArray(record.logs)
      ? (record.logs as SimulationLog[]).slice(-MAX_STORED_LOGS)
      : [],
    result:
      typeof record.result === "object" && record.result !== null
        ? (record.result as ConverseTurn["result"])
        : null,
    error:
      typeof record.error === "object" && record.error !== null
        ? (record.error as ConverseTurn["error"])
        : null,
  };
}

/** 读回会话；损坏或缺失一律回退为空，绝不因为一份坏数据白屏 */
function loadStoredSessions(): Record<string, ConverseTurn[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { sessions?: unknown } | null;
    const sessions = parsed?.sessions;
    if (typeof sessions !== "object" || sessions === null) return {};

    const restored: Record<string, ConverseTurn[]> = {};
    for (const [agentId, turns] of Object.entries(
      sessions as Record<string, unknown>,
    )) {
      if (!Array.isArray(turns)) continue;
      const valid = turns
        .map(sanitizeStoredTurn)
        .filter((turn): turn is ConverseTurn => turn !== null);
      if (valid.length > 0) restored[agentId] = valid;
    }
    return restored;
  } catch {
    return {};
  }
}

/** 已落盘轮次 id 的序号：新轮次从这里续接，避免 id 与历史撞车 */
function maxSeqOf(sessions: Record<string, ConverseTurn[]>): number {
  let max = 0;
  for (const turns of Object.values(sessions)) {
    for (const turn of turns) {
      const seq = Number(turn.id.slice(turn.id.lastIndexOf("-") + 1));
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
  }
  return max;
}

/** 意图分发单次请求的选项 */
export interface DispatchOptions {
  /**
   * 轮次先落哪个桶（通常是第一个选中目标）。
   *
   * 分发路由由服务端决定，客户端只能先给轮次一个落脚点；
   * meta 事件到达后按 `meta.agentId` 迁移到真正的会话桶。
   */
  bucketKey: string;
  /** 候选清单：与消息一起交给服务端做意图分类 */
  candidates: readonly DispatchCandidate[];
  overrides?: ConverseOverrides;
  systemPrompt?: string;
  /** 路由结论回调：meta 到达即触发；fallback=true 表示分类失败已单发首个候选 */
  onRouted?: (routed: { agentId: string; fallback: boolean }) => void;
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
 *
 * 会话**累计落盘**到 localStorage：刷新页面、切走再回来都还看得到
 * 之前跑过的轮次（落盘时机与上限见文件顶部的会话落盘小节）。
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

  // 会话落盘：首帧与 SSR 一致（空会话），挂载后读回历史再开始写盘。
  // hydrated 必须等到读回的结果**已经提交**才置真，否则首次 effect 会拿
  // 空会话覆盖掉存储（那正是"刷新即丢"的另一种写法）。
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const restored = loadStoredSessions();
    if (Object.keys(restored).length > 0) {
      setSessions(restored);
      // 轮次 id 由序号派生，续接已落盘的序号才不会与新轮次撞车
      turnSeqRef.current = maxSeqOf(restored);
    }
    setHydrated(true);
  }, []);

  // 落盘时机分两档：全部轮次落定时立即写（刷新不丢刚跑完的结论），
  // 流式执行中按节流写（每个 step 事件都写盘没有必要）
  useEffect(() => {
    if (!hydrated) return;
    const settled = Object.values(sessions).every((turns) =>
      turns.every((turn) => turn.status !== "running"),
    );
    if (settled) {
      persistSessions(sessions);
      return;
    }
    const timer = setTimeout(
      () => persistSessions(sessions),
      PERSIST_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [sessions, hydrated]);

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

  /**
   * 意图分发专用：把轮次从预置桶迁移到路由命中的会话桶。
   *
   * 轮次对象、abort 控制器与日志计时基准三者同步换键——此后
   * `stop(新桶)` 能停住它、后续事件能 patch 到它、日志时间
   * 基准不重置。目标桶已有在跑轮次时不再迁移（不会发生：分发
   * 前目标桶空闲是前置校验的一部分，这里兜住并发窗口）。
   */
  const migrateTurn = useCallback(
    (fromKey: string, turnId: string, toKey: string) => {
      if (fromKey === toKey) return;
      setSessions((prev) => {
        const source = prev[fromKey];
        if (!source) return prev;
        const turn = source.find((item) => item.id === turnId);
        if (!turn) return prev;

        const next = { ...prev };
        const rest = source.filter((item) => item.id !== turnId);
        if (rest.length > 0) next[fromKey] = rest;
        else delete next[fromKey];
        next[toKey] = [...(next[toKey] ?? []), { ...turn, agentId: toKey }];
        return next;
      });

      const controller = abortMapRef.current.get(fromKey);
      if (controller && !abortMapRef.current.has(toKey)) {
        abortMapRef.current.delete(fromKey);
        abortMapRef.current.set(toKey, controller);
      }
      const startedAt = startedAtRef.current.get(fromKey);
      if (startedAt !== undefined) {
        startedAtRef.current.delete(fromKey);
        startedAtRef.current.set(toKey, startedAt);
      }
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
    async (
      agentId: string,
      text: string,
      overrides?: ConverseOverrides,
      systemPrompt?: string,
    ) => {
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
            systemPrompt,
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

  /**
   * 意图分发单发：一条消息 + 候选清单交给服务端，分类与执行在
   * 同一次请求内完成（SSE 流式返回）。
   *
   * 轮次先以乐观落台挂在 `bucketKey` 桶；首个 meta 事件携带路由
   * 结论，此时把轮次迁移到真正的会话桶（abort 控制器同步换键）。
   * 分类失败由服务端兜底单发首个候选并标注 fallback——客户端
   * 不再有第二次兜底逻辑，「绝不广播」只剩这一处实现。
   */
  const sendByDispatch = useCallback(
    async (text: string, options: DispatchOptions) => {
      const userMessage = text.trim();
      const { bucketKey, candidates, overrides, systemPrompt, onRouted } =
        options;
      if (!userMessage || candidates.length === 0) return;
      // 预置桶在跑时不叠发；其余候选桶由服务端路由结论决定
      if (abortMapRef.current.has(bucketKey)) return;

      const controller = new AbortController();
      abortMapRef.current.set(bucketKey, controller);
      startedAtRef.current.set(bucketKey, Date.now());
      turnSeqRef.current += 1;
      const turnId = `turn-${bucketKey}-${turnSeqRef.current}`;

      // 路由结果由服务端决定，历史只能按候选分别预备：
      // 每个候选带自己成功完成的轮次，未路由到的候选历史被服务端丢弃
      const histories: Record<string, ConverseChatMessage[]> = {};
      for (const candidate of candidates) {
        histories[candidate.id] = buildHistory(
          sessionsRef.current[candidate.id] ?? [],
        );
      }

      setSessions((prev) => ({
        ...prev,
        [bucketKey]: [
          ...(prev[bucketKey] ?? []),
          {
            id: turnId,
            agentId: bucketKey,
            createdAt: Date.now(),
            userText: userMessage,
            status: "running" as const,
            logs: [],
            result: null,
            error: null,
          },
        ],
      }));

      let bucket = bucketKey;

      try {
        const response = await fetch("/api/agents/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: userMessage,
            agents: candidates,
            histories,
            overrides,
            systemPrompt,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
            hint?: string;
          } | null;

          patchTurn(bucket, turnId, (turn) => ({
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
            if (event.type === "meta") {
              const routed = event.agentId;
              if (routed !== bucket) {
                migrateTurn(bucket, turnId, routed);
                bucket = routed;
              }
              onRouted?.({
                agentId: routed,
                fallback: event.dispatched?.fallback ?? false,
              });
            }
            consumeEvent(bucket, turnId, event);
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
        patchTurn(bucket, turnId, (turn) => ({
          ...turn,
          status: "failed",
          error: { message: describe(caught) },
        }));
      } finally {
        // 迁移后控制器键已换成路由命中的桶；两处都在才删得干净
        if (abortMapRef.current.get(bucket) === controller) {
          abortMapRef.current.delete(bucket);
        }
        if (
          bucket !== bucketKey &&
          abortMapRef.current.get(bucketKey) === controller
        ) {
          abortMapRef.current.delete(bucketKey);
        }
      }
    },
    [buildHistory, consumeEvent, migrateTurn, patchTurn],
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

  return { sessions, send, sendByDispatch, stop, reset };
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
    kind: step.kind,
    durationMs: step.durationMs,
  };
}

function describe(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
