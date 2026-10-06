import type { ScriptStep } from "./simulation";
import type { ChaosKind, SimulationConfig, SimulationLog } from "./types";

/**
 * 沙盒执行器契约。
 *
 * 这是**前后端唯一的协议**：无论剧本来自本地仿真还是真实 LLM 执行器，
 * 对外都只吐出一串 `SandboxEvent`。界面因此不需要知道自己看的是哪一种，
 * 也不需要在渲染层写任何分支。
 */

/** 执行器标识 */
export type ExecutorId = "simulation" | "live";

/** 真实执行器的 token 用量 */
export interface TokenUsage {
  /** 模型调用次数 */
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 执行结论 */
export interface ExecutorResult {
  /** 任务是否达成 */
  success: boolean;
  /** 实际执行步数 */
  steps: number;
  /** 自我纠错次数 */
  reflections: number;
  /** 成功自愈的故障类型 */
  recoveredFrom: ChaosKind[];
  /** 本次评分（0 ~ 100） */
  score: number;
  /** 一句话结论，直接用于界面展示 */
  summary: string;
  /** token 用量，仅真实执行器提供 */
  usage?: TokenUsage;
}

/**
 * 执行过程事件。
 *
 * 用判别联合而不是可选字段，是为了让消费方在类型层面穷尽所有分支 ——
 * 新增一种事件时，所有处理它的地方都会在编译期报错。
 */
export type SandboxEvent =
  | {
      type: "meta";
      executor: ExecutorId;
      agentId: string;
      agentName: string;
      /** 实际使用的模型标识 */
      model: string;
      /** 预计总步数；真实执行器可能为 null（步数由模型决定） */
      totalSteps: number | null;
    }
  | { type: "step"; step: ScriptStep }
  | { type: "done"; result: ExecutorResult }
  | { type: "error"; message: string; hint?: string };

/**
 * 剧本步骤 → 日志。
 *
 * `atMs` 由调用方按**真实经过时间**填充，而不是按预设节奏累加：
 * 两种执行器的时间基准必须都是"用户实际等了多久"，不能有一个是编的。
 */
export function stepToLog(step: ScriptStep, atMs: number): SimulationLog {
  return {
    id: `log-${String(step.step).padStart(3, "0")}`,
    step: step.step,
    atMs,
    level: step.level,
    actor: step.actor,
    message: step.message,
    detail: step.detail,
  };
}

/** 等待若干毫秒 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 真实执行器请求体。
 *
 * 只接受可序列化的最小字段集：Agent 档案由服务端按 id 反查，
 * 绝不接受客户端传入的档案内容 —— 否则评分就成了让客户端自己给自己打分。
 */
export type LiveRunRequest = Pick<
  SimulationConfig,
  "systemPrompt" | "environment" | "chaos" | "maxSteps"
> & {
  agentId: string;
};
