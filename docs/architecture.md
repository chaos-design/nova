# NOVA 架构说明

本文档说明 NOVA 控制台的分层、数据流、关键机制，以及已经做出的技术决策与理由。
**技术决策记录**一节尤其重要：它记录了「为什么不那样做」，避免后来者重复同样的争论。

---

## 1. 分层

```mermaid
flowchart TD
    subgraph SERVER["Next.js 服务端"]
        P["页面层 · src/app/(nova)/*/page.tsx<br/>Server Component：取数 · 组装 · 首屏渲染"]
        RH["Route Handler（无状态代理）<br/>POST /api/sandbox/run · POST /api/agents/probe"]
        D["领域层 · src/lib/nova<br/>类型 / 常量 / 评分 / 剧本 / 报告 / 执行器<br/>无 React 依赖，任何环境可运行"]
    end
    subgraph CLIENT["浏览器"]
        C["组件层<br/>layout 外壳 · nova 领域组件 · ui（shadcn 托管）"]
        H["Hook 层 · src/hooks<br/>时间推进型状态机"]
    end
    E["外部 · OpenAI 兼容端点<br/>（本地 Agent / Ollama / vLLM …）"]

    P -->|"props 传首屏数据"| C
    C --> H
    H -->|"纯函数调用"| D
    P -->|"同步读取"| D
    RH --> D
    C -->|"fetch 仅限沙盒/探针"| RH
    RH -->|"chat/completions · models"| E
```

依赖方向严格单向向下。领域层不 import 任何组件或 hook，因此它可以被
Server Component、Client Component、Route Handler、脚本任务复用。
页面里唯一的 `fetch` 是沙盒执行与端点探针 —— 它们必须经过服务端（理由见下节）。

---

## 2. 数据流

![遥测中枢：集群概览、四项核心指标与实时遥测曲线](images/dashboard.png)

```mermaid
flowchart TD
    subgraph S["服务端（构建时 / 请求时各一次）"]
        M["mock-data.ts<br/>确定性演示数据<br/>DEMO_EPOCH 锚点 + noise(seed)"]
        LA["local-agents.ts<br/>本地 Agent 登记 → 中性先验档案"]
    end
    subgraph C["客户端"]
        PG["页面 Server Component"]
        H1["useTelemetryStream<br/>种子 + 游标推进遥测采样"]
        H2["useSandboxRun<br/>统一消费两种执行器事件"]
        I["交互态：排序 / 选中 / 复测结果"]
    end
    M -->|"纯函数直出"| PG
    LA -->|"无评分档案卡"| PG
    PG -->|"props（首屏数据）"| H1
    PG -->|"props"| H2
    PG --> I
```

### Route Handler 的位置

Route Handler 只做**无状态的服务端代理**，不保存、不编造任何数据：

| 路由 | 职责 |
| :--- | :--- |
| `POST /api/sandbox/run` | 调真实 LLM 执行器，SSE 把沙盒事件流回客户端 |
| `POST /api/agents/probe` | 探测用户填写的 OpenAI 兼容端点是否可达、协议是否兼容 |

在数据源还是本地纯函数时，Route Handler 存在的唯一理由是**必须经过服务端**：

- 密钥只存在于服务端环境变量（`readLlmSettings`），不能经过客户端；
- Agent 端点通常监听 `127.0.0.1`，浏览器直连不了；
- 向云厂商/本地模型发请求时由服务端统一处理超时与错误归一；
- 探针是 SSRF 的天然入口，服务端统一实施黑名单与重定向拦截（见 §2.1）。

**收益为零的事情不做**：所有页面数据仍由 `mock-data.ts` / `local-agents.ts`
同步提供，首屏走 Server Component 直出，不绕 API。等真实后端就位时再把
读路径换成 fetch，届时契约由 `src/lib/nova` 的类型定义直接生成。

### 2.1 两条真实执行链路

**端点探针**（接入向导第 2 步）：

```mermaid
sequenceDiagram
    autonumber
    participant U as 接入向导（浏览器）
    participant P as POST /api/agents/probe
    participant E as OpenAI 兼容端点
    U->>P: { endpoint }
    P->>P: URL 解析 · 协议白名单<br/>SSRF 黑名单（云元数据/整数 IP）
    P->>E: GET {endpoint}/models<br/>4s 超时 · 不跟随重定向 · 响应 ≤ 64KB
    E-->>P: 200 { data: [{ id }] }
    P-->>U: { reachable, openaiCompatible, models, latencyMs }
    Note over P,E: 3xx 显式拒绝 · 401/403 归为「可达但拒绝」· 超时给可读提示
```

