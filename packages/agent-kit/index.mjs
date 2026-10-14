/**
 * @chaos-design/agent-kit 统一出口。
 *
 * 领域 Agent（playground 各执行体）只从这里引入共享基建：
 * - persona.mjs   人格层纯逻辑（载荷整形 / XML 标签校验 / 响应还原）
 * - service.mjs   服务骨架（上游调用器 / chat 处理器 / OpenAI 兼容路由）
 * - bootstrap.mjs 启动引导（配置 + 人格 + 上游解析，失败带可读退出理由）
 * - tools.mjs     领域工具层（Agent 自带工具的真实执行与协议边界）
 *
 * 约定与 @chaos-design/config 一致：纯 Node ESM，不引入任何 web 侧依赖。
 */

export * from "./bootstrap.mjs";
export * from "./persona.mjs";
export * from "./service.mjs";
export * from "./tools.mjs";
