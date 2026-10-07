"use client";

import { cn } from "cn";
import { Play, RotateCcw, ShieldAlert, Sparkles, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { AgentIdentity } from "@/components/nova/agent-identity";
import { LogStream } from "@/components/nova/log-stream";
import { ScoreGauge } from "@/components/nova/score-gauge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSandboxRun } from "@/hooks/use-sandbox-run";
import {
  agentById,
  buildSimulationPlan,
  CHAOS_KINDS,
  DEFAULT_SIMULATION_CONFIG,
  ENVIRONMENTS,
  gradeMeta,
  gradeOf,
  type LocalAgentEntry,
  localAgentProfile,
  MODEL_REGISTRY,
  resilienceFactor,
} from "@/lib/nova";
import type { ExecutorId } from "@/lib/nova/executor";
import type {
  AgentProfile,
  ChaosInjection,
  ChaosKind,
  SimulationConfig,
  SimulationLog,
} from "@/lib/nova/types";

/** 混沌强度的上限（滑块最大值） */
const INTENSITY_MAX = 100;

/**
 * 沙盒模拟器。
 *
 * 结构上分成两条独立的数据流：
 * - 配置态（Agent / 环境 / 提示词 / 混沌注入）由本组件持有；
 * - 运行态（日志、进度、得分）由 `useSimulationRun` 持有。
 *
 * 配置一变，剧本立即重算并自动回到初始态 —— 这条约束由 hook 保证，
 * 组件本身不需要处理"配置变更时的收尾"。
 */
export function SandboxPlayground({
  agents,
  liveAvailable,
  localAgents = [],
}: {
  agents: readonly AgentProfile[];
  /** 服务端是否配置了真实模型；由页面在服务端判定后传入 */
  liveAvailable: boolean;
  /** 已登记的本地 Agent（可在沙盒里做真实试验） */
  localAgents?: readonly LocalAgentEntry[];
}) {
  const [config, setConfig] = useState<SimulationConfig>(() =>
    defaultConfig(agents[0]?.id ?? ""),
  );
  const [executor, setExecutor] = useState<ExecutorId>("simulation");

  // 选中的可能是内置 Agent，也可能是本地登记；两者在这里收敛成同一个 Profile
  const localEntry = localAgents.find((item) => item.id === config.agentId);
  const agent = localEntry
    ? localAgentProfile(localEntry)
    : agentById(config.agentId);
  const isLocalRun = localEntry !== undefined;
  // 本地 Agent 一定可以走真实执行（端点自己的可达性由探针预先确认）；
  // 内置 Agent 只有服务端配置了全局 LLM_* 才可用
  const liveEnabled = isLocalRun || liveAvailable;
  const run = useSandboxRun();

  const environment = ENVIRONMENTS.find(
    (item) => item.id === config.environment,
  );
  const model = MODEL_REGISTRY.find((item) => item.id === agent.model);
  /** 计划中的故障点数量：仅本地仿真可预先算出 */
  const faultCount = useMemo(
    () =>
      buildSimulationPlan(config, agent).steps.filter((s) => s.chaos).length,
    [config, agent],
  );

  const patch = (changes: Partial<SimulationConfig>) =>
    setConfig((prev) => ({ ...prev, ...changes }));

  const patchChaos = (kind: ChaosKind, changes: Partial<ChaosInjection>) =>
    setConfig((prev) => ({
      ...prev,
      chaos: prev.chaos.map((item) =>
        item.kind === kind ? { ...item, ...changes } : item,
      ),
    }));

  const running = run.status === "running";

  const start = () => {
    if (executor === "live") {
      // 档案由服务端按 agentId 反查，客户端只传 id
      void run.runRemote(config);
      return;
    }
    void run.runLocal(config, agent);
  };

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* ---------------- 配置面板 ---------------- */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>沙盒配置</CardTitle>
            <CardDescription>
              选择目标 Agent 与运行环境，生成一份可复现的运行剧本
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>执行器</Label>
              <Tabs
                value={executor}
                onValueChange={(value) => setExecutor(value as ExecutorId)}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="simulation" className="flex-1">
                    本地仿真
                  </TabsTrigger>
                  <TabsTrigger
                    value="live"
                    className="flex-1"
                    disabled={!liveEnabled}
                  >
                    真实执行
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                {executor === "live"
                  ? "真实调用大模型执行工具循环，混沌注入在服务端生效；结果完全取决于被测模型的真实行为。"
                  : "按预生成剧本回放，无需网络与密钥，适合演示与回归对照。"}
                {isLocalRun && (
                  <span className="text-nova-cyan">
                    {" "}
                    本地试验：将调用 {localEntry.endpoint} 的 {localEntry.model}
                    模型（密钥取自环境变量 {localEntry.apiKeyEnv}）。
                  </span>
                )}
                {!liveEnabled && (
                  <>
                    {" "}
                    <span className="text-nova-amber">
                      真实执行需要在 .env.local 配置 LLM_BASE_URL / LLM_MODEL，
                      或在 local-agents.ts 登记一个本地 Agent。
                    </span>
                  </>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sandbox-agent">目标 Agent</Label>
              <Select
                value={config.agentId}
                onValueChange={(value) => patch({ agentId: value })}
                disabled={running}
              >
                <SelectTrigger id="sandbox-agent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {agents.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} · {item.codename}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {localAgents.length > 0 && (
                    <SelectGroup>
                      {localAgents.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.codename} · {item.model}（本地）
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="nova-panel rounded-lg p-3">
              <AgentIdentity agent={agent} />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] text-muted-foreground">
                  韧性系数
                </span>
                <span className="font-mono text-xs text-nova-cyan">
                  {resilienceFactor(agent).toFixed(2)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] text-muted-foreground">
                  模型
                </span>
                <span className="truncate font-mono text-[0.6875rem] text-foreground/90">
                  {model
                    ? `${model.label} · ${model.contextWindow} ctx`
                    : `${agent.model} · 本地端点`}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sandbox-env">运行环境</Label>
              <Select
                value={config.environment}
                onValueChange={(value) =>
                  patch({
                    environment: value as SimulationConfig["environment"],
                  })
                }
                disabled={running}
              >
                <SelectTrigger id="sandbox-env" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENVIRONMENTS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                {environment?.description}；注入强度上限{" "}
                {Math.round((environment?.chaosCeiling ?? 1) * 100)}%
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sandbox-steps">最大执行步数</Label>
                <span className="font-mono text-xs text-foreground tabular-nums">
                  {config.maxSteps}
                </span>
              </div>
              <Slider
                id="sandbox-steps"
                min={4}
                max={14}
                step={1}
                value={[config.maxSteps]}
                onValueChange={([value]) => patch({ maxSteps: value })}
                disabled={running}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sandbox-prompt">系统提示词</Label>
              <Textarea
                id="sandbox-prompt"
                value={config.systemPrompt}
                onChange={(event) =>
                  patch({ systemPrompt: event.target.value })
                }
                rows={9}
                className="resize-none font-mono text-xs leading-relaxed"
                disabled={running}
                placeholder="描述 Agent 在沙盒中必须遵守的约束…"
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                {config.systemPrompt.length} 字符 · 将参与静态提示词校验
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---------------- 执行面板 ---------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>运行控制台</CardTitle>
              <CardDescription>
                {executor === "live" ? "真实执行" : "本地仿真"} ·{" "}
                {executor === "live"
                  ? (run.meta?.model ?? "等待投放")
                  : `${config.maxSteps} 轮`}{" "}
                ·{" "}
                {running
                  ? "正在执行"
                  : run.status === "completed"
                    ? "已结束"
                    : run.status === "failed"
                      ? "执行失败"
                      : "待运行"}
              </CardDescription>
              <CardAction>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={run.reset}
                    disabled={running}
                  >
                    <RotateCcw />
                    重置
                  </Button>
                  {running ? (
                    <Button size="sm" variant="secondary" onClick={run.stop}>
                      <Square />
                      中止
                    </Button>
                  ) : (
                    <Button size="sm" onClick={start}>
                      <Play />
                      开始模拟
                    </Button>
                  )}
                </div>
              </CardAction>
            </CardHeader>

            <CardContent>
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                <ScoreGauge
                  value={run.score}
                  label="本次得分"
                  caption={
                    run.status === "completed"
                      ? `${gradeOf(run.score)} · ${gradeMeta(gradeOf(run.score)).label}`
                      : "满分基准 100"
                  }
                  accent={
                    run.score >= 85 ? "cyan" : run.score >= 72 ? "sky" : "amber"
                  }
                />

                <div className="w-full flex-1 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">执行轮次</span>
                      <span className="font-mono tabular-nums text-foreground">
                        {run.round} / {run.total || config.maxSteps}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-nova-cyan to-nova-violet transition-[width] duration-300"
                        style={{ width: `${Math.round(run.progress * 100)}%` }}
                      />
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Stat label="反思轮次" value={countBy(run.logs)} />
                    <Stat
                      label="已注入故障"
                      value={
                        run.logs.filter(
                          (log) =>
                            log.level === "error" || log.level === "warn",
                        ).length
                      }
                      accent="rose"
                    />
                    <Stat
                      label="已自愈"
                      value={run.result?.reflections ?? 0}
                      accent="cyan"
                    />
                    <Stat label="日志条数" value={run.played} />
                  </dl>

                  {run.error && (
                    <div className="rounded-lg border border-nova-rose/30 bg-nova-rose/6 p-3 text-xs leading-relaxed">
                      <p className="font-medium text-nova-rose">
                        {run.error.message}
                      </p>
                      {run.error.hint && (
                        <p className="mt-1 text-muted-foreground">
                          {run.error.hint}
                        </p>
                      )}
                    </div>
                  )}

                  {run.result && (
                    <div
                      className={cn(
                        "rounded-lg border p-3 text-xs leading-relaxed",
                        run.result.success
                          ? "border-nova-cyan/30 bg-nova-cyan/6"
                          : "border-nova-rose/30 bg-nova-rose/6",
                      )}
                    >
                      <p
                        className={cn(
                          "flex items-center gap-1.5 font-medium",
                          run.result.success
                            ? "text-nova-cyan"
                            : "text-nova-rose",
                        )}
                      >
                        <Sparkles className="size-3.5" />
                        {run.result.success ? "任务达成" : "任务未达成"}
                      </p>
                      <p className="mt-1.5 text-muted-foreground">
                        {run.result.summary}
                      </p>
                      {run.result.usage && (
                        <p className="mt-1.5 font-mono text-[0.6875rem] text-muted-foreground/80">
                          模型调用 {run.result.usage.calls} 次 · 输入{" "}
                          {run.result.usage.promptTokens} tokens · 输出{" "}
                          {run.result.usage.completionTokens} tokens
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>执行日志</CardTitle>
              <CardDescription>
                实时观察 Agent 的规划、工具调用与自我纠错过程
              </CardDescription>
              {executor === "live" && run.meta && (
                <CardAction>
                  <Badge
                    variant="outline"
                    className="font-mono text-[0.625rem]"
                  >
                    {run.meta.model}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              <LogStream
                logs={run.logs}
                emptyHint="点击「开始模拟」投放 Agent 进入沙盒…"
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---------------- 混沌注入 ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-nova-rose" />
            混沌注入
          </CardTitle>
          <CardDescription>
            注入强度会被当前环境的 chaos ceiling 二次裁剪（
            {environment?.label}：上限{" "}
            {Math.round((environment?.chaosCeiling ?? 1) * 100)}
            %），实际生效值见每项右侧
          </CardDescription>
          <CardAction>
            <Badge variant="outline" className="font-mono text-[0.625rem]">
              {faultCount} 处故障点
            </Badge>
          </CardAction>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CHAOS_KINDS.map((item) => {
            const injection = config.chaos.find(
              (chaos) => chaos.kind === item.kind,
            );
            const enabled = injection?.enabled ?? false;
            const intensity = injection?.intensity ?? 0;
            const effective =
              Math.round(intensity * (environment?.chaosCeiling ?? 1) * 100) /
              100;

            return (
              <div
                key={item.kind}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  enabled
                    ? "border-nova-rose/30 bg-nova-rose/6"
                    : "border-white/8 bg-white/2",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      patchChaos(item.kind, { enabled: checked })
                    }
                    disabled={running}
                    aria-label={`启用${item.label}`}
                  />
                </div>

                {enabled && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-[0.625rem] text-muted-foreground">
                      <span>强度 {Math.round(intensity * 100)}%</span>
                      <span
                        className={cn(
                          effective < intensity && "text-nova-amber",
                        )}
                      >
                        实际 {Math.round(effective * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[intensity * INTENSITY_MAX]}
                      min={10}
                      max={INTENSITY_MAX}
                      step={5}
                      onValueChange={([value]) =>
                        patchChaos(item.kind, {
                          intensity: value / INTENSITY_MAX,
                        })
                      }
                      disabled={running}
                      aria-label={`${item.label}强度`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 局部辅助                                                                    */
/* -------------------------------------------------------------------------- */

function defaultConfig(agentId: string): SimulationConfig {
  return {
    ...DEFAULT_SIMULATION_CONFIG,
    agentId,
    chaos: CHAOS_KINDS.map((item) => ({
      kind: item.kind,
      enabled: item.kind === "malformedPayload" || item.kind === "latency",
      intensity: item.kind === "malformedPayload" ? 0.45 : 0.6,
    })),
  };
}

/** 小号统计块 */
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "cyan" | "rose";
}) {
  return (
    <div className="nova-panel rounded-lg px-2.5 py-2">
      <dt className="text-[0.625rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-sm tabular-nums",
          accent === "cyan"
            ? "text-nova-cyan"
            : accent === "rose"
              ? "text-nova-rose"
              : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** 按日志级别统计数量 */
function countBy(logs: readonly SimulationLog[]): number {
  return logs.filter((log) => log.level === "reflect").length;
}
