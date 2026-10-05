/**
 * NOVA 领域层统一出口。
 *
 * 组件与服务端页面一律从 `@/lib/nova` 导入，
 * 避免业务代码直接依赖内部模块划分。
 */

export * from "./constants";
export * from "./format";
export * from "./mock-data";
export * from "./report";
export * from "./scoring";
export * from "./simulation";
export * from "./theme";
export * from "./types";
