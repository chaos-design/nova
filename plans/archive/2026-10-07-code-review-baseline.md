# 2026-10-07 · 全库代码审查基线

> 本文件是 `plans/` 任务体系（T01–T10）的证据底稿。
> 审查方式：两路并行深读——领域层 + Route Handler + 执行器；界面层 + hooks + 页面。
> 交叉核对了 `AGENTS.md` 全部项目约定与 `docs/` 三份文档。

## 总体结论

- `npm run check`（tsc strict + Biome）**全绿**，88 个文件无告警；
- 全库**无 TODO / FIXME / HACK / ts-ignore**；
- **hydration 纪律极佳**：首屏数据一律服务端 → props，`Math.random` / `Date.now` /
  localStorage / 定时器全部不在首帧渲染路径上（live-clock 先渲染 `--:--:--`、
  telemetry 种子由服务端下发、矩阵复测抖动用 id 哈希而非随机、score-gauge 对 SVG
  坐标做两位小数取整消浮点尾巴）；
- `src/components/ui/` 经核对为 shadcn CLI 原始产物，无手改痕迹；
- 密钥干净：代码里只有环境变量名（`apiKeyEnv`），值不落库不进 SSE 事件，
  工具参数经 `JSON.stringify` 转义进帧，无帧走私；
- **无 P0 问题**。

## P1（4 项，已立任务 T01–T04）

| # | 问题 | 位置 |
| --- | --- | --- |
| 1 | 探针 SSRF：`fetch` 默认 follow 重定向，`BLOCKED_HOSTS` 只查初始 hostname，可被 `302 → 169.254.169.254` 绕过；IPv6 元数据 `fd00:ec2::254` 与整数 IP 未覆盖 | `api/agents/probe/route.ts:85-92, 102-107` |
| 2 | SSE 拆除未防护：客户端中止后 `enqueue` / 二次 `send` / `close()` 均对已取消流抛错，服务端留下未处理拒绝 | `api/sandbox/run/route.ts:87-112` |
| 3 | `useSandboxRun` 无卸载清理：离开沙盒页本地仿真继续播、SSE 继续耗 token；`stop()` 把中止标成 completed；error 事件后不提前断流 | `hooks/use-sandbox-run.ts:138-208` |
| 4 | 注入服从检测正则 `|\*` 把任何含星号检索词判为服从注入，与自身文档「宁可漏判也不误判」相反 | `lib/nova/executors/tools.ts:232-240` |

## P2 汇总（已按主题归入 T05–T09）

### 口径一致性（→ T05）

- `chaos.ts:77`：`Math.max(..., 1)` 使 `intensity: 0` 仍注入 1 次故障并扣分；
- `scoreAfter` 语义相反：`simulation.ts:267-277` 推罚前值、`live.ts:287-304` 推罚后值；
- `live.ts:311` 注入分支 `continue` 未结算 `state.pending`；
- `live.ts:508` 摘要写死 `HARD_MAX_STEPS`(20)，实际上限是 `config.maxSteps`；
- `llm.ts:71` `Number(env ?? 2_000)` 非数字得 NaN（route.ts:68 已有正确守卫，两处不一致）；
- 潜在脆弱：`scoring.ts:55-63` `vectorScoreMap` 可缺键 → `live.ts:111`、`simulation.ts:192`
  会得 NaN `recoveryGain`（当前种子安全，未来数据危险）；
- `route.ts:34` `text.length` 按 UTF-16 code unit 而非字节；`route.ts:76-81`
  「执行器未配置」落 500；`route.ts:169-173` 不校验 `kind ∈ CHAOS_KINDS`。

### 约定违例（→ T06）

- **语义色硬编码（约 18 文件）**：`sandbox-playground.tsx`（14+ 处，含 cyan→violet 渐变进度条）、
  `capability-matrix-board.tsx:181-222`、`leaderboard-table.tsx:184-304`、
  `agent-identity.tsx:18-22`、`agent-card.tsx:36-113`、`kpi-card.tsx:51-89`、
  `live-log-terminal.tsx:163`、`telemetry-hub.tsx:45-48,203,208`（硬编码 CSS var，
  而 `theme.ts` 的 `ACCENT_CHART_VAR` 零消费）、`verification-stepper.tsx:7-32`
  （本地 `STATE_STYLE` 与 `STATUS_META` 重复）、五个页面 15+ 处；
