"use client";

import { Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LogStream } from "@/components/nova/log-stream";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { agentById } from "@/lib/nova";
import type {
  SimulationLog,
  SimulationLogLevel,
  VerificationRun,
} from "@/lib/nova/types";

/** 终端保留的最大行数 */
const MAX_LOGS = 40;

/** 每推进一行推进的事件总线时间（毫秒） */
const STEP_MS = 30_000;

/** 首屏缓冲行数 */
const INITIAL_LOGS = 12;

const STAGE_LABELS: Record<string, string> = {
  ingestion: "接入",
  lint: "提示词校验",
  execution: "场景执行",
  burst: "爆发评估",
  certificate: "证书生成",
};

interface Context {
  agent: string;
  stage: string;
}

/** 事件模板：按游标轮转，同一游标永远产出同一条事件 */
const EVENTS = [
  {
    level: "info",
    actor: "nova",
    build: ({ agent, stage }: Context) => ({
      message: `${agent} 进入「${stage}」阶段`,
      detail: "调度器已分配执行槽位",
    }),
  },
  {
    level: "success",
    actor: "sandbox",
    build: ({ agent }: Context) => ({
      message: `${agent} 工具调用成功`,
      detail: "external_search · 24 条记录 · schema 通过",
    }),
  },
  {
    level: "warn",
    actor: "sandbox",
    build: ({ agent }: Context) => ({
      message: `${agent} 命中限流阈值`,
      detail: "429 Too Many Requests · 已切换指数退避 4s",
    }),
  },
  {
    level: "reflect",
    actor: "agent",
    build: ({ agent }: Context) => ({
      message: `${agent} 触发自我反思`,
      detail: "重写子目标顺序，保留 2 项高价值交付",
    }),
  },
  {
    level: "error",
    actor: "sandbox",
    build: ({ agent }: Context) => ({
      message: `${agent} 检出畸形载荷`,
      detail: "items[2].meta 缺失 · 已降级为容错分支",
    }),
  },
  {
    level: "success",
    actor: "nova",
    build: ({ agent }: Context) => ({
      message: `${agent} 场景校验通过`,
      detail: "连续 3 个场景无回归",
    }),
  },
  {
    level: "info",
    actor: "nova",
    build: () => ({
      message: "写入遥测采样点",
      detail: "成功率 / 延迟 / 记忆占用率已聚合",
    }),
  },
] as const satisfies readonly {
  level: SimulationLogLevel;
  actor: SimulationLog["actor"];
  build: (context: Context) => { message: string; detail?: string };
}[];

/** 第 `index` 条事件：完全由序号决定，便于复现 */
function logAt(index: number, runs: readonly VerificationRun[]): SimulationLog {
  const run = runs[index % runs.length];
  const agent = agentById(run.agentId);
  const event = EVENTS[index % EVENTS.length];
  const built = event.build({
    agent: agent.name,
    stage: STAGE_LABELS[run.currentStage] ?? run.currentStage,
  });

  return {
    id: `bus-${index}`,
    step: index + 1,
    atMs: (index + 1) * STEP_MS,
    level: event.level,
    actor: event.actor,
    message: built.message,
    detail: built.detail,
  };
}

/**
 * 实时日志流（遥测中枢）。
 *
 * 事件内容是演示数据，但**结构**与沙盒模拟产生的日志完全一致，
 * 因此两处终端观感统一；接入真实 SSE 时只需把 `logAt`
 * 换成订阅推送的增量。
 */
export function LiveLogTerminal({
  runs,
}: {
  runs: readonly VerificationRun[];
}) {
  const [logs, setLogs] = useState<SimulationLog[]>(() =>
    Array.from({ length: INITIAL_LOGS }, (_, index) => logAt(index, runs)),
  );
  const cursor = useRef(INITIAL_LOGS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = logAt(cursor.current, runs);
      cursor.current += 1;
      setLogs((prev) => [...prev.slice(-(MAX_LOGS - 1)), next]);
    }, 1_500);

    return () => window.clearInterval(timer);
  }, [runs]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>实时日志流</CardTitle>
        <CardDescription>
          沙盒事件总线 · 每 1.5s 推送 · 缓冲最近 {logs.length} 条
        </CardDescription>
        <CardAction>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-nova-cyan/25 bg-nova-cyan/10 px-2 py-0.5 font-mono text-[0.6875rem] text-nova-cyan">
            <Radio className="size-3 animate-nova-blink" />
            LIVE
          </span>
        </CardAction>
      </CardHeader>

      <CardContent>
        <LogStream logs={logs} emptyHint="事件总线待命…" />
      </CardContent>
    </Card>
  );
}
