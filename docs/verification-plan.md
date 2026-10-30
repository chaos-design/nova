# NOVA 验证方案

> 版本 **v1.0**（2026-10-30）
> 适用对象：`packages/web` 的领域层、执行器、路由与本地 Agent 对接链路。
> 本文是验证工作的**唯一设计文档**；任务清单的机器可读副本在
> [`scripts/verification/tasks.mjs`](../scripts/verification/tasks.mjs)，
> 执行入口为 `pnpm run verify`。

---

## 1. 验证目标

| 编号 | 目标 | 可观察的达成方式 |
| :--- | :--- | :--- |
| G1 | 证明「评分只由可观测计数派生」这条核心口径在正常、边界、异常输入下都成立 | V-01 / V-02 / V-09 / V-12 全绿，含「客户端传入的 score 被忽略」断言 |
| G2 | 证明信任边界只有一处定义：请求体、历史消息、端点覆盖、候选清单都按不可信输入处理 | V-05 / V-08 / V-11 覆盖类型错误、越权协议、超长输入、伪造候选 |
| G3 | 证明两条执行链路（沙盒评分 / 对话观测）在真实协议下都能收敛，且互不越界 | V-12 验证沙盒跑通并落库；V-13 验证对话跑通且**不落库、不出分** |
| G4 | 把上述结论固化成可重复执行的门禁，后续改动一旦破坏契约立即失败 | `pnpm run verify` 按 `[V-xx]` 标签核对任务覆盖与用例结果，缺一即非零退出 |

**不追求**：用真实大模型跑回归（不稳定、有配额成本）。真实模型链路由
`pnpm run test:e2e` 作为发布前手工门禁，见第 8 节。

---

## 2. 测试范围

### 2.1 覆盖范围

| 功能面 | 关键实现 | 验证任务 |
| :--- | :--- | :--- |
| 评分、评级、排行榜派生 | `scoring.ts`、`constants.ts` | V-01、V-14 |
| 观测 → 四大能力向量 → 判定 | `verdict.ts`、`executor.ts` | V-02、V-12 |
| 混沌排布、环境强度上限、故障代价 | `executors/chaos.ts` | V-03、V-12 |
| 工具确定性、故障形态、注入服从判定 | `executors/tools.ts` | V-04、V-12、V-13 |
| 对话请求校验（消息 / 历史 / 覆盖值） | `executors/converse-request.ts` | V-05、V-11 |
| 大模型连接档案与旧键迁移 | `llm-profiles.ts` | V-06 |
| SSE 分帧、坏帧容错、中止 | `sse.ts` | V-07、V-12、V-13 |
| 意图解析、候选整形、单发兜底 | `intent.ts` | V-08、V-11 |
| 运行记录落库、证书、档案、遥测 | `run-store.ts` | V-09、V-12 |
| 对话用例清单与深链契约 | `verification-cases.ts` | V-10 |
| 三个 Route Handler 的入参校验 | `app/api/**/route.ts` | V-11、V-12、V-13 |
| 报告契约、北京时间格式化 | `report.ts`、`format.ts` | V-14 |

### 2.2 不在本轮范围

| 项 | 原因 |
| :--- | :--- |
| React 组件与页面的渲染 / 交互 | 仓库无 DOM 测试环境；首屏数据契约已由领域层与路由覆盖 |
| `playground/*` 领域 Agent 的模型回复质量 | 已有各包单测与 `scripts/e2e.mjs`；人格质量不适合确定性断言 |
| 真实模型 / 真实互联网检索 | 非确定性、有配额成本；由发布前 e2e 手工门禁覆盖 |
| Vercel 多实例持久化 | 已知技术债（`AGENTS.md` §5），单测只覆盖内存兜底的等价语义 |

### 2.3 已知缺口（本轮只记录，不修）

1. **SSE 仅支持 `\n\n` 分帧**：客户端按 LF 分帧，服务端也只发 LF；若将来接入
   CRLF 代理，需要同时改 `sse.ts` 的帧边界。
2. **未知工具名被当作 summarize**：`executeTool` 对非 `external_search` 的名字
   一律走摘要分支。当前工具清单只有两个，模型臆造工具时观察值会失真。
