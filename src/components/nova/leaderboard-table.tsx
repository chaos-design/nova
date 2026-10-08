"use client";

import { cn } from "cn";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileDown,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { AgentStatusBadge } from "@/components/nova/agent-status-badge";
import { CapabilityRadar } from "@/components/nova/capability-radar";
import { GradeChip } from "@/components/nova/grade-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACCENT_BAR_CLASS,
  ACCENT_DOT_CLASS,
  buildReport,
  CAPABILITY_VECTORS,
  downloadJson,
  formatNumber,
  GRADE_META,
  VECTOR_META,
} from "@/lib/nova";
import type {
  AccentColor,
  AgentProfile,
  CapabilityVectorId,
  LeaderboardEntry,
} from "@/lib/nova/types";

/** 可排序列：默认按排名，允许按综合评分或任一能力向量排序 */
type SortKey = "rank" | "compositeScore" | CapabilityVectorId;

const SORTABLE_VECTOR_KEYS = CAPABILITY_VECTORS.map((vector) => vector.id);

/**
 * 排行榜。
 *
 * 排序、选中、报告下载都在客户端完成：数据量是 Agent 档案级别，
 * 服务端预渲染表格、首屏即可读，交互不额外往返。
 */
export function LeaderboardTable({
  entries,
  agents,
}: {
  entries: readonly LeaderboardEntry[];
  agents: readonly AgentProfile[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [asc, setAsc] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(
    entries[0]?.agentId ?? "",
  );

  const rows = useMemo(() => {
    const value = (entry: LeaderboardEntry): number => {
      if (sortKey === "rank") return entry.rank;
      if (sortKey === "compositeScore") return entry.compositeScore;
      return entry.vectorScores[sortKey];
    };

    return [...entries].sort((a, b) =>
      asc ? value(a) - value(b) : value(b) - value(a),
    );
  }, [entries, sortKey, asc]);

  const selectedAgent = agents.find((agent) => agent.id === selectedId);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    // 排名升序最自然；其余分数列默认从高到低
    setAsc(key === "rank");
  };

  const exportAgent = (agent: AgentProfile) => {
    downloadJson(`${agent.id}-nova-report.json`, buildReport(agent, null));
  };

  const exportAll = () => {
    downloadJson("nova-leaderboard-report.json", {
      reportVersion: "1.0.0",
      // 报告是当次导出的快照，时间戳取真实导出时刻
      generatedAt: new Date().toISOString(),
      standard: "Agent 验证核心标准 v1.0",
      ranking: rows.map((entry) => ({
        rank: entry.rank,
        agentId: entry.agentId,
        name: entry.name,
        compositeScore: entry.compositeScore,
        grade: entry.grade,
        vectorScores: entry.vectorScores,
      })),
      agents: agents.map((agent) => buildReport(agent, null)),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>NOVA 综合评分榜</CardTitle>
          <CardDescription>
            共 {entries.length} 个 Agent · 点击表头排序，点击行查看评分详情
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={exportAll}>
              <FileDown />
              导出全量报告
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">
                  <SortButton
                    active={sortKey === "compositeScore"}
                    asc={asc}
                    onClick={() => toggleSort("compositeScore")}
                  >
                    综合评分
                  </SortButton>
                </TableHead>
                <TableHead className="w-16 text-center">评级</TableHead>
                {SORTABLE_VECTOR_KEYS.map((key) => {
                  const meta = VECTOR_META[key];
                  return (
                    <TableHead key={key}>
                      <SortButton
                        active={sortKey === key}
                        asc={asc}
                        onClick={() => toggleSort(key)}
                        dotClass={ACCENT_DOT_CLASS[meta.accent]}
                      >
                        {meta.label}
                      </SortButton>
                    </TableHead>
                  );
                })}
                <TableHead className="text-right">场景</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((entry) => {
                const agent = agents.find((item) => item.id === entry.agentId);
                const active = entry.agentId === selectedId;

                return (
                  <TableRow
                    key={entry.agentId}
                    data-active={active}
                    onClick={() => setSelectedId(entry.agentId)}
                    onKeyDown={(event) => {
                      // 行选择必须键盘可达：评分详情与导出入口都挂在选中态上
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedId(entry.agentId);
                    }}
                    tabIndex={0}
                    aria-selected={active}
                    className={cn(
                      "cursor-pointer transition-colors",
                      "focus-visible:outline focus-visible:outline-nova-cyan/60 focus-visible:-outline-offset-1",
                      active && "bg-nova-cyan/6",
                    )}
                  >
                    <TableCell className="font-mono text-muted-foreground tabular-nums">
                      {entry.rank}
                    </TableCell>
                    <TableCell>
                      {agent ? (
                        <AgentIdentity agent={agent} />
                      ) : (
                        <span className="text-sm">{entry.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {formatNumber(entry.compositeScore, 1)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "inline-block rounded-md border px-1.5 py-0.5 font-mono text-xs",
                          GRADE_META[entry.grade].chipClass,
                        )}
                      >
                        {entry.grade}
                      </span>
                    </TableCell>
                    {CAPABILITY_VECTORS.map((vector) => (
                      <TableCell key={vector.id}>
                        <ScoreCell
                          value={entry.vectorScores[vector.id]}
                          accent={vector.accent}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {entry.scenariosPassed}/{entry.scenariosTotal}
                    </TableCell>
                    <TableCell>
                      <ChevronRight
                        className={cn(
                          "size-4 transition-colors",
                          active
                            ? "text-nova-cyan"
                            : "text-muted-foreground/40",
                        )}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedAgent && (
        <Card>
          <CardHeader>
            <CardTitle>评分详情</CardTitle>
            <CardDescription>{selectedAgent.tagline}</CardDescription>
            <CardAction className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportAgent(selectedAgent)}
              >
                <FileDown />
                导出 JSON 报告
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <GradeChip
                  grade={selectedAgent.grade}
                  score={selectedAgent.compositeScore}
                  showHint
                />
                <AgentStatusBadge status={selectedAgent.status} />
                <span className="font-mono text-2xl font-semibold tabular-nums text-nova-starlight">
                  {formatNumber(selectedAgent.compositeScore, 1)}
                </span>
                <span className="text-xs text-muted-foreground">
                  / 100 综合评分
                </span>
              </div>

              <ul className="grid gap-2 sm:grid-cols-2">
                {CAPABILITY_VECTORS.map((vector) => {
                  const score = selectedAgent.capabilities.find(
                    (item) => item.vector === vector.id,
                  );
                  return (
                    <li
                      key={vector.id}
                      className="nova-panel rounded-lg px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm">{vector.label}</span>
                        <span className="font-mono text-sm tabular-nums">
                          {formatNumber(score?.score ?? 0, 1)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                        {vector.metrics.join(" · ")} · 权重{" "}
                        {Math.round(vector.weight * 100)}%
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-4">
              <CapabilityRadar capabilities={selectedAgent.capabilities} />

              {selectedAgent.certificateId && (
                <div className="nova-panel rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-nova-cyan">
                    <ShieldCheck className="size-4" />
                    NOVA 证书
                  </p>
                  <p className="mt-1.5 font-mono text-xs text-foreground/90">
                    {selectedAgent.certificateId}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-2 font-mono text-[0.625rem]"
                  >
                    校验快照已固化
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 表格内的迷你分数条 */
function ScoreCell({ value, accent }: { value: number; accent: AccentColor }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/8">
        <div
          className={cn("h-full rounded-full", ACCENT_BAR_CLASS[accent])}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatNumber(value, 1)}
      </span>
    </div>
  );
}

/** 可排序的表头按钮 */
function SortButton({
  active,
  asc,
  onClick,
  children,
  dotClass,
}: {
  active: boolean;
  asc: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dotClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
    >
      {dotClass && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", dotClass)}
        />
      )}
      {children}
      {active &&
        (asc ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        ))}
    </button>
  );
}
