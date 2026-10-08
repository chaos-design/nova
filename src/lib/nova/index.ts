/**
 * NOVA 领域层统一出口。
 *
 * 组件与服务端页面一律从 `@/lib/nova` 导入，
 * 避免业务代码直接依赖内部模块划分。
 *
 * 例外：`run-store.ts` 带 `server-only` 且依赖 `node:fs`，
 * 若从这里再导出会把整个领域层拖进服务端专属包，客户端组件将编译失败。
 * 因此它由服务端页面按 `@/lib/nova/run-store` 单独引入。
 */

export * from "./agent-onboarding";
export * from "./appearance";
export * from "./constants";
export * from "./format";
export * from "./local-agents";
export * from "./report";
export * from "./scoring";
export * from "./search";
export * from "./simulation";
export * from "./theme";
export * from "./types";
export * from "./verdict";
