# T02 · 沙盒 Route 加固：SSE 拆除防护与请求校验

- **优先级**：P1　**领域**：API 与安全　**状态**：planned
- **证据**：`src/app/api/sandbox/run/route.ts:87-112`、`route.ts:34`、`route.ts:76-81`、`route.ts:169-173`

## 问题

1. **SSE 拆除未防护（P1）**：客户端中止（沙盒「停止」按钮走 `AbortController`，
   见 `use-sandbox-run.ts`）后 `request.signal` 触发，`runLive` 产出 `error` 事件，
   此时 `send()` 对已取消的流调用 `controller.enqueue` 抛错；`catch` 分支里再次 `send()`
   二次抛错；`finally` 的 `controller.close()` 对已取消的流同样抛错——
   每次客户端中止都在服务端留下未处理的 Promise 拒绝。
2. **请求体大小按 UTF-16 code unit 计（P2）**：`text.length > MAX_BODY_BYTES`
   中常量语义是字节；3.2 万汉字提示词按 code unit 通过校验，线上约 96KB。
3. **状态码语义（P2）**：「真实执行器未配置」是 4xx 类条件，当前落默认 500。
4. **chaos kind 未校验（P2）**：payload 中的 `item.kind` 未对照 `CHAOS_KINDS` 校验，
   非法值被下游静默丢弃。

## 方案

1. `send` 与 `finally` 全部防护：`request.signal.aborted` 短路，或
   `try { controller.enqueue(...) } catch {}`；`close()` 同样包护。
2. 用 `new TextEncoder().encode(text).byteLength` 校验真实字节数。
3. 「执行器未配置」返回 503（或 400），保留现有 hint 文案。
4. 解析 payload 时校验 `kind` 合法性：非法值返回 400，或显式忽略并在 meta 中说明。

## DoD

- [ ] 手工验证：沙盒运行中点「停止」，开发服务器日志无未处理拒绝；
- [ ] 未配置 `LLM_*` 时请求返回 4xx，提示文案不变；
- [ ] 超限中文字节数请求体被 413 拒绝；
- [ ] `npm run check` 退出码 0。


---

## 完成记录（2026-10-07）

- `send` / `finally` 全部按 `request.signal.aborted` 短路并包护 enqueue/close；
- 请求体按 UTF-8 字节校验（`TextEncoder.byteLength`）；
- 「执行器未配置」返回 503；chaos `kind` 白名单校验，非法值 400（实测通过）。
