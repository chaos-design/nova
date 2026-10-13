import "server-only";

import type { IntentCandidate, IntentResolution } from "../intent";
import {
  buildIntentPrompt,
  INTENT_TIMEOUT_MS,
  parseIntentOutput,
} from "../intent";
import { chatCompletion, type LlmSettings } from "./llm";

/**
 * 意图分类的服务端执行：一次零温度补全，从候选里选出唯一目标。
 *
 * `/api/agents/intent`（分类即服务）与 `/api/agents/dispatch`
 * （分类 + 转发合一）共用这一个实现，保证两条路径的提示词、
 * 超时与兜底语义完全一致。分类失败以 LlmError 抛出，由调用方
 * 决定降级方式（intent 路由回 502；dispatch 落首个候选并标注
 * fallback）——兜底策略属于路由语义，不属于分类本身。
 */
export async function classifyAgentIntent(
  text: string,
  candidates: readonly IntentCandidate[],
  settings: LlmSettings,
): Promise<IntentResolution> {
  const { system, user } = buildIntentPrompt(text, candidates);

  const completion = await chatCompletion(settings, {
    model: settings.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [],
    temperature: 0,
    maxTokens: 30,
    // 分类挂起时整个转发链路都在等它：超时比对话轮更紧
    signal: AbortSignal.timeout(INTENT_TIMEOUT_MS),
  });

  // 调用方保证候选非空，parseIntentOutput 只在空候选时返回 null
  return (
    parseIntentOutput(completion.content, candidates) ?? {
      agentId: candidates[0].id,
      output: completion.content.trim(),
      matchedBy: "fallback",
    }
  );
}
