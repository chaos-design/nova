# T07 · 交互与可达性打磨

- **优先级**：P2　**领域**：界面与项目约定　**状态**：planned
- **证据**：见 [审查基线 §交互](../archive/2026-10-07-code-review-baseline.md)

清单（可按条拆 PR，互不依赖）：

1. **排行榜行选择仅鼠标**：`leaderboard-table.tsx:178-186` 的 `<TableRow onClick>`
   无 `tabIndex`、无键盘事件——键盘用户无法选中 Agent，也就无法到达
   单 Agent 详情面板与「导出 JSON 报告」。行改为可聚焦（`tabIndex={0}` +
   `onKeyDown` Enter/Space，或内嵌按钮语义）。
2. **运行中执行器 Tabs 未禁用**：`sandbox-playground.tsx:143-159` 其余控件都是
   `disabled={running}`，唯独「本地仿真/真实执行」Tabs 例外；运行中切换会污染
   控制台描述文案。补 `disabled`。
3. **矩阵复测不落综合列**：`capability-matrix-board.tsx:244-248` 复测结果只回到
   单元格与雷达图，行内「综合」仍打印原始 `agent.compositeScore`——
   与页面文案「结果直接落回原位」不符。
4. **内部路由用了 `<a>`**：`local-agent-card.tsx:80` `<a href="/sandbox">` 整页刷新
   且绕过 typedRoutes，换 `next/link` 的 `Link`。
5. **导航徽标硬编码**：`nav-config.ts:55` `badge: "8"` 与 `AGENTS.length` 巧合相等，
   加档案即漂移——由数据派生或删除。
6. **导出报告 `generatedAt` 两口径**：`leaderboard-table.tsx:106` 用
   `agents[0]?.lastVerifiedAt` 顶替，`buildReport`（lib）用 `DEMO_EPOCH`——
   同一字段两个来源，统一走 lib。
7. **文案瑕疵**：`agents/page.tsx:128`、`agent-onboarding-dialog.tsx:210`
   中文句内残留半角空格（「登记档案、 落地配置」）；`sandbox/page.tsx:94-96`
   二元三元漏「竞技场」分支（dashboard 的三元覆盖了三种环境）。

## DoD

- [ ] 纯键盘可完成：排行榜选行 → 打开详情 → 导出 JSON 报告；
- [ ] 运行中执行器 Tabs 不可切换；
- [ ] `npm run check` 退出码 0。


---

## 完成记录（2026-10-07）

- 排行榜行：`tabIndex=0` + Enter/Space 选择 + `aria-selected` + focus 环——键盘可完成
  选行 → 详情 → 导出；
- 执行器 Tabs 运行中禁用（`disabled={running}`）；
- 矩阵综合列由复测后向量实时派生（`compositeScore(resolved(...))`）；
- `local-agent-card` 内部路由改 `next/link`；
- 导航徽标由 `AGENTS.length` 派生；
- 导出报告 `generatedAt` 统一为 `DEMO_EPOCH`（与 `buildReport` 同源）；
- 文案：两处半角空格清除、sandbox 页三元改 `ENVIRONMENTS` 查表（覆盖三环境）。
