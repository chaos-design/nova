# NOVA 项目约定（monorepo 根）

本文档面向在本仓库中工作的 AI Agent 与人类协作者，说明目录职责、开发规约与不可违背的约束。

**阅读顺序建议**：先读 [`docs/nova-standard.md`](docs/nova-standard.md)（评测口径），
再读 [`docs/architecture.md`](docs/architecture.md)（架构与决策）。
涉及 Agent 对接（端点契约 / 工具与任务书 / 故障文案 / SSE 事件 / 安全边界）时，
以 [`docs/agent-protocol.md`](docs/agent-protocol.md)（对接协议，规范条款）为准；
开发 / 注册本地 Agent 的操作步骤见 [`docs/local-agent.md`](docs/local-agent.md)。

本仓库是 pnpm monorepo（`pnpm-workspace.yaml`）：

| Workspace | 包 | 说明 |
| :--- | :--- | :--- |
| `packages/web` | `@chaos-design/web` | NOVA 控制台（Next.js 应用） |
| `packages/nova-config` | `@chaos-design/config` | 共享配置加载器（纯 Node ESM，被 web 与 Agent 共用） |
| `playground/nova-local` | `@chaos-design/nova-local` | 本地验证用 OpenAI 兼容 Agent 服务 |

## 1. 项目是什么

NOVA（Next-gen Operational Verification for Agents）是一个面向 AI Agent 的
验证、测试与编排控制台。**界面上没有预置数据**：所有档案、评分、榜单都来自
登记在 `packages/web/src/lib/nova/local-agents.ts` 的 Agent 真实跑出来的运行记录，
由 `packages/web/src/lib/nova/run-store.ts` 落库于仓库根的 `.nova/runs.json`；沙盒只有真实执行
一条路径（`packages/web/src/lib/nova/executors/live.ts`）。Route Handler
（`/api/sandbox/run`、`/api/agents/probe`）只做服务端代理与落库。
所有在界面上出现的分数都必须能追溯到 `docs/nova-standard.md` 的某一条规则 ——
新增任何"指标"之前，先读那份文档。

---

## 2. 目录职责

### 2.1 `packages/web`（Next.js 应用）

| 路径 | 职责 | 可以做的事 | 不该做的事 |
| :--- | :--- | :--- | :--- |
| `src/lib/nova/` | 领域层 | 放类型、常量、评分、剧本、报告等纯逻辑 | import 任何 React 组件或 hook |
| `src/hooks/` | 时间推进型状态机 | 放带 `useState`/`useEffect` 的通用状态逻辑 | 耦合具体页面 |
| `src/components/layout/` | 控制台外壳 | 导航、顶栏、品牌、页头、深空背景 | 放业务卡片 |
| `src/components/nova/` | 领域组件 | 仪表、图表、矩阵、沙盒、终端 | 直接 `fetch` 或读存储文件 |
| `src/components/ui/` | **shadcn CLI 托管** | 通过 `npx shadcn@latest add <组件>` 生成或 `--overwrite` 重生成 | 手写、修改、重排 |
| `src/app/(nova)/` | 页面 | Server Component，取数 + 组装 + 首屏渲染 | 放置跨页共享的组件 |

### 2.2 其他 workspace 成员

| 路径 | 职责 | 可以做的事 | 不该做的事 |
| :--- | :--- | :--- | :--- |
| `packages/nova-config` | 共享配置加载器（读仓库根 `config.yaml` + 环境变量） | 纯 Node 逻辑，导出 `getConfig` / `loadConfig` / `projectRoot` | 引入 Next.js、React 或任何 web 侧依赖 |
| `playground/nova-local` | 本地 OpenAI 兼容 Agent 服务 | 只依赖 `@chaos-design/config` 读仓库根配置 | 直读 `config.yaml` 原文；写死密钥 |
| `scripts/` | 跨 workspace 的根级脚本（e2e、发布流水线） | 任意读包内文件 | 在根目录实现业务逻辑 |
| 仓库根数据文件 | `.nova/`（运行记录）、`config.yaml`、`.env` / `.env.example` | 只由服务端代码与脚本读写 | 随包发布出去 |