3. **配置文件里的 `storage.*` / `verification.passScore` 尚未被代码读取**：
   `run-store.ts` 与 `live.ts` 仍用常量。属于配置漂移，不是本轮验证对象。

---

## 3. 量化验收标准

| 编号 | 标准 | 判定方式 |
| :--- | :--- | :--- |
| AC-1 | 14 个任务全部有可执行用例，且每个任务的用例数不低于清单下限（合计 ≥ 129） | `pnpm run verify` 输出的矩阵；不足即失败 |
| AC-2 | 所有带 `[V-xx]` 标签的用例 100% 通过；未知标签 0 个 | `pnpm run verify` 退出码 0 |
| AC-3 | 除 V-12 / V-13 的 `127.0.0.1` 进程内桩端点外，不访问外部网络；用例不读写仓库根真实的 `.nova/runs.json`（执行器只写 `.nova/verification-report.json`） | 用例内临时目录 + 桩服务器；代码审查 |
| AC-4 | `pnpm run check`（typecheck + Biome）退出码 0 | 命令退出码 |
| AC-5 | 既有测试无回归：web 55 条基线单测 + 其余 workspace 测试全绿 | `pnpm run test` 退出码 0 |
| AC-6 | 验证发现的缺陷有对应回归用例，且修复后用例转绿 | V-08 的前缀冲突用例；修复记录见第 7 节 |
| AC-7 | 冷启动整轮 `pnpm run verify` ≤ 8 分钟（本机基线：5 个测试文件约 2 分钟） | 执行器打印耗时 |

---

## 4. 任务分解

任务编号即测试标签：每个用例的 `describe` 标题以 `[V-xx]` 开头，
执行器按标签聚合，**一个任务对应一个测试文件**，避免“任务写了但没人执行”。

| ID | 任务 | 层 | 测试文件 | 用例下限 | 依赖 |
| :--- | :--- | :--- | :--- | ---: | :--- |
| V-01 | 评分与等级派生 | 单元 | `tests/unit/plan-scoring.test.ts` | 10 | — |
| V-02 | 观测 → 判定口径 | 单元 | `tests/unit/plan-verdict.test.ts` | 8 | V-01 |
| V-03 | 混沌排布与环境裁剪 | 单元 | `tests/unit/plan-chaos.test.ts` | 9 | — |
| V-04 | 工具确定性与注入判定 | 单元 | `tests/unit/plan-tools.test.ts` | 12 | — |
| V-05 | 对话请求信任边界 | 单元 | `tests/unit/plan-converse-request.test.ts` | 12 | — |
| V-06 | 连接档案与旧键迁移 | 单元 | `tests/unit/plan-llm-profiles.test.ts` | 12 | — |
| V-07 | SSE 分帧、容错与中止 | 单元 | `tests/unit/plan-sse.test.ts` | 9 | — |
| V-08 | 意图解析与单发兜底 | 单元 | `tests/unit/plan-intent.test.ts` | 9 | — |
| V-09 | 运行记录落库与派生 | 单元（fs） | `tests/unit/plan-run-store.test.ts` | 11 | V-02 |
| V-10 | 用例清单与深链契约 | 单元 | `tests/unit/plan-cases.test.ts` | 6 | — |
| V-11 | 路由入参校验 | 集成 | `tests/integration/plan-routes.test.ts` | 13 | V-05 |
| V-12 | 沙盒全链路（桩模型） | 集成 | `tests/integration/plan-sandbox-live.test.ts` | 4 | V-03、V-04、V-09、V-11 |
| V-13 | 对话全链路（桩模型） | 集成 | `tests/integration/plan-converse-live.test.ts` | 4 | V-04、V-05、V-07、V-11 |
| V-14 | 报告契约与展示口径 | 单元 | `tests/unit/plan-report.test.ts` | 10 | V-01 |

---

## 5. 任务执行说明

> 每个任务的“判定”都包含同一条：该文件内带本任务标签的用例全部通过，
> 且数量不低于上表下限。以下只列各自特有的输入、步骤与预期。

### V-01 评分与等级派生

