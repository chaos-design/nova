"use client";

import { Check, Copy, ExternalLink, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatDateTime,
  type LocalAgentEntry,
  localAgentEnvSnippet,
} from "@/lib/nova";

/**
 * 本地 Agent 档案卡。
 *
 * 刻意不复用 `AgentCard`：内置档案有完整的能力向量与评分，而本地档案在跑完
 * 验证之前**一个读数都没有**。硬塞进同一张卡只能显示一个编出来的 0 分和
 * 「C · 矮星」评级 —— 那是在伪造评测结论。因此这里只展示真正已知的四件事：
 * 它是什么、指向哪里、密钥从哪读、什么时候登记的。
 */
export function LocalAgentCard({ agent }: { agent: LocalAgentEntry }) {
  return (
    <Card className="h-full border-dashed">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-mono tracking-[0.14em] text-nova-starlight">
              {agent.name}
            </CardTitle>
            <CardDescription className="mt-1">
              {agent.codename} · {agent.owner} · {agent.version}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-nova-amber/35 text-nova-amber"
          >
            待验证
          </Badge>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {agent.tagline}
        </p>
      </CardHeader>

      <CardContent className="space-y-2.5">
        <Row label="模型">
          <span className="font-mono text-xs text-nova-cyan">
            {agent.model}
          </span>
        </Row>
        <Row label="端点">
          <span className="font-mono text-xs break-all text-nova-cyan">
            {agent.endpoint}
          </span>
        </Row>
        <Row label="密钥">
          <span className="font-mono text-xs text-muted-foreground">
            {agent.apiKeyEnv}
          </span>
        </Row>
        <Row label="登记于">
          <span className="font-mono text-xs text-muted-foreground">
            {formatDateTime(agent.registeredAt)}
          </span>
        </Row>
      </CardContent>

      <CardFooter className="gap-2">
        <EnvSnippetButton agent={agent} />
        <Button variant="ghost" size="sm" asChild className="ml-auto">
          {/* 站内路由用 Link：整页刷新会丢掉客户端状态，也绕过 typedRoutes */}
          <Link href="/sandbox">
            去沙盒
            <ExternalLink data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="nova-mono-label w-12 shrink-0 pt-0.5 text-muted-foreground/70">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** 一键复制该 Agent 的 `.env.local` 片段 */
function EnvSnippetButton({ agent }: { agent: LocalAgentEntry }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard
          .writeText(localAgentEnvSnippet(agent))
          .then(() => setState("done"))
          .catch(() => setState("failed"))
          .finally(() => {
            window.setTimeout(() => setState("idle"), 1_500);
          });
      }}
    >
      {state === "done" ? (
        <Check data-icon="inline-start" className="text-nova-cyan" />
      ) : state === "failed" ? (
        <Terminal data-icon="inline-start" className="text-nova-rose" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
      {state === "done"
        ? "已复制"
        : state === "failed"
          ? "复制失败"
          : "复制环境变量"}
    </Button>
  );
}
