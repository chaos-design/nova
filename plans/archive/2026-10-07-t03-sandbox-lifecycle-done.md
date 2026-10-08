# T03 · 沙盒运行生命周期：卸载不中止、中止被标成完成

- **优先级**：P1　**领域**：沙盒执行链路　**状态**：planned
- **证据**：`src/hooks/use-sandbox-run.ts:138-208`

## 问题

1. **无卸载清理（P1）**：hook 持有 `abortRef`，但没有
   `useEffect(() => () => abortRef.current?.abort(), [])`。
   离开沙盒页后：本地仿真继续播完（≤14 步 × 每 步 0.3–0.6s）；
   真实执行继续流式消费 SSE——服务端 `maxDuration = 120` 内持续消耗模型 token，
   且 setState 打进已卸载组件。其余 hook（遥测流、终端日志、矩阵复测）清理都正确，
   唯独这条主链路漏了。
2. **中止被标为完成（P2）**：`stop()` 把 status 置 `"completed"` 且 `result` 为 null，
   「已结束」与正常完成在 UI 上不可区分；空闲时按停止也会显示已完成。
3. **error 事件后不提前断流（P2）**：`readSse` 收到 `error` 事件后继续读到 EOF，
   而非主动 `reader.cancel()`。

## 方案

1. 加卸载清理 effect：`useEffect(() => () => abortRef.current?.abort(), [])`；
   `consume` 内可按 `abortRef.current?.signal.aborted` 短路 setState。
2. 增加状态 `"stopped"`（或 `stopReason` 字段），`sandbox-playground` 渲染
   「已手动停止」，与 completed / failed 区分；空闲时 `stop()` 为 no-op。
3. `onEvent` 返回取消信号（或回调里直接 `reader.cancel()`），
   `error` 事件后立即终止读取。

## DoD

- [ ] 真实执行运行中离开沙盒页：网络面板 SSE 请求随之取消，服务端无残留消耗；
- [ ] 「停止」后控制台显示明确的停止态而非完成态；
- [ ] 空闲时「停止」不改变状态；
- [ ] `npm run check` 退出码 0。


---

## 完成记录（2026-10-07）

- `useSandboxRun` 增加卸载清理 effect（abort + 置空）；
- 新增 `stopped` 状态：`stop()` 仅在运行中生效，UI 显示「已手动停止」，
  与「已结束」「执行失败」可区分；
- `readSse` 回调返回 `stop` 信号：`done` / `error` 事件后立即 `reader.cancel()`，
  不再空转到 EOF。