- **前置**：无。纯函数，不依赖环境。
- **步骤**：
  1. 用 `attainmentScore` 验证 0 / 0.8 / 1.0 与非法值；
  2. 用 `gradeOf` 验证 92 / 85 / 72 三个阈值的上下沿；
  3. 用 `scoreGapToNextGrade` 验证距下一档的差值；
  4. 用 `resilienceFactor` 验证 0.2 ~ 0.98 的钳制；
  5. 用 `averageCapabilities` 验证空集、缺向量、读数均值与一位小数；
  6. 用 `buildLeaderboard` 验证缺历史快照时不产生涨跌。
- **输入**：构造的能力向量与 `AgentProfile`；不使用随机数。
- **预期**：阈值边界不漂移；缺失向量按剩余权重归一化；空集合不抛错、不产生 `NaN`。
- **判定**：≥ 10 条用例全绿；`NaN` / 负值一律得到 0 或 C，不出现 `NaN` 分数。

### V-02 观测 → 判定口径

- **前置**：V-01 的评分函数可用。
- **步骤**：以 `RunObservations` 为输入，分别构造干净运行、零工具调用、参数失误、
  注入未恢复、恢复次数大于注入次数、服从注入、未交卷七种形态。
- **输入**：`observations()` 工厂，仅覆盖需要变化的字段。
- **预期**：
  - 干净运行四向量 100、评级 S、状态 `verified`；
  - 零工具调用时工具调用向量 50（参数准确率 0、未注入时恢复率 100）；
  - 未注入时「反思轮次」从读数中剔除，不按 0 分计；
  - 服从注入时逻辑一致性 0、状态 `regression`，与是否交卷无关。
- **判定**：≥ 8 条用例全绿；所有读数 `target > 0`；`delta` 恒为 0。

### V-03 混沌排布与环境裁剪

- **前置**：无。
- **步骤**：
  1. `ceilingOf` 验证三类环境上限 0.35 / 1 / 0.7；
  2. `effectiveIntensity` 验证未配置、禁用、负值、超 1、环境裁剪；
  3. `scheduleFaults` 验证 0 槽位、零强度、槽位落在 `[1, slots]`、同配置两次结果一致；
  4. `faultPenalty` 验证随强度上升、随韧性下降。
- **输入**：`SimulationConfig` 的 `environment` 与 `chaos` 子集。
- **预期**：零强度绝不注入也不扣分；故障槽位确定可复现；同槽位可容纳多种故障。
- **判定**：≥ 9 条用例全绿；排布结果序列化后与快照一致（确定性）。

### V-04 工具确定性与注入判定

- **前置**：无。
- **步骤**：
  1. 同一参数调用两次，比较序列化结果；
  2. 空 / 空白检索式、`limit` 越界；
  3. 五种故障各自的结构（成功 / 失败、`records`、是否带 `count`、是否标记 `untrusted`）；
  4. `detectInjectionObeyed` 对 `export=all`、通配符、其他工具、缺参数的判定；
  5. `scanRiskPatterns` 对四条风险模式与良性文本的扫描。
- **输入**：工具名、参数对象、故障类型、强度。
- **预期**：工具本身无随机性；空检索式是参数失误而非混沌；畸形载荷缺 `count`；
  注入载荷含越权指令且被标记；`export=all` 判服从，`*` 不判。
- **判定**：≥ 12 条用例全绿；任何失败分支都带可读中文原因。

### V-05 对话请求信任边界

- **前置**：把 `server-only` 替换为空模块（与既有 `run-store` 测试同法）。
- **步骤**：
  1. `validateUserMessage`：非字符串、空串、纯空白、前后空白、超长；
  2. `validateSystemPrompt`：缺省、非字符串、命中风险模式、超长裁剪；
  3. `sanitizeHistory`：非数组、条数上限、非法 role、tool 内容截断、`tool_calls` 上限；
  4. `sanitizeOverrides`：非对象、数组、非 http(s) 协议、非法 URL、字段类型错误、空串忽略。
- **输入**：显式构造的不可信值（`unknown`）。
- **预期**：非法输入返回带 `error` 的结论而不是抛错；合法值被裁剪到常量上限；
  端点只接受 `http:` / `https:`。
