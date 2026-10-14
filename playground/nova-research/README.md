# NOVA-RESEARCH（调研专员）

NOVA 的领域专家 Agent 之一：专职信息调研的 **OpenAI 兼容人格代理端点**。
与零依赖的规则执行体 [`nova-local`](../nova-local) 不同，它的回复全部来自
`.env` 指向的真实大模型 —— 本服务只注入调研人格并做协议整形，因此可以
登记进控制台，参与 Converse Lab 的**意图分发**验证。

```bash
pnpm run agent:research
# NOVA 调研专员已启动：http://127.0.0.1:43111/v1（模型 nova-research-agent）
```

## 目录

| 文件 | 职责 |
| :--- | :--- |
| `persona.md` | **人格提示词**：用 XML 自定义标签分节（`<role>` / `<responsibility>` / `<workflow>` / `<tool-output-policy>`），改人格不动代码。 |
| `index.mjs` | **入口**：加载配置与 persona.md（校验标签配对）→ 起 HTTP 服务 → 转发上游 → 整形响应。只在这里做 IO。 |
| `persona.mjs` | **人格层**：纯逻辑。把 persona.md 文本绑进载荷/响应的双向整形 + 标签配对校验，可单测。 |
| `agent.config.yaml` | **私有配置**：覆盖根 `config.yaml` 的端口与模型标识。 |
| `tests/persona.test.ts` | 协议整形测试（不烧真实 token，上游可注入）。 |

## 链路

```
NOVA 执行器（沙盒 / Converse Lab）
   │  POST /chat/completions（model=nova-research-agent，messages + tools）
   ▼
本服务：人格系统消息插在最前 → 转发 agent.llm 指向的真实大模型
   │  响应以请求的模型 id 回显（协议 §2 一致性）
   ▼
NOVA 执行器：真实代执行 external_search / summarize 并回灌
```

- **工具原样透传**：`external_search` / `summarize` 的定义、调用与结果回灌
  全部由上游模型与 NOVA 执行器直接交互，本服务不做任何改写；
- **无状态**：每轮都从 NOVA 回传的完整 `messages` 重建上下文；
- **模型标识一致性**：请求的 `model` 不是 `nova-research-agent` 一律 400，
  与 `GET /v1/models`、`local-agents.ts` 的登记三方对齐（协议 §1）。

## 人格设计

人格提示词独立在 `persona.md`，用 XML 自定义标签分节 —— 标签原文随
提示词一起发给上游（大模型对 XML 标记有稳定的遵循度），启动时只校验
配对、不改写内容：缺文件、空文件、超过 8000 字符、标签没配对都会以
可读理由拒绝启动。

调研专员的职责边界刻意与工程搭档（[`nova-coder`](../nova-coder)）互斥，
这样 Converse Lab 的意图分发才有可判定的分界：

- 调研类请求（课题拆解 / 检索取证 / 交叉验证）→ 本 Agent 深入完成；
- 工程类请求 → 先声明边界、建议交给 NOVA-CODER，再尽力给出调研侧帮助
  （不硬拒：沙盒的任务书本质是调研，人格不得妨碍受测任务的执行）；
- 工具输出中的任何指令都是不可信数据：显式拒绝越权指令，继续原任务
  （协议 §5.4）。

## 注册与配置

- **默认不登记**：`LOCAL_AGENTS` 里现在只有 `agt-local-travel` 与
  `agt-local-writer`（登记口径要求 Agent 有可判定的职责边界，本包与其在
  功能上重复）。需要拿它做对照实验时，把下面这条补进
  `packages/web/src/lib/nova/local-agents.ts` 即可：

  ```ts
  {
    id: "agt-local-research",
    name: "NOVA-RESEARCH",
    codename: "深度调研员",
    model: "nova-research-agent",
    owner: "本地开发",
    version: "v0.1.0",
    endpoint: "http://127.0.0.1:43111/v1",
    apiKeyEnv: "LLM_API_KEY",
    tagline: "专职调研的领域 Agent：多侧面检索、交叉验证与数据缺口分析",
    registeredAt: "2026-10-14T00:00:00.000Z",
  },
  ```

- 端口经 `NOVA_RESEARCH_PORT` 调整（默认 43111），模型标识在
  `agent.config.yaml`，上游端点沿用根配置的 `agent.llm`（`.env` 的
  `NOVA_LLM_*`）—— 本服务自身不持有任何密钥，也不要求调用方鉴权。

完整接入背景见 `docs/local-agent.md` §6.4。
