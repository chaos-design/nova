/**
 * NOVA 领域层统一出口。
 *
 * 组件与服务端页面一律从 `@/lib/nova` 导入，
 * 避免业务代码直接依赖内部模块划分。
 *
 * 例外（保持深导入，声明见 AGENTS.md §3.2）：
 * - `run-store.ts` 带 `server-only` 且依赖 `node:fs`，若从这里再导出会把
 *   整个领域层拖进服务端专属包，客户端组件将编译失败；
 * - `executors/live.ts` / `executors/llm.ts` 同为 `server-only`，只被
 *   服务端 route 使用，客户端组件经 barrel 引入同样会编译失败。
 * 以上各由服务端按模块路径单独引入。
 */

export * from "./agent-onboarding";
export * from "./appearance";
export * from "./constants";
export * from "./executor";
export * from "./executors/chaos";
export * from "./format";
export * from "./local-agents";
export * from "./report";
export * from "./scoring";
export * from "./search";
export * from "./simulation";
export * from "./sse";
export * from "./theme";
export * from "./types";
export * from "./verdict";