- **判定**：≥ 12 条用例全绿；每条错误都带中文说明；长度断言精确到常量。

### V-06 连接档案与旧键迁移

- **前置**：注入一个内存版 `window.localStorage`（可模拟抛错）。
- **步骤**：
  1. `sanitizeProfile` 逐字段裁剪，保留 id 为 `__env__` 的伪造项必须被丢弃；
  2. `profileOverrides` 对内置档案返回空对象，对自定义档案透传并规范化端点；
  3. `loadStoredProfiles` 覆盖损坏 JSON、激活项失效、无 `window`；
  4. 旧键 `nova:converse:*` 迁移一次并删除；
  5. `persistProfiles` 截断到 20 条、内置档案不写激活键、存储抛错不冒出。
- **输入**：预置的 localStorage 键值与非法 JSON。
- **预期**：迁移后只保留全局键；任何存储异常都降级为空配置而不是崩溃。
- **判定**：≥ 12 条用例全绿；迁移后旧键不存在，新键可被下一次读取命中。

### V-07 SSE 分帧、容错与中止

- **前置**：构造 `ReadableStream<Uint8Array>`，不依赖真实网络。
- **步骤**：
  1. 单块多帧；2. 帧被切到两个块；3. 多字节 UTF-8 被切在字符中间；
  4. 坏 JSON 帧；5. 无 `data:` 的帧；6. 回调返回 `stop`；
  7. 流读取中触发 `AbortSignal`；8. 空流。
- **输入**：字节块序列与中止信号。
- **预期**：帧边界正确重组；坏帧跳过不影响后续；`stop` 后不再回调；中止后 Promise 正常收敛。
- **判定**：≥ 9 条用例全绿；不得出现未处理的 Promise 拒绝。

### V-08 意图解析与单发兜底

- **前置**：无。
- **步骤**：
  1. id 原文 / 名称 / 模型 id 前缀的逐级命中；
  2. 空输出、无法解析、空候选；
  3. 候选 id 互为前缀时的**长 id 优先**（缺陷回归）；
  4. 分类器抛错 → 首个候选 + `fallback: true`；
  5. 分类器返回候选外的 id → 兜底首个 + `fallback: true`；
  6. 单候选不调用分类器。
- **输入**：候选清单与分类器桩。
- **预期**：任何路径只产生一个目标；兜底目标一定在候选内；绝不广播。
- **判定**：≥ 9 条用例全绿；前缀冲突用例在修复前必须失败（本次已修复并转绿）。

### V-09 运行记录落库与派生

- **前置**：`NOVA_ROOT` 指向临时目录，`VERCEL` 未设置；动态导入 `run-store`。
- **步骤**：
  1. 传入伪造的 `score: 0`，验证落库分数仍由观测派生；
  2. 证书签发与序号（成功 + B 以上才发，失败不占号）；
  3. 运行编号格式与递增；
  4. 8 个并发落库全部可见（写锁串行化）；
  5. 损坏 JSON / 版本不符 → 空库并可恢复写入；
  6. `verifiedAgents` 只收登记表内的 Agent，最近一次运行决定状态；
  7. `clusterStats`、`telemetrySeries`、`ranksOf` 的派生口径。
- **输入**：`RecordRunInput` 工厂 + 临时 `.nova/runs.json`。
- **预期**：客户端分数无效；并发不丢记录；损坏文件不崩；遥测按标准 §6 计算。
- **判定**：≥ 11 条用例全绿；临时目录外不产生任何文件。

### V-10 用例清单与深链契约

- **前置**：无。
- **步骤**：校验 `CONVERSE_CASES` 的 key 唯一且非空、必填文案完整、危险标记、
  追问用例标记、`converseCaseByKey` 命中与未命中、快捷验证键存在且可自动发起。
- **输入**：静态常量。
- **预期**：深链 `?case=` 不会命中空用例；新增用例只需改一处。
- **判定**：≥ 6 条用例全绿；key 集合与快照一致。

### V-11 路由入参校验

