import { delay, type ExecutorId, type SandboxEvent } from "../executor";
import { buildSimulationPlan, type ScriptStep } from "../simulation";
import type {
  AgentProfile,
  SimulationConfig,
  SimulationLogLevel,
} from "../types";

/**
 * 本地仿真执行器。
 *
 * 把预生成的剧本按节奏吐成事件流。它没有任何 IO，因此既可以跑在浏览器里
 * （默认模式，零配置即可用），也可以跑在服务端 —— 界面感知不到区别。
 */

/** 各类步骤的演示节奏（毫秒） */
const PACE: Record<SimulationLogLevel, number> = {
  info: 320,
  success: 340,
  warn: 560,
  error: 620,
  reflect: 480,
};

/** 剧本整体节奏的缩放系数：调小可加速演示 */
const PACE_SCALE = 1;

export const SIMULATION_EXECUTOR: ExecutorId = "simulation";

/**
 * 播放一份剧本。
 *
 * @param onStep 每产出一个步骤即回调一次，便于调用方逐条上报
 */
export async function* runSimulation(
  config: SimulationConfig,
  agent: AgentProfile,
  signal?: AbortSignal,
): AsyncGenerator<SandboxEvent> {
  const plan = buildSimulationPlan(config, agent);

  yield {
    type: "meta",
    executor: SIMULATION_EXECUTOR,
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
    totalSteps: plan.steps.length,
  };

  for (const step of plan.steps) {
    if (signal?.aborted) return;
    await delay(PACE[step.level] * PACE_SCALE);
    yield { type: "step", step };
  }

  yield { type: "done", result: plan.result };
}

/** 预计播放时长（毫秒），用于界面提前告知 */
export function estimateDuration(steps: readonly ScriptStep[]): number {
  return steps.reduce(
    (total, step) => total + PACE[step.level] * PACE_SCALE,
    0,
  );
}