---

## 3. 开发规约

### 3.1 命令

在仓库根执行（脚本内部通过 `pnpm --filter` 切到包目录）：

```bash
pnpm install            # 安装全部 workspace 依赖
pnpm run check          # typecheck + lint，提交前必跑
pnpm run dev            # 开发服务器（packages/web）
pnpm run build          # 生产构建（同时校验类型）
pnpm run dev:agent      # 本地 Agent 服务
pnpm run test / test:all   # 各包单测 + 集成 / 全栈 e2e
pnpm run lint:fix       # Biome 自动修复
```

新增依赖或修改 Next.js 配置后，需要跑一次 `pnpm --filter @chaos-design/web exec next typegen`
（或 `cd packages/web && node node_modules/next/dist/bin/next typegen`）
以刷新 `LayoutProps` / `PageProps` / `RouteContext` 等全局类型。

各包自带同名脚本（在包目录内直接 `pnpm run test` 等）；
发布流水线：`pnpm run release:check` / `release:version` / `release:build` /
`release:package` / `release:publish`（详见 `README.md` 发布章节）。

### 3.2 代码风格

- 格式与 lint 全部交给 Biome，不要手动对齐，也不要加 `// eslint-disable`。
- 领域标识（`autonomy`、`toolUsage`、`reasoning`、`malformedPayload` …）保持英文稳定键；
  界面文案全部中文，通过 `VECTOR_META` / `CHAOS_KINDS` 等静态配置查表映射。
- 注释解释**为什么**，不解释**做了什么**。
- web 包内导入统一走 `@/lib/nova` 出口，不要深入内部模块路径；
  跨包只通过 `workspace:*` 依赖（如 `@chaos-design/config`），**禁止相对路径跨包引用**。
  已声明例外（保持深导入，勿"修"，理由写在 `src/lib/nova/index.ts` 头部注释）：
  `@/lib/nova/run-store`（`server-only` + `node:fs`，服务端页面单独引入）、
  `@/lib/nova/executors/live` 与 `@/lib/nova/executors/llm`（`server-only`，
  只被服务端 route 使用；经 barrel 引入会让客户端组件编译失败）。
- 时间一律用 `format.ts` 的函数格式化（固定北京时间），不写 `toLocaleString` / `getHours()`。
- 界面主色用 `text-nova-accent` / `bg-nova-accent`，不要在组件里硬编码 `nova-cyan`；
  六个亮色调只保留给**语义色**（`theme.ts` 里的状态 / 等级 / 向量映射）。

### 3.3 客户端边界

默认写 Server Component。只有满足以下之一才加 `"use client"`：

- 需要本地状态或浏览器 API；
- 需要随时间推进（定时器、订阅）；
- 需要 `usePathname` 等客户端 hook。

**首屏数据一律由服务端页面作为 props 传入客户端组件**，
不要在客户端重新生成 —— 这是消除 hydration 不一致的根本做法。

### 3.4 使用真实运行存储时

`packages/web/src/lib/nova/run-store.ts` 的三条铁律：

1. **服务端专属**：它带 `server-only` 且依赖 `node:fs`，因此不从 `@/lib/nova`
   统一出口导出，只能由服务端页面按 `@/lib/nova/run-store` 引入；
2. **落库只发生在服务端**：评分若由客户端回传，等于把打分权交给被测方，
   因此 `/api/sandbox/run` 在收到 `done` 事件时直接落库；
3. **读存储的页面必须 `export const dynamic = "force-dynamic"`**，
   否则构建期会把当时的记录烘进静态产物。

