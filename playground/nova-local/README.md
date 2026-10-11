# NOVA-LOCAL

仓库自带的本地 Agent：零依赖、不需要任何模型服务，起一条命令就能被 NOVA
沙盒真实投放。

```bash
pnpm run agent:local          # 等价于 node playground/nova-local/index.mjs
# NOVA 本地 Agent 已启动：http://127.0.0.1:43110/v1（模型 nova-local-agent）
```

## 目录

| 文件 | 职责 |
| :--- | :--- |
| `index.mjs` | **入口**：加载配置 → 起 HTTP 服务 → 把请求交给策略层。只在这里做 IO。 |
| `policy.mjs` | **策略**：纯逻辑，无 IO、不读配置。给定对话历史产出下一步动作，因此可单测。 |
| `agent.config.yaml` | **私有配置**：深合并覆盖根 `config.yaml`，用于单独调这个 Agent。 |
| `package.json` | workspace 包 `@chaos-design/nova-local`：`start` 即 `node index.mjs`，测试/覆盖率入口。 |
| `README.md` | 本文件。 |

## 它怎么读配置

三层合并，后者覆盖前者：

```
项目根 config.yaml
  └── playground/nova-local/agent.config.yaml   （覆盖层，可选）
        └── 环境变量：进程环境 > 项目根 .env     （填充 ${VAR} 插值）
```

入口通过 `@chaos-design/config`（`packages/nova-config` 包）读取 —— 与控制台用的是**同一个加载器**，
所以两边的变量命名永远一致。敏感值（如 `NOVA_LLM_API_KEY`）只在 `.env`
或真实环境里存在，配置仓库里只留变量名。

改端口不必改代码：

```bash
NOVA_AGENT_PORT=4399 pnpm run agent:local
```

必填变量缺失时，入口会点名并退出（退出码 1），不会带着空值跑起来。
想提前自检：`pnpm run config:check`。

## 它不是按脚本回放的桩

- **无状态、可重放**：不保存会话，每轮都从 NOVA 回传的完整 `messages` 重建状态
- **决策来自观测**：读工具真实返回的 JSON（条数、字段、错误文案），
  据此决定重试 / 换检索式 / 压缩 / 交卷。
- **故障分诊**：可恢复故障（延迟 / 限流 / 畸形）按原检索式重试一次；
  硬故障（工具调用失败、熔断器已打开）按执行器的「备用路径」提示改走
  压缩或新侧面，不在熔断的检索式上打转；429 限流的重试话术带指数退避。
- **结论是真算出来的**：交叉比对两个结果集的字段集与声明条数，
  数据缺口由集合差算出，平均相关度由实际 `score` 求均值。
- **注入只拒绝、不服从**：识别越权指令后显式拒绝并继续原任务，
  永不发起 `export=all` 这类越权检索。

## 一次运行里的链路

| 轮次 | 行为 | 被观测到的计数 |
| :--- | :--- | :--- |
| 1 | 按任务书主题发起第一个侧面的 `external_search` | `distinctQueries +1` |
| 2 | 可恢复故障按原检索式重试；硬故障（熔断）改走备用路径；否则开第二个侧面 | `recoveries +1`（判为自愈） |
| 3 | 用 `summarize` 压缩两个来源的记录 | `summarizeCalls +1` |
| 4 | 输出交叉比对结论（含真实数据缺口）并交卷 | `finished = true` |

这四个计数就是四大能力向量得分的来源，口径见 `docs/nova-standard.md` §3.5。

## 协议

对外只暴露两个 OpenAI 兼容路由：

| 能力 | 路由 |
| :--- | :--- |
| 模型清单 | `GET /v1/models` → `{ "data": [{ "id": "nova-local-agent" }] }` |
| 对话补全 | `POST /v1/chat/completions`，支持 `tools` / `tool_choice` |

`model` 必须与 `/v1/models` 返回的 id 一致，否则沙盒投放会报协议不匹配。

## 注册到 NOVA

已登记在 `packages/web/src/lib/nova/local-agents.ts` 的 `LOCAL_AGENTS`（`agt-local-nova`）。
跑完一次沙盒验证后，它才会拿到真实评分、进入排行榜与能力矩阵。

## 基于它写自己的 Agent

1. 复制整个 `playground/nova-local/` 为 `playground/<your-agent>/`
   （目录名即 Agent 名，写进根 `config.yaml` 的 `agent.name`）；
2. 改 `policy.mjs` 里的决策逻辑（其余 IO / 配置部分不用动）；
3. 在 `local-agents.ts` 追加一条登记，`model` 与 `agent.config.yaml` 的一致。

完整接入步骤见 `docs/local-agent.md`。
