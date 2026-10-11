# 部署指南

本文档说明两种对外交付方式：**Vercel serverless 部署**（控制台托管到 Vercel）
与 **自托管发布产物**（`release:*` 流水线打 tarball，见 README 发布阶段）。
两者互不替代：Vercel 上跑的是控制台本体，playground 里的本地 Agent 不会也不
能部署上去。

---

## 目录

- [1. Vercel 部署](#1-vercel-部署)
  - [1.1 能部署什么、不能部署什么](#11-能部署什么不能部署什么)
  - [1.2 操作步骤](#12-操作步骤)
  - [1.3 必须配置的环境变量](#13-必须配置的环境变量)
  - [1.4 部署机制（为什么需要这些改动）](#14-部署机制为什么需要这些改动)
  - [1.5 已知限制](#15-已知限制)
- [2. GitHub Actions](#2-github-actions)

---

## 1. Vercel 部署

### 1.1 能部署什么、不能部署什么

| 部分 | 可部署性 | 说明 |
| :--- | :--- | :--- |
| `packages/web`（Next.js 控制台） | ✅ | App Router + 服务端渲染 + API 路由，Vercel 原生支持 |
| `@chaos-design/config`（配置加载器） | ✅ | 纯 Node ESM，随函数产物一起 trace |
| `playground/nova-local`（本地 Agent） | ❌ | 常驻 HTTP 进程（默认 `127.0.0.1:43110`），serverless 无法常驻；Vercel 上把它替换成任何**公网可达**的 OpenAI 兼容端点 |
| `.nova/runs.json` 文件落库 | ⚠️ 降级 | 函数文件系统只读，自动降级为进程内内存（见 1.4 / 1.5） |

### 1.2 操作步骤

**Dashboard（推荐）**

1. Vercel Dashboard → *Add New Project* → 连接本仓库（GitHub 集成）。
2. Framework 选 **Next.js**，**Root Directory 填 `packages/web`**。
   `packages/web/vercel.json` 里的 `"rootDirectory": "../.."` 会保证
   `pnpm install` 在 monorepo 根执行（识别 `packageManager` 字段自动固定
   pnpm 版本）。
3. 按 1.3 配置环境变量。
4. 推送 `main` 即自动部署；PR 自动产出 Preview 部署。

**CLI（等效）**

```bash
cd packages/web
npx vercel link   # 首次：选择团队 / 项目
npx vercel        # 部署
```

### 1.3 必须配置的环境变量

`config.yaml` 里 LLM 相关键的默认值全部指向本地 playground
（`http://127.0.0.1:43110/v1`），**在 Vercel 上必须覆盖**，否则沙盒
执行器的出站请求会打到函数容器自身的回环地址而失败：

| 变量 | 必填 | 说明 |
| :--- | :--- | :--- |
| `NOVA_LLM_BASE_URL` | ✅ | 公网可达的 OpenAI 兼容端点，如 `https://api.openai.com/v1` |
| `NOVA_LLM_MODEL` | ✅ | 模型名，按端点实际可用的填 |
| `NOVA_LLM_API_KEY` | ✅ | 密钥。`config.yaml` 默认是空串（不带头），配了才会带 `Authorization` |
| `NOVA_LLM_MAX_TOKENS` | — | 单次补全上限，默认 2000 |
| `NOVA_LLM_TIMEOUT_MS` | — | 单次调用超时，默认 30000 |
| `NOVA_ENV` | — | 环境标签，Vercel 上建议填 `production` |
| `NOVA_LOG_LEVEL` / `NOVA_LOG_ECHO_PAYLOAD` | — | 日志级别 / 是否回显载荷 |

本地 Agent 的端口 / 主机名类变量（`NOVA_AGENT_*`）在 Vercel 上无意义，不用配。

### 1.4 部署机制（为什么需要这些改动）

三个配套改动让同一份代码在 serverless 上可用，本地行为零变化：

1. **`config.yaml` 随函数下发**：`packages/web/next.config.ts` 用
   `outputFileTracingIncludes` 把仓库根的 `config.yaml` 打进每个服务端函数。
   配置仍保持单一事实来源（仓库根 `config.yaml`），改配置推 GitHub 即
   自动重新部署生效。

   **前提：`config.yaml` 与 `.env.example` 必须已提交进版本库**。
   `config.yaml` 是**无密钥模板**（敏感值一律 `${VAR:-默认值}` 插值，
   注释自证「配置里不落任何真实密钥」）；`.env` 才是本机私有文件
   （`.gitignore` 第 30 行），永不进仓库、永不随部署产物上公网。
   Vercel 的构建与 GitHub CI 的检出都只拿到 git 里的文件 —— 漏提交
   `config.yaml` 时，CI 的 `pnpm run test`（vitest 配置加载即调用
   `getConfig()`）与 Vercel 的 `/api/sandbox/run`（运行时 `getConfig()`）
   都会直接抛错。
2. **项目根探测兜底**：`@chaos-design/config` 的 `projectRoot()` 覆盖链为
   `NOVA_ROOT` → `VERCEL_PATH`（Vercel 注入的函数根目录，`config.yaml`
   正被 trace 到此处）→ 向上找 `pnpm-workspace.yaml`。本地 / 自托管仍走
   最后一条，不受影响。
3. **运行记录内存兜底**：`packages/web/src/lib/nova/run-store.ts` 检测到
   `process.env.VERCEL`（Vercel 函数会注入）时，读写走进程内内存，绝不
   碰只读文件系统；本地 / standalone 仍落 `.nova/runs.json`。

### 1.5 已知限制

- **数据不跨实例、不持久**：内存兜底意味着同一函数实例热存期内看板能看到
  刚跑完的运行记录，但 scale-to-zero 后清空，且页面函数与 API 函数之间
  不共享。需要持久化时接外部存储（Vercel KV / Postgres），替换点在
  `run-store.ts` 内部（函数签名不变）。
- **函数时长**：`/api/sandbox/run` 声明 `maxDuration = 120` 秒。Hobby 档
  上限 60 秒会被平台截断，长剧本可能跑到一半被掐断；Pro 档内无影响。
- **本地 Agent 探测无效**：`/api/agents/probe` 与沙盒执行器都能探测公网
  端点，但 `127.0.0.1` 在 Vercel 上指向函数自身回环，probe 必然失败 ——
  这是预期行为，把被测 Agent 部署到公网可达地址即可。

---

## 2. GitHub Actions

`.github/workflows/ci.yml` 承担质量门禁：

| 触发 | 内容 |
| :--- | :--- |
| 所有 PR | `pnpm install --frozen-lockfile` → `pnpm run check`（typecheck + biome）→ `pnpm run test`（各包单测 + 集成测） |
| push `main` | 同上 |

说明：

- **部署不由 Actions 触发**：Vercel 的 GitHub 集成（push `main` 自动
  Production、PR 自动 Preview）已覆盖；Actions 里不重复维护一套带
  token 的部署流水线。
- **`config.yaml` 必须已提交进仓库**：web / nova-config 两个包的
  vitest 配置加载时就调用 `getConfig()` 读它。它无密钥（见 1.4），
  提交的是模板本身；CI 不注入 `.env`，`config.yaml` 里每个变量都有
  `:-` 默认值，缺省启动不会因缺密钥而失败。
- **e2e 不进 CI**：`test:e2e` 需要真实拉起 dev server 与本地 Agent 进程，
  留在本地 / 发布前跑（`pnpm run test:all`）。
- **不做 GitHub Pages 部署**：控制台带 API 路由、SSE 流式与服务端
  `fs` 落库，纯静态托管无法运行；仓库内也没有独立的静态站点内容。
- **发布流水线（`release:*` + tarball + GitHub Release）暂不自动化**，
  仍按 README 发布阶段在本地执行。
