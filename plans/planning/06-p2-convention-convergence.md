# T06 · 项目约定收敛：语义色、barrel 出口与常量复用

- **优先级**：P2　**领域**：界面与项目约定　**状态**：planned
- **证据**：见 [审查基线 §约定违例](../archive/2026-10-07-code-review-baseline.md)

AGENTS.md §3.2 有三条约定当前大面积未被执行，属机械但面广的收敛。

## 1. 语义色收敛到 theme.ts（约 18 个文件）

组件内硬编码 `nova-cyan` / `nova-violet` / `nova-rose` 等亮色，
不随 `data-nova-accent` 切换，也不走 `theme.ts` 的语义映射。重灾区：

- `sandbox-playground.tsx`（14+ 处，含 `from-nova-cyan to-nova-violet` 渐变进度条）；
- `capability-matrix-board.tsx:181-222`（focus/hover/active/复测态全 cyan）；
- `leaderboard-table.tsx:184-304`、`agent-card.tsx`、`agent-identity.tsx:18-22`、
  `kpi-card.tsx:51-89`、`live-log-terminal.tsx:163`、`verification-stepper.tsx:7-32`
  （本地 `STATE_STYLE` 表与 `theme.ts` 的 `STATUS_META` 重复）；
- `telemetry-hub.tsx:45-48, 203, 208` 直接硬编码 `var(--nova-cyan)` 等 CSS 变量，
  而 `theme.ts` 的 `ACCENT_CHART_VAR` 映射（正是为此建的）零消费；
- 五个页面文件（dashboard/agents/matrix/sandbox/leaderboard）共 15+ 处。

**方向**：状态/等级/向量语义分别走 `STATUS_META` / `GRADE_META` / `VECTOR_META`，
图表颜色走 `ACCENT_CHART_VAR`，界面主色统一 `text-nova-accent`。

> 视觉回归敏感，建议按组件分批改、每批目测五个页面。

## 2. barrel 出口收敛

`src/lib/nova/index.ts` **没有导出 `./executor`**，导致沙盒协议类型只能深导入；
连带约 20 处深导入（`@/lib/nova/types` 18 处、`constants`、`mock-data`、`theme`、
`executor`、`executors/*`）。

**方向**：`index.ts` 补 `export * from "./executor"`；普通深导入全部改走 `@/lib/nova`。
`server-only` 的 `executors/live` / `executors/llm` 保持深导入作为**已声明例外**，
在 AGENTS.md §3.2 写明，避免后人误"修"。

## 3. 常量复用（UI 重新实现领域默认值的漂移）

- `sandbox-playground.tsx:573-583` 本地 `defaultConfig()` 的强度/启用项与 lib 的
  `DEFAULT_CHAOS` 已经漂移——换 `createSimulationConfig()`；
- `sandbox-playground.tsx:502-504` 重新实现 `effectiveIntensity()`（还少了钳制与
  enabled 判断）——换 `executors/chaos` 导出；
- `grade-chip.tsx:43-47` 与 `matrix/page.tsx:85-90` 各自硬编码等级阈值表——
  换 `constants.ts` 的 `GRADE_THRESHOLDS`（`scoring.ts` 的 `scoreGapToNextGrade`
  正是为此而建，零消费，见 T08）；
- `search.ts:114` 的 `toLocaleString("zh-CN")` 换 `format.ts` 的 `formatNumber`。

## DoD

- [ ] `grep -rn "nova-cyan\|nova-violet\|nova-rose\|nova-lime\|nova-amber" src/components src/app` 仅剩
      `theme.ts` / `nova-theme.css` / `appearance.ts` 的合法使用；
- [ ] 深导入仅剩 `server-only` 例外，且例外已写入 AGENTS.md；
- [ ] `npm run check` 退出码 0；
- [ ] 五个页面逐页目测无视觉回归。
