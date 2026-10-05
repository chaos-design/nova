# NOVA 架构说明

本文档说明 NOVA 控制台的分层、数据流、关键机制，以及已经做出的技术决策与理由。
**技术决策记录**一节尤其重要：它记录了「为什么不那样做」，避免后来者重复同样的争论。

---

## 1. 分层

```text
┌─────────────────────────────────────────────────────────┐
│  页面层    src/app/(nova)/*/page.tsx        Server Component │
│            取数、组装、首屏渲染                              │
├─────────────────────────────────────────────────────────┤
│  组件层    src/components/layout  外壳（服务端 + 少量客户端）  │
│            src/components/nova    领域组件（按需 "use client"）│
│            src/components/ui      shadcn CLI 托管，勿手改     │
├─────────────────────────────────────────────────────────┤
│  Hook 层   src/hooks                时间推进型状态机           │
├─────────────────────────────────────────────────────────┤
│  领域层    src/lib/nova             类型 / 常量 / 评分 / 剧本   │
│            无 React 依赖，可在任何环境运行                    │
└─────────────────────────────────────────────────────────┘
```

依赖方向严格单向向下。领域层不 import 任何组件或 hook，因此它可以被
Server Component、Client Component、Route Handler、脚本任务复用。

---

## 2. 数据流

```text
页面（Server Component）
  │
  ├─ 同步读取 lib/nova（纯函数，无 IO）
  │     └─ 把数据作为 props 传给客户端组件
  │
  └─ 客户端组件（"use client"）
        ├─ useTelemetryStream：定时推进遥测采样
        ├─ useSimulationRun：定时推进剧本游标
        └─ 交互态（选中、排序、复测结果）
```

### 为什么没有 API 路由

当前版本是**纯前端演示**，所有数据由 `mock-data.ts` 同步提供。
在数据源还是本地纯函数时，加一层 Route Handler 只会引入：

- 多一次网络往返（首屏变慢）；
- 多一个需要维护的契约（序列化 / 反序列化）；
- 多一处 hydration 边界风险。

**收益为零，成本为正**，因此不做。等真实后端就位时再加，届时契约由
`src/lib/nova` 的类型定义直接生成，不需要重新设计。

---

## 3. 确定性 mock 的设计

演示数据最容易犯的错是「假装是真的」：用 `Date.now()`、用 `Math.random()`，
结果每次刷新数字都变，页面被静态预渲染后时间戳还停留在构建那一刻。

NOVA 的做法是**一切由序号与锚点决定**：

| 机制 | 实现 | 解决的问题 |
| :--- | :--- | :--- |
| **时间锚点** | `constants.ts` · `DEMO_EPOCH` | 所有 mock 时间戳相对锚点生成，页面可静态预渲染且文案稳定 |
| **遥测纯函数** | `mock-data.ts` · `telemetryPointAt(index)` | 首屏种子与客户端后续采样连续，不产生 hydration 差异或曲线跳变 |
| **确定性伪随机** | `mock-data.ts` · `noise(seed)` | 三角函数哈希代替 `Math.random()`，同一 seed 结果恒定 |
| **剧本推导** | `simulation.ts` · `buildSimulationPlan(config, agent)` | 同一份配置永远得到同一次运行，便于复现与对照实验 |
| **派生而非硬编码** | `mock-data.ts` · `createAgent` 只写能力向量，综合评分 / 评级 / 证书编号全部派生 | 单一事实来源，改一个分数不会漏改三处 |

---

## 4. 状态管理：只持有游标

两个 hook 的共同设计是**状态最小化**：

```ts
// 遥测流：只保存一个游标 + 一个滚动窗口
{ points, cursor, paused }

// 沙盒剧本：只保存一个游标 + 一个状态
{ cursor, status }
```

日志、得分、进度全部由「剧本/窗口 + 游标」**派生**，不单独存一份。
好处是「状态与展示不一致」这类 bug 在结构上就不存在，
暂停、重放、重置都退化为移动游标。

代价是每次推进都要重算派生值 —— 但剧本规模是几十步、窗口是几十个点，
这个代价可以忽略，不值得为它引入 memo 缓存层。

---

## 5. 客户端边界

只有真正需要本地状态或时间推进的部分才加 `"use client"`：

| 组件 | 为什么必须在客户端 |
| :--- | :--- |
| `telemetry-hub` | 定时推进遥测采样，种子由服务端传入 |
| `live-log-terminal` | 定时推送事件 |
| `sandbox-playground` | 表单配置 + 剧本播放 |
| `leaderboard-table` | 表头排序、行选中、报告下载 |
| `capability-matrix-board` | 单元格复测、行选中 |
| `nav-list` / `mobile-nav` / `live-clock` | `usePathname` / 抽屉状态 / 秒级时钟 |

其余全部是服务端渲染。**遥测种子等首屏数据一律由页面作为 props 传入**，
不在客户端重新生成 —— 这是消除 hydration 不一致的根本做法。

