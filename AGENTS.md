# NOVA 项目约定

本文档面向在本仓库中工作的 AI Agent 与人类协作者，说明目录职责、开发规约与不可违背的约束。

**阅读顺序建议**：先读 [`docs/nova-standard.md`](docs/nova-standard.md)（评测口径），
再读 [`docs/architecture.md`](docs/architecture.md)（架构与决策）。

---

## 1. 项目是什么

NOVA（Next-gen Operational Verification for Agents）是一个面向 AI Agent 的
验证、测试与编排控制台。当前版本是**纯前端演示**：无后端、无数据库、无 API 路由，
所有数据来自 `src/lib/nova/mock-data.ts` 的确定性生成。

界面上出现的每一个分数都必须能追溯到 `docs/nova-standard.md` 的某一条规则 ——
新增任何"指标"之前，先读那份文档。

---

## 2. 目录职责

| 路径 | 职责 | 可以做的事 | 不该做的事 |
| :--- | :--- | :--- | :--- |
| `src/lib/nova/` | 领域层 | 放类型、常量、评分、剧本、报告等纯逻辑 | import 任何 React 组件或 hook |
| `src/hooks/` | 时间推进型状态机 | 放带 `useState`/`useEffect` 的通用状态逻辑 | 耦合具体页面 |
| `src/components/layout/` | 控制台外壳 | 导航、顶栏、品牌、页头、深空背景 | 放业务卡片 |
| `src/components/nova/` | 领域组件 | 仪表、图表、矩阵、沙盒、终端 | 直接 `fetch` 或读 mock 文件 |
| `src/components/ui/` | **shadcn CLI 托管** | 通过 `npx shadcn@latest add <组件>` 生成或 `--overwrite` 重生成 | 手写、修改、重排 |
| `src/app/(nova)/` | 页面 | Server Component，取数 + 组装 + 首屏渲染 | 放置跨页共享的组件 |

---

## 3. 开发规约

### 3.1 命令

```bash
npm run check      # typecheck + lint，提交前必跑
npm run dev        # 开发服务器
npm run build      # 生产构建（同时校验类型）
```

新增依赖或修改 Next.js 配置后，需要跑一次 `npx next typegen`
以刷新 `LayoutProps` / `PageProps` / `RouteContext` 等全局类型。

### 3.2 代码风格

- 格式与 lint 全部交给 Biome，不要手动对齐，也不要加 `// eslint-disable`。
- 领域标识（`autonomy`、`toolUsage`、`reasoning`、`malformedPayload` …）保持英文稳定键；
  界面文案全部中文，通过 `VECTOR_META` / `CHAOS_KINDS` 等静态配置查表映射。
- 注释解释**为什么**，不解释**做了什么**。
- 导入统一走 `@/lib/nova` 出口，不要深入内部模块路径。

### 3.3 客户端边界

默认写 Server Component。只有满足以下之一才加 `"use client"`：

- 需要本地状态或浏览器 API；
- 需要随时间推进（定时器、订阅）；
- 需要 `usePathname` 等客户端 hook。

**首屏数据一律由服务端页面作为 props 传入客户端组件**，
不要在客户端重新生成 —— 这是消除 hydration 不一致的根本做法。

### 3.4 修改演示数据时

`src/lib/nova/mock-data.ts` 的三条铁律：

1. **不引入 `Math.random()` 与 `Date.now()`**：一切由序号与 `DEMO_EPOCH` 锚点决定；
2. **不硬编码派生值**：综合评分、评级、证书编号必须由能力向量派生；
3. **改能力向量就要检查下游**：评级、排名、沙盒故障代价、证书签发全部依赖它。

---

## 4. 不可违背的约束

1. **`src/components/ui/` 归 shadcn CLI 所有**。手写会在下次 `shadcn add --overwrite` 时丢失。
2. **NOVA 主题写在 `src/app/nova-theme.css`**。不要往 `globals.css` 里加 NOVA 私有配置，
   它会被 shadcn 的重写操作吃掉。
3. **不引入明暗主题切换**。深空唯一是有意的产品决策，理由见
   [`docs/architecture.md`](docs/architecture.md#71-深空唯一主题不做明暗切换)。
4. **不在页面里写 `fetch`**。数据访问的边界是 `src/lib/nova/`。
5. **改评分口径必须同步改标准文档**。`docs/nova-standard.md` 第 8 节维护了
   标准条款与代码位置的对应表。

---

## 5. 已知的技术债

| 项 | 现状 | 何时处理 |
| :--- | :--- | :--- |
| 无后端与持久化 | 刷新页面后交互状态丢失 | 接入真实后端时 |
| `PULSAR` 等档案的子项读数为 0 | 未完成验证，刻意留空 | 该 Agent 真正跑完验证后 |
| 报告导出走 `Blob` + `ObjectURL` | 仅前端下载，无后端存档 | 需要服务端归档时 |
| 沙盒剧本为同步生成 | 步数多时会一次性生成较长数组 | 单次运行超过 200 步时 |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
