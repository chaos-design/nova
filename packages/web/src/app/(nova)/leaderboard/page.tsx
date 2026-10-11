import { Download, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { LeaderboardTable } from "@/components/nova/leaderboard-table";
import {
  buildCertificates,
  buildLeaderboard,
  CAPABILITY_VECTORS,
  GRADE_THRESHOLDS,
} from "@/lib/nova";
import { rankSnapshot, verifiedAgents } from "@/lib/nova/run-store";

export const metadata: Metadata = {
  title: "排行榜与报告",
  description:
    "基于 NOVA 综合评分的 Agent 排行榜，支持导出可机读的 JSON 评测报告与证书清单。",
};

/** 榜单读的是运行时落库的真实结果，必须按请求渲染 */
export const dynamic = "force-dynamic";

/** 排行榜与报告（Leaderboard & Reports）。 */
export default async function LeaderboardPage() {
  const [agents, previousRank] = await Promise.all([
    verifiedAgents(),
    rankSnapshot(),
  ]);

  const entries = buildLeaderboard(agents, previousRank);
  const certificates = buildCertificates(agents);
  const leader = entries[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Leaderboard & Reports"
        title="排行榜与报告"
        subtitle="排名由 NOVA 综合评分唯一决定，每一行都可下钻到向量级拆解。所有报告都是可机读的 JSON：字段稳定、可长期存档、不依赖界面。"
      />

      <LeaderboardTable entries={entries} agents={agents} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="nova-panel rounded-xl p-4 lg:col-span-2">
          <h2 className="font-heading text-base font-medium text-nova-starlight">
            评级阈值
          </h2>
          <ul className="mt-3 space-y-2">
            {GRADE_THRESHOLDS.map((item) => (
              <li
                key={item.grade}
                className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/2 px-3 py-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-nova-fuchsia/25 bg-nova-fuchsia/10 font-mono text-sm text-nova-fuchsia">
                  {item.grade}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {item.label}
                    <span className="ml-2 font-mono text-[0.625rem] text-muted-foreground">
                      ≥ {item.min}
                    </span>
                  </p>
                  <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {leader && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              当前榜首 {leader.name}（{leader.codename}）以{" "}
              {leader.compositeScore} 分领先，其向量得分：
              {CAPABILITY_VECTORS.map((vector) => (
                <span key={vector.id}>
                  {vector.label} {leader.vectorScores[vector.id]} ·{" "}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="nova-panel rounded-xl p-4">
          <h2 className="flex items-center gap-2 font-heading text-base font-medium text-nova-starlight">
            <ShieldCheck className="size-4 text-nova-cyan" />
            已签发证书
          </h2>
          <p className="mt-1.5 font-mono text-3xl font-semibold tabular-nums text-nova-cyan">
            {certificates.length}
          </p>
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">
            张 · 仅评级 B 及以上且状态为「已验证」的 Agent 可获签发
          </p>

          <ul className="mt-3 space-y-1.5">
            {certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/3 px-2 py-1.5"
              >
                <span className="truncate font-mono text-[0.6875rem] text-foreground/90">
                  {certificate.id}
                </span>
                <span className="shrink-0 font-mono text-[0.625rem] text-nova-violet">
                  {certificate.checksum}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
            <Download className="mt-0.5 size-3 shrink-0" />
            在上方表格中选中任意 Agent，即可导出该 Agent 的完整 JSON 报告
            （含向量快照、子项读数与生命周期结果）。
          </p>
        </div>
      </div>
    </div>
  );
}
