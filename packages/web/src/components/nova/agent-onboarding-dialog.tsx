"use client";

import { cn } from "cn";
import {
  Check,
  CircleAlert,
  Copy,
  LoaderCircle,
  PlugZap,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type EndpointProbe,
  LOCAL_AGENTS,
  type LocalAgentEntry,
  localAgentEnvSnippet,
  localAgentSourceSnippet,
  normalizeEndpoint,
  probeAgentEndpoint,
} from "@/lib/nova";

/**
 * 接入本地 Agent 向导。
 *
 * 界面按「用户真正会卡住的顺序」分三步，而不是罗列配置项：
 * 没有端点 → 不知道要准备什么；有了端点 → 不知道填得对不对；
 * 填完了 → 不知道改哪个文件。三步分别回答这三个问题，每步都有可验证的落点。
 *
 * 刻意不代用户写文件：本地 Agent 的登记要进版本库、密钥只能留在环境变量里，
 * 由浏览器直接落盘会同时破坏这两条。向导产出可复制的片段，粘贴是用户的决定。
 */

/** 常见的本地推理运行时，命令直接可跑 */
const RUNTIMES = [
  {
    id: "ollama",
    label: "Ollama",
    endpoint: "http://127.0.0.1:11434/v1",
    commands: ["ollama serve", "ollama pull qwen2.5:14b"],
    note: "默认无鉴权，LLM_API_KEY 填任意非空字符串即可。",
  },
  {
    id: "vllm",
    label: "vLLM",
    endpoint: "http://127.0.0.1:8000/v1",
    commands: [
      "pip install vllm",
      "vllm serve Qwen/Qwen2.5-14B-Instruct --port 8000 --enable-auto-tool-choice",
    ],
    note: "必须带 --enable-auto-tool-choice，否则模型不会产出 tool_calls。",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    endpoint: "http://127.0.0.1:1234/v1",
    commands: ["# 在 LM Studio 中：Local Server → Start Server"],
    note: "在「Developer」页签确认已加载支持工具调用的模型。",
  },
] as const;