另外：`storePath()` 锚定 monorepo 根（`@chaos-design/config` 的 `projectRoot()` 向上找
`pnpm-workspace.yaml`），保证 `.nova/runs.json` 始终落在仓库根，
与 `config.yaml`、`.env` 同处一地，不随 `next dev` 的 cwd（`packages/web`）漂移。

### 3.5 配置

仓库根的 `config.yaml` 是**唯一的配置事实来源**：控制台、本地 Agent、
e2e 与发布脚本都经 `@chaos-design/config` 读取，不各自解析。
新增配置键必须同步更新 `.env.example`，并跑 `pnpm run config:check`。

---

## 4. 不可违背的约束

1. **`packages/web/src/components/ui/` 归 shadcn CLI 所有**。手写会在下次
   `shadcn add --overwrite` 时丢失。
2. **NOVA 主题写在 `packages/web/src/app/nova-theme.css`**。不要往 `globals.css`
   里加 NOVA 私有配置，它会被 shadcn 的重写操作吃掉。
3. **不引入明暗主题切换**。深空唯一是有意的产品决策，理由见
   [`docs/architecture.md`](docs/architecture.md#71-深空唯一主题不做明暗切换)。
   可切换的只是界面主色与动效档位（`data-nova-accent` / `data-nova-motion`），
   偏好放 localStorage，首帧由 `APPEARANCE_BOOTSTRAP` 内联脚本落到 `<html>`。
4. **不在页面里写 `fetch`**。数据访问的边界是 `packages/web/src/lib/nova/`。
5. **改评分口径必须同步改标准文档**。`docs/nova-standard.md` 第 8 节维护了
   标准条款与代码位置的对应表。
6. **本地 Agent 只进 `packages/web/src/lib/nova/local-agents.ts` 的 `LOCAL_AGENTS`**。
   密钥永远只存环境变量名，不落进档案；未跑完验证的本地 Agent 不进排行榜与矩阵，
   不编造综合评分。线上对接契约见 `docs/agent-protocol.md`（规范条款），
   开发/接入步骤见 `docs/local-agent.md`。
7. **`src/components/ui/` 与 `nova-theme.css` 的 lint 豁免写在根 `biome.json`**，
   路径前缀是 `packages/web/`。新增豁免时保持同风格，不要下沉到包内再放一份。

---

## 5. 已知的技术债

| 项 | 现状 | 何时处理 |
| :--- | :--- | :--- |
| 持久化走单 JSON 文件 | `.nova/runs.json`，写入串行化但未跨进程加锁 | 需要多实例部署时换成真实数据库 |
| 报告导出走 `Blob` + `ObjectURL` | 仅前端下载，无后端存档 | 需要服务端归档时 |
| 名次快照需显式回写 | `saveRankSnapshot()` 目前未在渲染路径调用，排名涨跌恒为 0 | 需要在榜单渲染后落一次快照时 |
| 单次运行的日志未落库 | 只存结论与阶段耗时，不存逐条事件 | 需要回放完整事件流时 |
| Vercel 部署走内存兜底 | 检测 `process.env.VERCEL` 时 `run-store` 读写进程内内存，跨函数实例不共享、scale-to-zero 即清空；`config.yaml` 经 `outputFileTracingIncludes` trace 进函数，`projectRoot()` 以 `VERCEL_PATH` 兜底找根 | 需要多实例 / 跨实例持久化时与「单 JSON 文件」一并换外部存储，见 `docs/deploy.md` |
| 发布产物为手工组装 | `release:package` 复制 web standalone 产物 + `config.yaml` + `playground`，无签名与校验和 | 需要对外分发时 |

---

## 6. 各包附加约定

- `packages/web` 内还有一份 [`packages/web/AGENTS.md`](packages/web/AGENTS.md)
  （由 `next dev` 托管的 Next.js 版本说明块），修改 Next.js 相关代码前先看它。
- 共享新逻辑先判断归属：纯 Node、被 web 与 Agent 双方需要的放 `@chaos-design/config`；
  只有一方用的留在包内。
