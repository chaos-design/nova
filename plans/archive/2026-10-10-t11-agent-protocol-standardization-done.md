# T11 · Agent 对接协议规范化与本地执行体完善

- **优先级**：P2　**领域**：对接口径与本地 Agent　**状态**：planned
- **证据**：
  - 对接契约散落在五处、无单一规范文档：`docs/local-agent.md` §1（协议纲要）、
    `packages/web/src/lib/nova/executors/tools.ts:38-83`（工具 Schema）、
    `executors/live.ts:49-81`（任务书与静态校验）、`api/agents/probe/route.ts:25-41`
    （探针安全规则）、`lib/nova/local-agents.ts:23-48`（登记字段）；
  - 陈旧漂移：`docs/local-agent.md:150`（「预置两条登记 SOLVER 与 STUB」，
    `LOCAL_AGENTS` 实际只剩 NOVA-LOCAL）、`:69`（端口 43111 叙述 vs 桩代码监听 11434）、
    `:182`、`:205`（SOLVER/STUB 残留）、`docs/architecture.md:129`（图注 STUB）；
  - `playground/nova-local/policy.mjs:212-254`：所有工具失败一律「按原检索式重试」，
    包括 `toolFailure`——执行器对该故障的文案已明示「请改用备用路径（summarize）」
    （`executors/tools.ts:211-217`），策略未区分可恢复故障与硬故障。

## 目标

1. 产出规范化协议文档 `docs/agent-protocol.md`（NOVA Agent 对接协议 v1）：
   端点契约、请求/响应 Schema、工具与任务书格式、五种混沌故障文案、SSE 事件联合、
   安全边界、登记规则；每条条款映射到代码位置（对应表），与
   `docs/nova-standard.md` 的评分口径互为引用、不重述。
2. 清理 docs ↔ code 全部已知漂移（SOLVER/STUB、端口、图注、路径）。
3. 完善 `playground/nova-local`：策略层增加**故障分诊**——可恢复故障
   （latency / rateLimit / malformedPayload）维持原检索式重试，硬故障
   （toolFailure）不再原地重试，改走备用路径（有素材先压缩、无素材开新侧面）；
   429 重试文案携带退避语义；登记版本随实现变更升 v1.1.0；补齐策略单测。

## 不做

- 不改评分口径（`verdict.ts` / `scoring.ts` / `chaos.ts` 代价表不动），
  因此无需同步 `docs/nova-standard.md` 第 8 节对应表；
- 不新增第二个 Local Agent（多端点注册表驱动属 [T10](../pending/02-real-backend.md)
  的待决范畴）；
- 不改 `/docs` 控制台页（`docs/sections.tsx`）的展示内容。

## 实施任务

- [ ] 写 `docs/agent-protocol.md`：协议 v1 全文 + 条款↔代码对应表
- [ ] `docs/local-agent.md`：§1 引协议文档；清 SOLVER/STUB/43111/11434 漂移（L69、L150、L182、L205）
- [ ] `docs/architecture.md:129`：图注 STUB → NOVA-LOCAL
- [ ] `AGENTS.md`：阅读顺序与 §6.7 指向协议文档
- [ ] `playground/nova-local/policy.mjs`：故障分诊 + 429 退避文案
- [ ] `playground/nova-local/tests/policy.test.ts`：分诊路径单测
- [ ] `packages/web/src/lib/nova/local-agents.ts`：NOVA-LOCAL 登记升 v1.1.0
- [ ] `plans/README.md`：任务索引登记 T11

## DoD

- [ ] `docs/agent-protocol.md` 每条条款可追溯到 `文件:行号`，不新增任何
      「指标」（评分口径一律指向 `docs/nova-standard.md`）；
- [ ] `grep -rn "SOLVER\|STUB" docs`（排除 archive 与 .workbuddy）无残留；
- [ ] `pnpm run check` 退出码 0；
- [ ] `pnpm run test`（含 nova-local 单测与 web 集成测试）全绿；
- [ ] `pnpm run test:e2e` 真实链路通过（probe → 沙盒运行 → `.nova/runs.json` +1）；
- [ ] status：本计划移入 `archive`，记录验证结果与回滚方式。

## 风险与回滚

- 策略改动只影响 nova-local 自身的可观测行为（重试次数、备用路径），
  不改执行器与评分；若沙盒分数因分诊行为变化，属口径内正常差异。
  回滚 = 还原 `policy.mjs` 与登记版本两处。
- 协议文档为新增文件，回滚 = 删文件 + 还原三处引用。

---

## 完成记录（2026-10-10）

- `docs/agent-protocol.md` 成稿（对接协议 v1.0，9 节）：端点契约、请求/响应 Schema、
  任务书与工具 Schema、五类混沌故障文案、SSE 事件联合、安全边界、登记规则、
  版本化流程；§9 维护条款↔代码对应表，评分口径一律指向 `docs/nova-standard.md`；
- 漂移清理：`docs/local-agent.md`（预置登记 SOLVER/STUB → NOVA-LOCAL、桩端口
  43111 → 11434、§6 链式表与行为清单加入故障分诊口径）、`docs/architecture.md:129`
  图注、`AGENTS.md`（阅读顺序 + 约束 §6 指向协议文档）、
  `api/sandbox/run/route.ts` 未登记 Agent 的提示文案；
- `policy.mjs` 故障分诊：新增导出 `isRecoverableFault()`（依据执行器故障回传文案
  判型，不靠猜）；`decide()` 区分可恢复故障（按原检索式重试一次，429 携带
  退避话术）与硬故障（熔断已打开不再原地重试：有素材走备用路径压缩交卷并标注
  单源风险，无素材取第一个未检索过的侧面开新检索）；
- `tests/policy.test.ts` 新增「故障分诊」5 例；nova-local 共 31 例通过；
- `local-agents.ts` NOVA-LOCAL 登记版本升 `v1.1.0`。
- 验证：`pnpm run check` 退出码 0；`pnpm run test` 全绿
  （nova-config 19 / nova-local 31 / web 40）；`pnpm run test:e2e` 真实链路
  success=true、score=99.5（18 步 · 4 次调用 · 注入 2 类 · 自愈 2 次 ·
  服从注入=false），`.nova/runs.json` 6 → 7，仪表盘渲染出真实运行记录。
- 回滚方式：还原 `policy.mjs` 与 `local-agents.ts` 登记版本两处；删除
  `docs/agent-protocol.md` 并还原 `local-agent.md` / `architecture.md` /
  `AGENTS.md` 三处引用。
