# T08 · 死代码清理

- **优先级**：P2　**领域**：代码卫生　**状态**：planned
- **证据**：全库无 TODO/FIXME/HACK，但有一批零消费者的导出与失引注释。
  逐项决策「删除」或「接上消费者」（与 T06 联动的项已标注）。

## 零消费导出

| 位置 | 导出 | 处置倾向 |
| --- | --- | --- |
| `simulation.ts:374` | `ZERO_USAGE` | 删 |
| `simulation.ts:369` | `logIdOf`（`executor.ts:71` 已内联同逻辑） | 删，或让 `executor.ts` 复用它 |
| `types.ts:241` | `SimulationResult`（被 `ExecutorResult` 取代） | 删 |
| `types.ts:294` | `KpiSnapshot` | 删 |
| `executors/simulation.ts:61` | `estimateDuration`（「预计播放时长」消费者未建） | 删，或补 UI |
| `scoring.ts:47` | `scoreGapToNextGrade`（为 GradeChip 而建未用） | T06 接上或删 |
| `report.ts:99` | `passRateOf`（agent-card 内联了同逻辑） | 让 card 改用，或删 |
| `format.ts` | `formatRelativeTime`、`formatMetric`、`formatPercent` | 删 |
| `theme.ts` | `ACCENT_RING`、`ACCENT_BG`、`ACCENT_CHART_VAR` | T06 图表收敛用 `ACCENT_CHART_VAR`，其余删 |
| `nav-config.ts` | `RUNTIME_STATUS.inspectedMinutesAgo`、`NOVA_BRAND.sloganEn` | 删 |

## 其他失引 / 不可达

- `executors/live.ts:68`：`prompt.length > 8_000` 检查经 route 预裁剪
  （`route.ts:167`）后不可达——保留作防御性校验（加注释）或删除，二选一；
- `local-agents.ts:50`：注释引用模板文件 `local-agents.example.ts`，
  仓库中不存在——改指向 `docs/local-agent.md` 第 3 节；
- `score-breakdown.tsx:111-114`：`reading.unit === "次" ? 1 : 1` 两分支相同，
  退化为 `formatNumber(reading.value, 1)`。

## DoD

- [ ] 每一项都有明确处置记录（删 / 接上 / 保留+理由）；
- [ ] 删除后 `npm run check` 退出码 0，页面无回归；
- [ ] `plans/` 任务文件移入 `archive`。

---

## 完成记录（2026-10-10）

逐项处置（与「零消费导出」表一一对应）：

- **删**：`simulation.ts` 的 `ZERO_USAGE`（连带清掉不再使用的 `TokenUsage` 导入）与
  `logIdOf`（`executor.ts:114` 已内联同逻辑，跨模块复用一行字符串派生不值得）；
  `types.ts` 的 `SimulationResult`（被 `ExecutorResult` 取代）与 `KpiSnapshot`；
  `format.ts` 的 `formatRelativeTime` / `formatMetric` / `formatPercent`
  （连带清掉不再使用的 `TelemetryMetricMeta` 导入）；
  `theme.ts` 的 `ACCENT_RING` / `ACCENT_BG`；
  `nav-config.ts` 的 `RUNTIME_STATUS.inspectedMinutesAgo`；
  `constants.ts` 的 `NOVA_BRAND.sloganEn`；
- **接上消费者**：`report.ts` 的 `passRateOf` —— `agent-card.tsx` 的内联通过率
  改为调用它（显示值不变：卡片原本就按 1 位小数渲染）；
- **保留（留给 T06）**：`scoring.ts` 的 `scoreGapToNextGrade`（T06 §3 接给
  `grade-chip`）；`theme.ts` 的 `ACCENT_CHART_VAR`（T06 §1 接给 `telemetry-hub` 图表）；
- **过期项（无需动作）**：`estimateDuration` 全仓已无此函数（mock 时代随
  `simulation.ts` 重构移除，计划行号 `executors/simulation.ts:61` 已失效）；
  `local-agents.ts` 的模板失引注释已随 T03 轮修复（现指向 `docs/local-agent.md` §3）；
- **保留 + 理由**：`executors/live.ts` 的 8000 字符检查 —— Web 入口经
  `route.ts:196` 预裁剪后不可达，但 `lintSystemPrompt` 是导出函数，
  该分支是绕过 route 的编程入口（e2e 等）的兜底防线，已加注释说明；
- **退化简化**：`score-breakdown.tsx` 的 `reading.unit === "次" ? 1 : 1`
  收敛为 `formatNumber(reading.value, 1)`。

验证：`pnpm run check` 退出码 0；`pnpm run test` 全绿
（nova-config 19 / nova-local 31 / web 40）；被删符号均为零消费者
（grep 核实），页面无回归来源。
