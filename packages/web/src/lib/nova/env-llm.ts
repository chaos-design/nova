import "server-only";

import { getConfig } from "@chaos-design/config";
import type { LlmEnvDefault } from "./llm-profiles";
import { normalizeEndpoint } from "./local-agents";

/**
 * 本地 `.env` 解析出的全局大模型默认连接。
 *
 * 只下发端点与模型标识，**密钥永不出服务端**。界面需要它是因为：
 * 「全局大模型配置」的默认档案必须显示真实取值，而不是客户端包里
 * 被抹成 undefined 的 `process.env` 回退字面量 —— 后者会让用户看到
 * 一个与 .env 不符的端点，进而误判自己改的配置有没有生效。
 *
 * 取值与执行器完全同源（`config.agent.llm` ← `NOVA_LLM_BASE_URL` /
 * `NOVA_LLM_MODEL`），因此界面上显示的就是本次运行真正会调用的地方。
 */
export function envLlmDefault(): LlmEnvDefault {
  const llm = getConfig().agent.llm;
  return {
    endpoint: normalizeEndpoint(llm.baseUrl),
    model: llm.model,
  };
}
