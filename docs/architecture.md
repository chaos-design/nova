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
    subgraph S["服务端（按请求取数）"]
        M["run-store.ts<br/>真实运行记录<br/>.nova/runs.json"]
        LA["local-agents.ts<br/>本地 Agent 登记"]
    end
    subgraph C["客户端"]
        PG["页面 Server Component"]
        H2["useSandboxRun<br/>消费 SSE 事件流"]
        I["交互态：排序 / 选中 / 高亮"]
    end
    M -->|"派生档案 / 遥测 / 概览"| PG
    LA -->|"可投放 Agent 名单"| PG
    PG -->|"props（首屏数据）"| H2
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

**收益为零的事情不做**：页面数据由 `run-store.ts` 直接读取本地存储
（`local-agents.ts` 提供可投放名单），首屏走 Server Component 直出，不绕 API。
等接入真实数据库或远端服务时，只需替换 `run-store.ts` 内部的读写实现，
契约仍由 `src/lib/nova` 的类型定义保证。

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

## 3. 真实运行存储与可复现性

NOVA 不预置任何档案。界面上出现的每个数字都来自一次真实跑完的沙盒验证，
落库在 `.nova/runs.json`（`run-store.ts`，带 `server-only`）：

| 关注点 | 实现 | 说明 |
| :--- | :--- | :--- |
| **落库位置** | `run-store.ts` → `.nova/runs.json` | 单文件够用；写入经 Promise 链串行化，并发落库不互相覆盖 |
| **落库时机** | `/api/sandbox/run` 收到 `done` 事件 | 放在服务端而非客户端回传 —— 否则评分等于被测方自己给自己打分 |
| **档案派生** | `LOCAL_AGENTS` 提供身份，运行记录提供评分与状态 | 没跑过的 Agent 不会出现在档案、榜单与矩阵里 |
| **证书签发** | `recordRun` 按标准 §5 三条规则判定 | 评级 ≥ B、状态已验证、已完成验证，缺一不可 |
| **页面取数** | 服务端页面按请求读取 | 读存储的页面必须 `force-dynamic`，否则构建期的记录会被烘进静态产物 |

**可复现的部分**：混沌排布（`scheduleFaults`）与故障代价（`faultPenalty`）
都是纯函数，同一份配置永远得到同一张故障表；工具本身也是确定性的 ——
混沌不是"让工具不稳定"，而是在稳定的工具外面包一层按剧本作恶的代理。
因此不同 Agent 的分数可以横向对照。

**不可复现的部分**：被测 Agent 自己的决策。这正是要被观测的东西，
不该也不能被固定下来。

![能力矩阵：Agent × 能力向量量表，点击单元格触发定向复测](images/matrix.png)

---

## 4. 状态管理：只持有游标

hook 的设计原则是**状态最小化**：

```ts
// 沙盒运行：只保存事件流累积出的 6 个字段
{ status, logs, meta, result, error, score }
```

日志、进度、得分全部由执行器推来的事件**累积**而成，不单独存一份派生副本。
好处是「状态与展示不一致」这类 bug 在结构上就不存在：
唯一的事实来源是事件流，UI 只是它的投影。

---

## 5. 客户端边界

只有真正需要本地状态或时间推进的部分才加 `"use client"`：

| 组件 | 为什么必须在客户端 |
| :--- | :--- |
| `telemetry-hub` | 指标切换与图表交互，采样点由服务端传入 |
| `live-log-terminal` | 日志列表渲染 |
| `sandbox-playground` | 表单配置 + SSE 事件流消费 |
| `leaderboard-table` | 表头排序、行选中、报告下载 |
| `capability-matrix-board` | 行选中与跳转复测 |
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
`run-store.ts` 的遥测横坐标标签也经由它生成，不在页面里各自 `toLocaleString`。

---

## 8. 换成真实后端

当前的持久化是单文件（`.nova/runs.json`），要换成数据库或远端服务时：

1. **只改 `run-store.ts` 内部**：对外的函数签名（`listRuns` / `verifiedAgents` /
   `clusterStats` / `telemetrySeries` / `recordRun`）保持不变，
   页面、组件、hook 一行都不用动。
2. **把落库搬到写入侧**：若引入消息队列或后台 worker，`recordRun` 的调用点
   （`/api/sandbox/run` 的 `done` 分支）改成投递任务即可，评分口径不变。
3. **多实例部署**：单文件的串行写锁只在进程内有效，换成数据库事务
   （或分布式锁）后再上多副本。
4. **实时遥测**：目前遥测点由运行记录派生（一次运行一个点）。
   需要秒级曲线时，再加一条 SSE 通道推送运行时采样，`TelemetryHub` 的
   入参形状（`TelemetryPoint[]`）不需要变化。

**不要做的事**：不要在页面里直接写 `fetch`。领域层是数据访问的边界，
页面只消费领域层暴露的函数与类型。
