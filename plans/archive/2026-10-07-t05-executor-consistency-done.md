# T05 · 执行器口径一致性修正

- **优先级**：P2　**领域**：沙盒执行链路　**状态**：planned
- **证据**：`src/lib/nova/executors/chaos.ts:73-77`、`executors/live.ts:287-311`、`live.ts:508`、
  `executors/llm.ts:71`、`simulation.ts:267-277`

## 问题

同一套混沌口径在两种执行器（本地仿真 / 真实执行）与配置读取上有四处偏差：

1. **零强度混沌仍扣分**：`scheduleFaults` 中
   `Math.max(Math.round((effective * slots) / meta.spacing), 1)` 在
   `effective === 0`（`intensity: 0` 或被环境上限裁剪为 0）时仍强制注入 1 次故障，
   `faultPenalty` 照常扣分——零强度混沌也在付费。
2. **`scoreAfter` 语义相反**：仿真执行器在扣罚**之前**推送故障步的 `scoreAfter`
   （`simulation.ts`），真实执行器在扣罚**之后**推送（`live.ts`）。
   同一协议字段两种含义，UI 进度条读数口径不一致。
3. **步数上限文案硬编码**：`live.ts:508` 摘要写死 `HARD_MAX_STEPS`（20），
   实际跑到的是 `config.maxSteps`（例如 8）——「20 次模型调用上限内未给出结论」失真。
4. **`LLM_MAX_TOKENS` 非数字得 `NaN`**：`llm.ts:71` 用 `Number(env ?? 2_000)`，
   环境变量填了非数字时 `max_tokens: null` 发给供应商直接 400；
   `route.ts:68` 已有正确的 `|| 2_000` 守卫，两条路径不一致。

另有一处关联：`live.ts:311` 注入分支 `continue` 时未结算 `state.pending`，
前一次故障的恢复结算被推迟一轮。

## 方案

1. `occurrences` 为 0 时不注入：把 `Math.max(..., 1)` 的下限钳制移到
   `effective > 0` 的前提之后。
2. 统一 `scoreAfter` 语义为「扣罚后」，`simulation.ts` 对齐 `live.ts`；
   `executor.ts` 的字段注释写明口径。
3. 摘要文案改用实际生效的 `config.maxSteps`。
4. `readLlmSettings` 改用与 route 相同的数字守卫（`Number.parseInt` + 回落 2_000）。
5. 注入分支结算或显式跳过 `state.pending`，写明选择。

## DoD

- [ ] 同一份配置在两种执行器下 `scoreAfter` 轨迹口径一致；
- [ ] `intensity: 0` 的配置不再产生故障与扣分；
- [ ] `LLM_MAX_TOKENS=abc` 时回落 2_000 而非 NaN；
- [ ] `npm run check` 退出码 0；`docs/nova-standard.md` 口径如受影响已同步。


---

## 完成记录（2026-10-07）

- `scheduleFaults`：`effective <= 0` 直接跳过——零强度配置零注入零扣分（实测 100 分）；
- `scoreAfter` 统一为「结算后」口径：`simulation.ts` 故障扣罚/自愈返还均先结算再推送，
  `live.ts` 对齐；
- 摘要文案改用 `state.maxSteps`（实际钳制值）；
- `LLM_MAX_TOKENS` 用 `Number.parseInt(...) || 2_000` 守卫，非数字回落默认；
- `live.ts` 注入观察分支先结算 `state.pending`（自愈事件先于注入告警出现，实测顺序正确）；
- 回归：确定性 100 / 混沌 95.3（自愈 1 次）/ 零强度 0 故障事件，全部符合预期。
