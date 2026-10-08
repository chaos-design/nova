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