const STEPS = [
  { id: "endpoint", label: "准备端点" },
  { id: "profile", label: "登记档案" },
  { id: "publish", label: "落地接入" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface FormState {
  name: string;
  codename: string;
  model: string;
  owner: string;
  version: string;
  endpoint: string;
  apiKeyEnv: string;
  tagline: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  codename: "",
  model: "",
  owner: "本地",
  version: "v0.1.0",
  endpoint: "",
  apiKeyEnv: "LLM_API_KEY",
  tagline: "",
};

/** 由英文代号推导登记 id：与内置档案的 `agt-<name>` 命名保持一致 */
function deriveAgentId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `agt-local-${slug}` : "agt-local-agent";
}

export function AgentOnboardingDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepId>("endpoint");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<EndpointProbe | null>(null);
  /**
   * 产物片段里的登记时间。
   *
   * 刻意不进 render：`new Date()` 在服务端与客户端各算一次必然不同，
   * 放进首屏 JSX 就是一处 hydration 不一致。改成进入第三步时才取值。
   */
  const [registeredAt, setRegisteredAt] = useState("");

  const stepIndex = STEPS.findIndex((item) => item.id === step);

  /** 与内置档案重名会让 id 撞车，这里提前拦下而不是让用户提交后才报错 */
  const conflicting = LOCAL_AGENTS.some(
    (item) => item.id === deriveAgentId(form.name),
  );

  const entry = useMemo<LocalAgentEntry>(
    () => ({
      id: deriveAgentId(form.name),
      name: form.name.trim().toUpperCase(),
      codename: form.codename.trim() || "本地",
      model: form.model.trim(),
      owner: form.owner.trim() || "本地",
      version: form.version.trim() || "v0.1.0",
      endpoint: normalizeEndpoint(form.endpoint),
      apiKeyEnv: form.apiKeyEnv.trim() || "LLM_API_KEY",
      tagline: form.tagline.trim() || "本地部署的 Agent，待接入验证",
      registeredAt,
    }),
    [form, registeredAt],
  );

  /** 进入登记步骤的门槛：端点与身份齐了才值得往下走 */
  const canRegister =
    form.name.trim().length > 0 &&
    form.model.trim().length > 0 &&
    normalizeEndpoint(form.endpoint).length > 0 &&
    !conflicting;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    // 端点一变，上一次的探测结论就作废了
    if (key === "endpoint") setProbe(null);
  }

  function reset() {
    setOpen(false);
    setStep("endpoint");
    setForm(EMPTY_FORM);
    setProbe(null);
    setProbing(false);
    setRegisteredAt("");
  }

  function goTo(stepId: StepId) {
    // 登记时间只在真正要展示产物时取值
    if (stepId === "publish") setRegisteredAt(new Date().toISOString());
    setStep(stepId);
  }

  async function runProbe() {
    setProbing(true);
    try {
      setProbe(await probeAgentEndpoint(normalizeEndpoint(form.endpoint)));
    } finally {
      setProbing(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : reset())}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PlugZap data-icon="inline-start" />
          接入新 Agent
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88svh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>接入本地 Agent</DialogTitle>
          <DialogDescription>
            NOVA 通过 OpenAI 兼容端点调用
            Agent。下面三步依次确认端点、登记档案、落地配置 ——
            每一步的产物都可以直接复制。如何在本地开发一个 Agent？见{" "}
            <code className="font-mono">docs/local-agent.md</code>。
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 border-y border-white/8 py-3">
          {STEPS.map((item, index) => (
            <li key={item.id} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => index <= stepIndex && goTo(item.id)}
                disabled={index > stepIndex}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 text-left",
                  index <= stepIndex ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[0.625rem]",
                    index < stepIndex &&
                      "border-nova-accent bg-nova-accent/15 text-nova-accent",
                    index === stepIndex &&
                      "border-nova-accent text-nova-accent",
                    index > stepIndex &&
                      "border-white/15 text-muted-foreground",
                  )}
                >
                  {index < stepIndex ? <Check className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-xs",
                    index === stepIndex
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="space-y-5 py-5">
          {step === "endpoint" && (
            <EndpointStep form={form} onChange={update} />
          )}

          {step === "profile" && (
            <ProfileStep
              form={form}
              onChange={update}
              probe={probe}
              probing={probing}
              onProbe={runProbe}
            />
          )}

          {step === "publish" && (
            <PublishStep entry={entry} canRegister={canRegister} />
          )}
        </div>

        <DialogFooter className="border-t border-white/8 pt-4">
          <Button
            variant="ghost"
            onClick={() => goTo(STEPS[Math.max(stepIndex - 1, 0)].id as StepId)}
            disabled={stepIndex === 0}
          >
            上一步
          </Button>
          {step === "publish" ? (
            <Button onClick={reset}>完成</Button>
          ) : (
            <Button
              onClick={() =>
                goTo(
                  STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id as StepId,
                )
              }
              disabled={step === "profile" && !canRegister}
            >
              下一步
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* 步骤一：准备端点                                                            */
/* -------------------------------------------------------------------------- */

function EndpointStep({
  form,
  onChange,
}: {
  form: FormState;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="nova-panel space-y-2 rounded-lg p-3">
        <p className="text-sm font-medium text-nova-starlight">NOVA 需要什么</p>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            · 一个 <code className="font-mono text-nova-cyan">/v1</code>{" "}
            根路径的 OpenAI 兼容服务，能响应{" "}
            <code className="font-mono text-nova-cyan">
              POST /chat/completions
            </code>
          </li>
          <li>
            ·{" "}
            <strong className="text-foreground">
              必须支持 function calling
            </strong>
            ：沙盒的全部评分都来自工具调用，模型不吐 tool_calls 就无法验证
          </li>
          <li>· 密钥放在服务端环境变量里，不进浏览器包、不进版本库</li>
        </ul>
      </div>

      <Tabs defaultValue="ollama">
        <TabsList className="w-full">
          {RUNTIMES.map((runtime) => (
            <TabsTrigger key={runtime.id} value={runtime.id}>
              {runtime.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {RUNTIMES.map((runtime) => (
          <TabsContent key={runtime.id} value={runtime.id} className="mt-3">
            <div className="space-y-3">
              <CommandList commands={runtime.commands} />
              <p className="text-xs text-muted-foreground">{runtime.note}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onChange("endpoint", runtime.endpoint)}
              >
                使用该端点 {runtime.endpoint}
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <div className="space-y-2">
        <Label htmlFor="endpoint">OpenAI 兼容端点</Label>
        <Input
          id="endpoint"
          value={form.endpoint}
          onChange={(event) => onChange("endpoint", event.target.value)}
          placeholder="http://127.0.0.1:11434/v1"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function CommandList({ commands }: { commands: readonly string[] }) {
  return (
    <div className="nova-panel space-y-1 rounded-lg p-3 font-mono text-xs">
      {commands.map((command) => (
        <div key={command} className="flex items-start gap-2">
          <Terminal className="mt-0.5 size-3 shrink-0 text-nova-cyan/70" />
          <span className="min-w-0 flex-1 break-all text-muted-foreground">
            {command}
          </span>
          <CopyButton value={command} label="" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 步骤二：登记档案                                                            */
/* -------------------------------------------------------------------------- */

function ProfileStep({
  form,
  onChange,
  probe,
  probing,
  onProbe,
}: {
  form: FormState;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  probe: EndpointProbe | null;
  probing: boolean;
  onProbe: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="name"
          label="英文代号"
          required
          value={form.name}
          placeholder="MYAGENT"
          onChange={(value) => onChange("name", value)}
          hint={`登记 id 将是 ${deriveAgentId(form.name)}`}
        />
        <Field
          id="codename"
          label="中文代号"
          value={form.codename}
          placeholder="本地"
          onChange={(value) => onChange("codename", value)}
        />
        <Field
          id="model"
          label="模型标识"
          required
          value={form.model}
          placeholder="qwen2.5:14b"
          onChange={(value) => onChange("model", value)}
          hint="需与端点上暴露的模型 id 完全一致"
        />
        <Field
          id="owner"
          label="归属"
          value={form.owner}
          placeholder="本地"
          onChange={(value) => onChange("owner", value)}
        />
        <Field
          id="version"
          label="版本"
          value={form.version}
          placeholder="v0.1.0"
          onChange={(value) => onChange("version", value)}
        />
        <Field
          id="apiKeyEnv"
          label="密钥环境变量名"
          value={form.apiKeyEnv}
          placeholder="LLM_API_KEY"
          onChange={(value) => onChange("apiKeyEnv", value)}
          hint="只存变量名，密钥本身留在 .env.local"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tagline">一句话说明</Label>
        <Textarea
          id="tagline"
          rows={2}
          value={form.tagline}
          onChange={(event) => onChange("tagline", event.target.value)}
          placeholder="本地 Ollama 部署的 14B 模型，尚未完成验证"
        />
      </div>

      <ProbePanel probe={probe} probing={probing} onProbe={onProbe} />
    </div>
  );
}

function ProbePanel({
  probe,
  probing,
  onProbe,
}: {
  probe: EndpointProbe | null;
  probing: boolean;
  onProbe: () => void;
}) {
  return (
    <div className="nova-panel space-y-3 rounded-lg p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-nova-starlight">连通性检测</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onProbe}
          disabled={probing}
        >
          {probing ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Wifi data-icon="inline-start" />
          )}
          {probing ? "检测中" : "检测端点"}
        </Button>
      </div>

      {!probe && (
        <p className="text-xs text-muted-foreground">
          检测会向服务端发一次 GET{" "}
          <code className="font-mono text-nova-cyan">{`<端点>/models`}</code>
          ，用来确认地址可达、协议兼容，并列出可用的模型 id。
        </p>
      )}

      {probe && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={probe.reachable ? "default" : "destructive"}
              className="gap-1"
            >
              {probe.reachable ? (
                <Wifi className="size-3" />
              ) : (
                <WifiOff className="size-3" />
              )}
              {probe.reachable ? "端点可达" : "端点不可达"}
            </Badge>
            {probe.reachable && (
              <Badge
                variant={probe.openaiCompatible ? "default" : "secondary"}
                className="gap-1"
              >
                {probe.openaiCompatible ? (
                  <Check className="size-3" />
                ) : (
                  <CircleAlert className="size-3" />
                )}
                {probe.openaiCompatible ? "OpenAI 兼容" : "协议不兼容"}
              </Badge>
            )}
            {probe.reachable && (
              <span className="font-mono text-[0.6875rem] text-muted-foreground">
                {probe.latencyMs}ms
              </span>
            )}
          </div>

          {probe.models.length > 0 && (
            <p className="text-xs text-muted-foreground">
              可用模型：
              <span className="ml-1 font-mono text-nova-cyan">
                {probe.models.join(" · ")}
              </span>
            </p>
          )}

          {probe.message && (
            <p className="text-xs text-nova-amber">{probe.message}</p>
          )}
          {probe.hint && (
            <p className="text-xs text-muted-foreground">{probe.hint}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 步骤三：落地                                                                */
/* -------------------------------------------------------------------------- */

function PublishStep({
  entry,
  canRegister,
}: {
  entry: LocalAgentEntry;
  canRegister: boolean;
}) {
  return (
    <div className="space-y-4">
      {!canRegister && (
        <p className="text-xs text-nova-amber">
          档案还不完整 —— 至少需要英文代号、模型标识与端点。
        </p>
      )}

      <Snippet
        title="1 · 写入 src/lib/nova/local-agents.ts"
        description="追加到 LOCAL_AGENTS 数组，让它出现在注册表的「本地接入」分区。"
        code={localAgentSourceSnippet(entry)}
      />

      <Snippet
        title="2 · 写入 .env.local"
        description="真实执行器只读这三个变量；密钥值你自己填，不要提交该文件。"
        code={localAgentEnvSnippet(entry)}
      />

      <div className="nova-panel space-y-1.5 rounded-lg p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-nova-starlight">3 · 重启并验证</p>
        <p>
          改完这两个文件后重启{" "}
          <code className="font-mono text-nova-cyan">npm run dev</code>，
          注册表会多出这张档案卡。
        </p>
        <p>
          档案登记只是入册：NOVA 不会凭空给它一个评分。未跑完验证之前，
          它不会进入排行榜与能力矩阵 —— 缺的是数据，不是展示位。
        </p>
      </div>
    </div>
  );
}

function Snippet({
  title,
  description,
  code,
}: {
  title: string;
  description: string;
  code: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-nova-starlight">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <CopyButton value={code} label="复制" />
      </div>
      <pre className="nova-panel max-h-56 overflow-auto rounded-lg p-3 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
        {code}
      </pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 表单基元                                                                    */
/* -------------------------------------------------------------------------- */

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-nova-rose">*</span>}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {hint && (
        <p className="text-[0.6875rem] text-muted-foreground/70">{hint}</p>
      )}
    </div>
  );
}

/** 带反馈的复制按钮：写入失败时如实报错，不假装成功 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? "xs" : "icon-xs"}
      className={label ? "" : "-my-1 shrink-0 text-muted-foreground"}
      aria-label={label || "复制命令"}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setState("done"))
          .catch(() => setState("failed"))
          .finally(() => {
            window.setTimeout(() => setState("idle"), 1_500);
          });
      }}
    >
      {state === "done" ? (
        <Check className="text-nova-cyan" />
      ) : state === "failed" ? (
        <CircleAlert className="text-nova-rose" />
      ) : (
        <Copy />
      )}
      {label && (
        <span>
          {state === "done"
            ? "已复制"
            : state === "failed"
              ? "复制失败"
              : label}
        </span>
      )}
    </Button>
  );
}
