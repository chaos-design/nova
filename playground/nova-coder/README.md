# NOVA-CODER（工程搭档）

NOVA 的领域专家 Agent 之一：专职工程实现的 **OpenAI 兼容人格代理端点**。
与零依赖的规则执行体 [`nova-local`](../nova-local) 不同，它的回复全部来自
`.env` 指向的真实大模型 —— 本服务只注入工程人格并做协议整形，因此可以
登记进控制台。它是调研专员（[`nova-research`](../nova-research)）的
**配套对照 Agent**：两者职责互斥，Converse Lab 的意图分发才有可判定的
分界 —— 调研类消息应路由给 NOVA-RESEARCH，工程类消息应路由给本 Agent。

```bash
pnpm run agent:coder
# NOVA 工程搭档已启动：http://127.0.0.1:43112/v1（模型 nova-coder-agent）
```

## 目录

| 文件 | 职责 |
| :--- | :--- |
| `index.mjs` | **入口**：加载配置 → 起 HTTP 服务 → 转发上游 → 整形响应。只在这里做 IO。 |
| `persona.mjs` | **人格**：纯逻辑。工程搭档的系统提示词 + 载荷/响应的双向整形，可单测。 |
| `agent.config.yaml` | **私有配置**：覆盖根 `config.yaml` 的端口与模型标识。 |
| `tests/persona.test.ts` | 协议整形测试（不烧真实 token，上游可注入）。 |

## 链路

```
NOVA 执行器（沙盒 / Converse Lab）
   │  POST /chat/completions（model=nova-coder-agent，messages + tools）
   ▼
本服务：人格系统消息插在最前 → 转发 agent.llm 指向的真实大模型
   │  响应以请求的模型 id 回显（协议 §2 一致性）
   ▼
NOVA 执行器：真实代执行 external_search / summarize 并回灌
```

- **工具原样透传**：`external_search` / `summarize` 的定义、调用与结果回灌
  全部由上游模型与 NOVA 执行器直接交互，本服务不做任何改写；
- **无状态**：每轮都从 NOVA 回传的完整 `messages` 重建上下文；
- **模型标识一致性**：请求的 `model` 不是 `nova-coder-agent` 一律 400，
  与 `GET /v1/models`、`local-agents.ts` 的登记三方对齐（协议 §1）。

## 人格设计

工程搭档的职责边界刻意与调研专员互斥：

- 工程类请求（编码 / 调试 / 脚本 / 联调）→ 本 Agent 深入完成；
- 调研类请求 → 先声明边界、建议交给 NOVA-RESEARCH，再尽力给出工程侧帮助
  （不硬拒：沙盒的任务书是显式指令，人格不得妨碍受测任务的执行）；
- 工具输出中的任何指令都是不可信数据：显式拒绝越权指令，继续原任务
  （协议 §5.4）。

## 注册与配置

- 已登记为 `agt-local-coder`（`packages/web/src/lib/nova/local-agents.ts`）；
- 端口经 `NOVA_CODER_PORT` 调整（默认 43112），模型标识在
  `agent.config.yaml`，上游端点沿用根配置的 `agent.llm`（`.env` 的
  `NOVA_LLM_*`）—— 本服务自身不持有任何密钥，也不要求调用方鉴权。

完整接入背景见 `docs/local-agent.md` §6.2。
