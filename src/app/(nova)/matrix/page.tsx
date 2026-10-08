import { ArrowRight, FlaskConical, Radar, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { CapabilityMatrixBoard } from "@/components/nova/capability-matrix-board";
import { CapabilityVectorCards } from "@/components/nova/capability-vector-cards";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { averageCapabilities, CAPABILITY_VECTORS } from "@/lib/nova";
import { verifiedAgents } from "@/lib/nova/run-store";

export const metadata: Metadata = {
  title: "能力矩阵",
  description:
    "基于 NOVA 核心标准的能力测试矩阵：自主性、工具调用、记忆留存、逻辑推理四大向量的交互式评测。",
};

/** 矩阵读的是运行时落库的真实结果，必须按请求渲染 */
export const dynamic = "force-dynamic";

/**
 * 能力矩阵（Capability Testing Matrix）。
 *
 * 页面上半部分是标准（四个向量及其评测指标），下半部分是量表本体
 * （Agent × 向量的二维矩阵）。矩阵只收录跑出过真实结果的 Agent。
 */
export default async function MatrixPage() {
  const agents = await verifiedAgents();
  const baseline = averageCapabilities(agents);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capability Matrix"
        title="能力测试矩阵"
        subtitle="NOVA 把每个 Agent 的能力拆成四个可独立评分的向量。每个得分都由一次真实运行的可观测计数算出，没有预置画像。"
        actions={
          <Button asChild>
            <Link href="/sandbox">
              <FlaskConical data-icon="inline-start" />
              进入沙盒压测
            </Link>
          </Button>
        }
      />

      <CapabilityVectorCards />

      <CapabilityMatrixBoard agents={agents} baseline={baseline} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>评分口径</CardTitle>
            <CardDescription>
              NOVA 综合评分 = 四个向量的加权和，缺失向量会按剩余权重归一化
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {CAPABILITY_VECTORS.map((vector) => (
              <div key={vector.id} className="nova-panel rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{vector.label}</span>
                  <span className="font-mono text-xs text-nova-cyan">
                    ×{vector.weight.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  评测指标：{vector.metrics.join("、")}。子项按达标比例折算为 0
                  ~ 100 的向量得分（标准 §1.1 / §3.5）。
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>评级映射</CardTitle>
            <CardDescription>综合评分 → NOVA 评级</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { grade: "S", min: 92, note: "全域自主，具备涌现级协作能力" },
              { grade: "A", min: 85, note: "稳定通过高强度混沌环境" },
              { grade: "B", min: 72, note: "核心能力达标，边界场景待补齐" },
              { grade: "C", min: 0, note: "关键能力存在明显缺口" },
            ].map((item) => (
              <div
                key={item.grade}
                className="flex items-start gap-3 rounded-lg border border-white/8 bg-white/2 px-3 py-2"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md border border-nova-violet/30 bg-nova-violet/10 font-mono text-xs text-nova-violet">
                  {item.grade}
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground/90">
                    ≥ {item.min}
                  </p>
                  <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                    {item.note}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>下一步</CardTitle>
          <CardDescription>
            矩阵给出的是实测能力画像，真正的边界在混沌环境里
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link href="/agents">
              查看 Agent 档案
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/leaderboard">
              <Radar data-icon="inline-start" />
              对照集群均值
            </Link>
          </Button>
          <Button asChild>
            <Link href="/sandbox">
              <Sparkles data-icon="inline-start" />
              投放混沌场景
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
