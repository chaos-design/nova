"use client";

import { Radio } from "lucide-react";
import { LogStream } from "@/components/nova/log-stream";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatClock, LOCAL_AGENTS } from "@/lib/nova";
import type {
  SimulationLog,
  SimulationLogLevel,
  VerificationRun,
} from "@/lib/nova/types";

/**
 * 运行事件流（遥测中枢）。
 *
 * 每一行都对应一条**真实落库的运行记录**：编号、时间、结论、评分
 * 全部来自 `.nova/runs.json`。这里不做定时推送 —— 没有后台数据源时
 * 凭空滚动的日志只是装饰，不如老老实实把已发生的运行列出来。
 */

/** 终端保留的最大行数 */
const MAX_LOGS = 40;

const STAGE_LABELS: Record<string, string> = {
  ingestion: "接入",
  lint: "提示词校验",
  execution: "场景执行",
  burst: "爆发评估",
  certificate: "证书生成",
};

/** 运行结论 → 日志级别 */
function levelOf(run: VerificationRun): SimulationLogLevel {
  if (run.finishedAt === null) return "info";
  return run.compositeScore >= 72 ? "success" : "warn";
}

function logOf(run: VerificationRun, index: number): SimulationLog {
  const entry = LOCAL_AGENTS.find((item) => item.id === run.agentId);
  const agentName = entry?.name ?? run.agentId;
  const stage = STAGE_LABELS[run.currentStage] ?? run.currentStage;

  return {
    id: `run-${run.id}`,
    step: index + 1,
    atMs: 0,
    level: levelOf(run),
    actor: "nova",
    message: `${agentName} · ${run.id} 完成「${stage}」· 得分 ${run.compositeScore}`,
    detail: `${formatClock(run.startedAt)} · ${run.notes}`,
  };
}

export function LiveLogTerminal({
  runs,
}: {
  runs: readonly VerificationRun[];
}) {
  const logs = runs.slice(0, MAX_LOGS).map(logOf);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>运行事件流</CardTitle>
        <CardDescription>
          已归档的真实运行 · 最近 {logs.length} 条 · 按开始时间倒序
        </CardDescription>
        <CardAction>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-nova-cyan/25 bg-nova-cyan/10 px-2 py-0.5 font-mono text-[0.6875rem] text-nova-cyan">
            <Radio className="size-3 animate-nova-blink" />
            {logs.length > 0 ? "RECORDED" : "IDLE"}
          </span>
        </CardAction>
      </CardHeader>

      <CardContent>
        <LogStream
          logs={logs}
          emptyHint="还没有运行记录，投放沙盒后这里会列出每一次真实运行。"
        />
      </CardContent>
    </Card>
  );
}