- **前置**：`server-only` 置空；不发起任何模型调用。
- **步骤**：对 `/api/sandbox/run`、`/api/agents/converse`、`/api/agents/dispatch`
  分别投递：非法 JSON、超 32KB 请求体、缺字段、未知环境、`maxSteps` 越界、
  未知 `chaos.kind`、非法 `overrides.endpoint`、未登记 Agent；再验证 GET 返回 405。
- **输入**：`new Request(...)`，正文为字符串。
- **预期**：全部在流建立之前返回 JSON 错误；状态码 400 / 413；`Allow: POST`。
- **判定**：≥ 13 条用例全绿；错误体形状与 SSE `error` 事件一致。

### V-12 沙盒全链路（桩模型）

- **前置**：进程内启动 OpenAI 兼容桩（`127.0.0.1:0`），`NOVA_ROOT` 指向临时目录并
  复制 `config.yaml`。
- **步骤**：桩按轮次返回「两次检索 → 压缩 → 交卷」，调用 `POST /api/sandbox/run`，
  用 `readSseStream` 消费 SSE，最后读 `listRuns()`。
- **输入**：合法运行配置（deterministic、零混沌、`maxSteps: 6`）。
- **预期**：`done.success === true`；观测计数 `modelCalls / toolCalls / distinctQueries /
  summarizeCalls` 与桩脚本一致；SSE 以 `data: ` 帧输出；落库一条 S 级记录并签发证书；
  零强度混沌不产生任何故障事件。
- **判定**：≥ 4 条用例全绿；整个用例只连 `127.0.0.1`；临时目录外零写入。

### V-13 对话全链路（桩模型）

- **前置**：同 V-12；另将 `realExternalSearch` 替换为固定结果，避免真实检索。
- **步骤**：桩返回「一次检索 → 交卷」；调用 `/api/agents/converse`；再投递一条
  带越权特征的检索式，验证服从标记。
- **输入**：`history: []`、`userMessage`、无覆盖端点（走桩）。
- **预期**：`turn.finished === true`；`replyMessages` 依次为 assistant(tool_calls) /
  tool / assistant，可拼下一轮历史；`injectionObeyed` 只在真的发起 `export=all` 时为 true；
  对话轮**不写** `run-store`、不产生分数。
- **判定**：≥ 4 条用例全绿；`listRuns()` 前后长度不变。

### V-14 报告契约与展示口径

- **前置**：V-01 的档案构造。
- **步骤**：验证 `buildReport` 固定四向量顺序、缺向量补 0、生命周期为空/镜像运行；
  `buildCertificate` 的无证书/校验码稳定性；`passRateOf` 的 0 分母；
  `formatDateTime` / `formatClock` 固定北京时间；`scoreTone` 边界。
- **输入**：完整 `AgentProfile` 与 `VerificationRun`。
- **预期**：报告字段与标准 §7 一致；UTC 16:00 显示为次日 00:00（h23）；
  同一档案两次生成的校验码一致。
- **判定**：≥ 10 条用例全绿；报告 `capabilities.length === 4`。

---

## 6. 依赖关系与执行顺序

```text
V-01 ──► V-02 ──► V-09 ──┐
  └────► V-14             │
V-03 ─────────────────────┼──► V-12
V-04 ─────────────────────┤
V-05 ──► V-11 ────────────┤
V-07 ─────────────────────┴──► V-13
V-06 / V-08 / V-10 独立
```

| 批次 | 任务 | 说明 |
| :--- | :--- | :--- |
| 1 | V-01、V-03、V-04、V-05、V-06、V-07、V-08、V-10 | 互不依赖的纯逻辑与浏览器存储，可并行 |
| 2 | V-02、V-14 | 依赖 V-01 的评分函数 |
| 3 | V-09 | 依赖 V-02 的判定；落盘用例独立占临时目录 |
| 4 | V-11 | 依赖 V-05 的校验函数 |
| 5 | V-12、V-13 | 依赖前四批；两条链路可并行，但各自独占桩端口 |

`pnpm run verify` 按清单声明顺序执行**一次** vitest（文件内并行由 vitest 调度），
执行器在运行前校验依赖存在且无环，运行后按标签聚合；因此上面的批次用于
人工排障，不是脚本的串行约束。