- **深导入绕过 barrel（约 20 处）**：根因是 `index.ts` 漏 `export * from "./executor"`，
  `@/lib/nova/types` 被深导 18 次；
- **UI 重实现领域默认值且已漂移**：`sandbox-playground.tsx:573-583` 本地
  `defaultConfig()` vs `DEFAULT_CHAOS`（强度 0.6 vs 0.5/0.7、latency 启用不同）、
  `:502-504` 重实现 `effectiveIntensity()`（少钳制与 enabled 判断）、
  `grade-chip.tsx:43-47` 与 `matrix/page.tsx:85-90` 硬编码等级阈值
  （`GRADE_THRESHOLDS` 与 `scoreGapToNextGrade` 闲置）、
  `search.ts:114` `toLocaleString` 绕过 `formatNumber`。

### 交互与可达性（→ T07）

- 排行榜行选择仅鼠标，键盘用户无法到达单 Agent 详情与导出（`leaderboard-table.tsx:178-186`）；
- 运行中执行器 Tabs 未禁用（`sandbox-playground.tsx:143-159`）；
- 矩阵复测不落回综合列（`capability-matrix-board.tsx:244-248`）；
- `local-agent-card.tsx:80` 内部路由用 `<a>`；
- `nav-config.ts:55` 徽标 "8" 硬编码；
- 导出 `generatedAt` 两口径（`leaderboard-table.tsx:106` vs lib 的 `DEMO_EPOCH`）；
- 文案：半角空格残留（`agents/page.tsx:128`、`agent-onboarding-dialog.tsx:210`）、
  `sandbox/page.tsx:94-96` 三元漏「竞技场」分支。

### 死代码（→ T08）

零消费导出：`ZERO_USAGE`、`logIdOf`、`estimateDuration`、`scoreGapToNextGrade`、
`passRateOf`、`formatRelativeTime`、`formatMetric`、`formatPercent`、
`SimulationResult`、`KpiSnapshot`、`ACCENT_RING`、`ACCENT_BG`、`ACCENT_CHART_VAR`、
`RUNTIME_STATUS.inspectedMinutesAgo`、`NOVA_BRAND.sloganEn`；
不可达分支：`live.ts:68`（route 预裁剪后 `prompt.length > 8_000` 永假）；
失引注释：`local-agents.ts:50` 引用不存在的 `local-agents.example.ts`；
退化条件：`score-breakdown.tsx:111-114` 两分支相同的 `? 1 : 1`。

### 数据口径（→ T09，blocked）

- `mock-data.ts:446,488,530,572,614`：`VERIFICATION_RUNS` 的 compositeScore 手写
  （run-0339 的 68.9 vs NOCTA 派生 67.9），是全库唯一硬编码分数块，
  与「分数可追溯」铁律冲突，需标准文档决策；
- `mock-data.ts:494-497`：run-0339 `finishedAt` 早于 burst 阶段仍 `running`，内部矛盾。

## 已核对无问题（正面记录，供后续审查对照）

- 五个页面全部 Server Component 首屏，客户端组件只拿 props；
- 两条 Route Handler 无持久化、无密钥序列化、响应体有 64KB 上限；
- 遥测流、终端日志、矩阵复测、MobileNav 的定时器/监听器清理全部正确
  （唯一漏网是 T03 的 `useSandboxRun`）；
- 全局搜索 ARIA（combobox / listbox / `aria-activedescendant` / ESC 重置）实现完整；
- `agent-onboarding.ts` 与 `llm.ts` 的错误映射、`readSse` / `readBoundedText`
  的资源释放均正确。

## 关联

- AGENTS.md §5 技术债表（无后端、PULSAR 零读数、Blob 导出、同步剧本、
  单端点绑定、本地 Agent 无历史）——产品级未完成事项，归入 T10 及后续拆解；
- 本基线只做勘误；新增任务从 `planning/` 新建文件并更新 README 状态表。