---

## 6. 主题系统

主题被拆成两个文件，边界是刻意划的：

| 文件 | 归属 | 内容 |
| :--- | :--- | :--- |
| `src/app/globals.css` | shadcn CLI | 标准令牌（`:root`）、字体映射 |
| `src/app/nova-theme.css` | NOVA | 霓虹色板、动画关键帧、背景工具类（`nova-backdrop` / `nova-grid` / `nova-panel` …） |

**为什么要拆**：`shadcn add` / `shadcn migrate` 会重写 `globals.css` 的标准区块。
把自有主题隔离在另一个文件里，重写操作永远不会吃掉 NOVA 的视觉配置。

一个已踩过的坑：`@keyframes` 写在 `@theme` 内会被 Tailwind 摇掉
（只有被引用的才会输出）。`nova-theme.css` 里的关键帧因此全部声明在 `@theme` 之外。

---

## 7. 技术决策记录

### 7.1 深空唯一主题，不做明暗切换

**决策**：`<html class="dark">` 固定挂载，不引入 `next-themes`，不提供浅色配色。

**理由**：

- 深空 + 霓虹是 NOVA 的识别符号，浅色版本不是「另一种皮肤」，而是另一套设计；
- 固定挂载 `.dark` 意味着零 FOUC、零主题闪烁，也不需要处理 hydration 期间的主题不确定态；
- 省掉一个依赖与一层 provider，全站少一个可能出错的运行时状态。

**代价**：控制台截图、打印、浅色环境阅读体验较差。
**何时该推翻**：如果 NOVA 需要嵌入明亮办公环境做长时间阅读，届时应把
`nova-backdrop` / `nova-panel` 抽象成可换肤的令牌，而不是临时加一个开关。

### 7.2 Biome 而非 ESLint + Prettier

**决策**：使用 Biome 作为唯一的格式化与静态检查工具。

**理由**：

- Next.js 16 已移除 `next lint`，`next build` 也不再跑 lint，需要独立工具；
- Biome 同时覆盖格式化、lint、import 排序与部分安全规则，速度约为 ESLint 链路的 10~20 倍；
- 单一工具意味着只有一套配置与一套 CI 步骤。

**例外**：`src/components/ui/`（shadcn 注册表产物）在 `biome.json` 中关掉了
`noArrayIndexKey` 与 `noDangerouslySetInnerHtml` —— 这些文件由 CLI 托管，
本地规则不该污染可重生成的上游代码。

### 7.3 图表只用 Recharts，单值图形手写 SVG

**决策**：趋势类图表用 Recharts（经 shadcn `chart` 封装）；
单个分数的径向仪表（`score-gauge`）手写 SVG。

**理由**：`score-gauge` 只需要两个圆弧和一圈刻度，用图表库反而更重、
更难精确控制。衡量标准是「这个图形用库是否更省事」，不是「是否统一用库」。

### 7.4 深色令牌写在 `:root` 而非 `.dark`

**决策**：暗色令牌直接声明在 `:root`，不维护 `.dark` 区块。

**理由**：`:root` 与 `.dark` 都指向 `<html>`，`.dark` 只是优先级更高。
删除 `.dark` 区块后，`:root` 的值自然向下继承，既少一份重复定义，
又不会因为将来误加 `.dark` 而出现两套值打架。

### 7.5 领域类型集中于单一文件

**决策**：`src/lib/nova/types.ts` 一个文件承载全部领域类型。

**理由**：领域模型是这个项目最重要的资产。分散在 10 个文件里，
读者无法一次建立完整心智模型，也无法在改一个字段时看清影响面。
单文件的代价是文件偏长 —— 这个代价低于「读不懂全局」的代价。

---

## 8. 接入真实后端

建议路径，按投入产出排序：

1. **先接读路径**：在 `src/lib/nova/` 新增 `client.ts`，把 `AGENTS`、
   `VERIFICATION_RUNS`、`TELEMETRY_SEED` 换成 `fetch` 调用（建议配合
   Next.js 的 `cache()` / `revalidateTag`）。页面层改动量为零。
2. **再接遥测流**：把 `telemetry-hub` 的 `setInterval` 换成 SSE / WebSocket 订阅。
   `useTelemetryStream` 的对外接口（`points` / `paused` / `toggle`）无需变化。
3. **最后接执行器**：把 `buildSimulationPlan` 换成一个"提交任务 → 轮询/订阅状态"的调用。
   `SimulationPlan` / `ScriptStep` 的类型就是前后端之间的契约，
   可直接用于定义服务端返回体。
4. **能力复测**：`capability-matrix-board` 里的 `retestDelta` 换成真实请求，
   现有的 loading / 禁用态交互逻辑可以原样保留。

**不要做的事**：不要在页面里直接写 `fetch`。领域层是数据访问的边界，
页面只消费领域层暴露的函数与类型。