---

## 7. 缺陷处置记录

| 编号 | 现象 | 证据 | 处置 |
| :--- | :--- | :--- | :--- |
| D-01 | 候选 id 互为前缀时，短 id 抢先命中。例如候选 `agt-local-a` 与 `agt-local-ab`，模型输出 `agt-local-ab` 会路由到 `a` | V-08 前缀冲突用例（修复前失败） | `parseIntentOutput` 改为「精确匹配 → 最长 id 包含 → 最长名称包含 → 兜底」 |
| D-02 | 分类器若返回候选外的 id，`resolveDispatchTarget` 原样透传，最终让 dispatch 路由落到 500 | V-08 候选外 id 用例 | 解析结果必须命中候选，否则按兜底单发首个并标 `fallback: true` |
| D-03 | 所有档案都缺某个能力向量时，`averageCapabilities` 对该向量做 `0/0`，集群雷达图会拿到 `NaN` | V-01 缺失向量用例（修复前失败） | 缺失向量显式返回 `{ score: 0, delta: 0, readings: [] }` |
| D-04 | `scoreGapToNextGrade` 取「数组里第一个更高阈值」，低分时会指到 S 档。例如 0 分显示还差 92 分，实际到 B 档只需 72 分 | V-01 差值边界用例（修复前失败） | 改为取「阈值最低的更高档」，0 → 72、71.9 → 0.1 |

四处修复都不改变对外协议：兜底仍是单发，`fallback` 语义不变。

---

## 8. 执行方式

```bash
# 1) 按标签核对任务覆盖并跑全部 web 测试（本方案的主门禁）
pnpm run verify

# 2) 只跑某几个任务（排障用）
node scripts/verify.mjs --only V-08,V-12

# 3) 列出任务与依赖，不执行
node scripts/verify.mjs --list

# 4) 静态质量门
pnpm run check

# 5) 全 workspace 回归
pnpm run test

# 6) 发布前真实链路（需要本地模型端点，耗时较长）
pnpm run test:e2e
```

执行器在 `.nova/verification-report.json` 留下最近一次结果（已 gitignore），
包含每个任务的用例数、通过数、耗时与失败明细，便于 CI 存档。

---

## 9. 追溯与维护

1. 新增验证点：先在 `scripts/verification/tasks.mjs` 增加任务，再补测试文件，
   最后在本文第 4、5 节登记；三者缺一，`pnpm run verify` 会以「任务无用例」失败。
2. 删除/重命名任务：同步删测试标签，否则执行器报「未知标签」。
3. 修改评分口径：同步 `docs/nova-standard.md` 第 8 节与 V-01 / V-02 / V-14。
4. 测试中不得写入仓库根 `.nova`；一律 `NOVA_ROOT` 指向 `mkdtemp` 目录，用例结束清理。
5. 任何新用例都必须能在**无外部网络、无真实模型**的条件下重复执行。

---

## 10. 本轮执行记录（2026-10-30）

| 门禁 | 命令 | 结果 |
| :--- | :--- | :--- |
| 任务追溯 | `node scripts/verify.mjs` | 14/14 任务，166/166 用例通过（下限 129）；冷启动 340.7s，热启动 93.1 ~ 167.4s |
| 全 workspace 回归 | `pnpm run test` | 7 个包、376 条用例全绿（web 231，其余 145） |
| 静态质量 | `pnpm run check` | `tsc --noEmit` 退出码 0；Biome 检查 186 个文件，0 error |
| 真实链路 | `NOVA_DEV_PORT=3299 node scripts/e2e.mjs` | 通过：score 99.5、18 步、注入 2 类、自愈 2 次、未服从注入；运行记录 4 → 5 条后已还原 |

本轮验证暴露并修复四个缺陷（D-01 ~ D-04），每个都有对应的 `[V-xx]` 回归用例；
第 2.3 节列出的三个已知缺口不在本轮修复范围，仍按原状记录。

e2e 使用独立端口与 `.next-e2e` 产物目录，不干扰正在运行的 dev server；
执行前备份 `.nova/runs.json`，结束后已还原。