**沙盒真实执行**（SSE 单请求流式返回）：

```mermaid
sequenceDiagram
    autonumber
    participant H as useSandboxRun
    participant R as POST /api/sandbox/run
    participant X as runLive 执行器
    participant T as 工具集（混沌代理）
    participant M as 模型端点
    H->>R: { agentId, systemPrompt, environment, chaos, maxSteps }
    R->>R: 字节级限长 · chaos kind 白名单 · 步数钳制
    R->>X: 反查档案（不信客户端档案）+ 组装 LlmSettings
    X->>X: 静态提示词校验（失败即中止，不烧 token）
    loop 每轮 ≤ maxSteps（服务端钳制 ≤ 20）
        X->>M: chat/completions（tools · tool_choice=auto）
        M-->>X: tool_calls / 最终结论
        X->>T: executeTool(name, args, 注入故障?, 强度)
        T-->>X: ToolOutcome（成功 / 混沌失败 / 带注入的内容）
        X-->>H: SSE step 事件（scoreAfter = 结算后口径）
        H-->>H: 收到 done/error 立即断流；页面卸载即 abort
    end
    X-->>H: done 事件（评分 · 反思 · 自愈清单 · token 用量）
```

![沙盒真实执行：STUB 在混沌注入下的完整事件流与评分](images/sandbox-live-run.png)

客户端侧的生命周期约定（`use-sandbox-run.ts`）：

- 组件卸载即 `AbortController.abort()`——离开页面不会留下继续烧 token 的流；
- 「中止」产生独立的 `stopped` 状态，与「已结束」（自然完成）在界面上可区分；
- 收到 `done` / `error` 事件后立即取消读取，不空转到 EOF。

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

交互态同样遵守确定性：能力矩阵的**复测抖动**由 `retestDelta(agentId, vector)`
的字符串哈希推导（±1.5 分），同一格重复点击结果恒定；复测落回原位时，
该行的综合评分由 `compositeScore` 实时重新派生，雷达图与拆解同步更新。

![能力矩阵：Agent × 能力向量量表，点击单元格触发定向复测](images/matrix.png)

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
| `app-shell` | ⌘K 快捷键与搜索弹窗是全局单例，状态挂在常驻外壳上 |
| `nova-sidebar` | 收起态 + localStorage 持久化 |
| `appearance-menu` | 偏好写入 localStorage 并立即作用到 `<html>` |
| `global-search` | 弹窗本身是无状态客户端组件，键盘导航在本地 |
| `agent-onboarding-dialog` | 多步向导 + 表单 + 探针反馈 |
| `local-agent-card` | 一键复制环境变量片段到剪贴板 |

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

### 界面主色 vs 数据语义色

色板被拆成两层：

- `--nova-cyan` 等六个霓虹色是**语义色**（自主性=青、混沌异常=玫红），固定不变；
- `--nova-accent` 是**界面主色**，由 `[data-nova-accent]` 预设覆写，只作用于
  外壳（导航、焦点环、主按钮、网格、星云辉光）。

主色切换的三个非显然决策：

1. **shadcn 令牌重挂在 `nova-theme.css` 而不是 `globals.css`** —— 后者被 CLI 托管，
   一次 `add`/`migrate` 会把值覆盖回中性色。
2. **选择器写作 `html[data-nova-accent]`** —— globals 的 `:root` 同特异度且更靠后，
   只有 `(0,1,1)` 能稳定压过 `(0,1,0)`。
3. **首帧之前由内联脚本落定偏好**（`appearance.ts · APPEARANCE_BOOTSTRAP`），
   否则会先闪一次默认配色。这是整页唯一的 `dangerouslySetInnerHTML`，
   在 `layout.tsx` 里按行关掉 Biome 规则并注明原因。

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

### 7.6 时间口径统一为北京时间

**决策**：界面上所有时间都以 `Asia/Shanghai` 渲染，不跟随浏览器本地时区。

**理由**：

- 运营口径是东八区；跟随浏览器意味着同一批数据在上海和旧金山读出不同的「最近验证时间」，
  对照评测结果时没有单一说法；
- 服务端预渲染与客户端水合的运行时区不一定相同，`Date#getHours()` 直接输出会
  当场制造一处 hydration 不一致 —— 固定 `timeZone` 的 `Intl.DateTimeFormat`
  在服务端和浏览器一定算出同一串字符。

**实现**：`format.ts` 集中定义 `DISPLAY_TIME_ZONE` 与全部格式化函数；
`mock-data.ts` 的遥测横坐标标签也经由它生成，不在页面里各自 `toLocaleString`。

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
