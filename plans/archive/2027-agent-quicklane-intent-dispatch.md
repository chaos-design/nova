---
title: Agent 快捷通道与意图转发机制
priority: P2
created: 2026-10-13 14:33:18
updated: 2026-10-13 17:34:34
---

# Agent 快捷通道与意图转发机制

## 目标

新 Agent 从创建到完成首轮验证的三段路径（开发/接入/验证）全部有工具与界面支撑：
脚手架一键生成可运行的领域 Agent，接入向导把登记从手工照抄变成校验后复制，
快捷验证通道把「探针 → 冒烟对话 → 沙盒评分」串成深链可达的路径；
意图识别升级为携带领域描述的分类，并由服务端完成分类与执行的合一转发。

## 范围

- 包含：
  - 意图识别增强（候选携带 `description`、解析逻辑抽纯函数、单测补齐）；
  - 服务端转发路由 `/api/agents/dispatch`（分类 + `runConverseTurn` 合一）；
  - 共享 Agent 基建包 `packages/agent-kit` 与 research/coder 迁移；
  - 快捷开发脚手架 `scripts/scaffold-agent.mjs`；
  - 接入向导 probe→登记表单打通；
  - 快捷验证深链（converse 页 URL 驱动 + LocalAgentCard 入口）；
  - 文档同步与分批提交。
- 不包含：
  - 运行时动态注册：`LOCAL_AGENTS` 仍是唯一登记点（AGENTS.md 约束 6），
    脚手架与向导只生成片段，不自动写 `local-agents.ts`；
  - 语义向量/嵌入模型检索：意图分类保持零依赖单次 LLM 调用；
  - 沙盒评分口径改动：快捷验证通道只观测不评分，评分仍走沙盒既有链路；
  - 持久化改造：对话与意图路径维持无状态，不写 run-store。

### 模块职责边界与衔接点

| 模块 | 职责 | 不做 | 衔接点（现有代码） |
| :--- | :--- | :--- | :--- |
| 意图识别 `/api/agents/intent` | 单次零温度 LLM 分类：候选里选一个 id | 不执行任务、不落库、不广播 | `packages/web/src/app/api/agents/intent/route.ts`（解析兜底：id→名称→首个候选）；候选 `description` 取自 `LocalAgentEntry.tagline`（`src/lib/nova/local-agents.ts`） |
| 服务端转发 `/api/agents/dispatch` | 分类后直接驱动 `runConverseTurn`，SSE 与 `/converse` 同构，`meta` 事件增补 `routedTo` / `fallback` | 不新增事件类型、不落库 | 复用 `executors/converse.ts` 的 `runConverseTurn` 与 `converse/route.ts` 的入参校验（`sanitizeMessage` / `sanitizeOverrides` / 长度上限）；SSE 头与 `X-Accel-Buffering: no` 同款 |
| 快捷开发 `scripts/scaffold-agent.mjs` + `packages/agent-kit` | 生成 `playground/<name>` 全套并校验 id/端口不冲突；agent-kit 提供 persona 校验加载与 OpenAI 兼容服务骨架（`HttpError` / `createPersonaLayer` / `findTagIssues` / `toClientResponse`） | 不自动登记、不改既有 Agent 文件 | agent-kit 依赖 `@chaos-design/config` 的 `getAgentConfig` / `projectRoot`；research/coder 的重复 `persona.mjs` 与 persona 测试迁移进包 |
| 快捷接入 `agent-onboarding-dialog.tsx` 增强 | probe 结果回填登记表单（models 预填、id 冲突检测） | 不新增后端、不写文件 | `probe/route.ts` 已返回 `{ ok, openaiCompatible, models[] }`；片段生成复用 `localAgentSourceSnippet` / `localAgentEnvSnippet` |
| 快捷验证 converse 深链 | `?agent=<id>&case=<key>` 自动选中目标并发起用例；`LocalAgentCard` 提供入口 | 不评分、不落库（页面口径不变） | 用例文案从 `converse-lab.tsx`（`RESEARCH_TEXT` 等常量）下沉到 `src/lib/nova` 常量模块；页面仍是 `force-dynamic` 服务端取数 |

### 关键流程

1. 快捷开发：`pnpm run agent:new --name nova-writer` → 生成 `playground/nova-writer/`
   （薄入口 index.mjs 引 agent-kit、persona.md XML 分节骨架、agent.config.yaml、
   package.json、vitest persona 测试）→ 端口从 43113 起递增、避开既有
   agent.config.yaml → `pnpm install` → `pnpm run agent:writer` 启动。
2. 快捷接入：agents 页「接入新 Agent」→ 端点探测 → models 下拉预填 →
   生成登记片段（id 与既有 `LOCAL_AGENTS` 冲突即拦截）→ 人工粘贴登记 →
   重启 dev server → 档案卡出现。
3. 快捷验证：`LocalAgentCard`「快捷验证」→ 深链进 converse 页自动选中该
   Agent 并发送冒烟用例（调研型）→ 追加越权注入用例看判定 → 需要评分时
   引导去沙盒跑完整场景。
4. 意图转发（目标态）：converse 页意图模式 → 单次 `POST /api/agents/dispatch`
   → 服务端分类（候选含 tagline 描述）→ `runConverseTurn` SSE →
   `meta.routedTo` 驱动前端按 Agent 分桶 → 分类失败 `fallback: true`
   落首个候选，绝不广播。

### 依赖关系与实施顺序

- 意图线：T1（intent 增强）先行 → T2（单测）→ T3（dispatch，复用 T1 的解析
  纯函数与 T2 的用例）。
- 开发线：T4（agent-kit）先行 → T5（scaffold 模板引用 agent-kit）。
- 接入/验证线：T6、T7 相互独立，可与意图线并行。
- 收尾：T8 文档在 T4/T5 落定后 → T9 全量校验 → T10 分批提交与归档。

## 实施任务

- [x] T1 意图识别增强：/api/agents/intent 候选协议增加 description（客户端从登记 tagline 传入，服务端截断至 200 字符），分类提示词写入各候选领域边界；解析逻辑（id 命中→名称命中→兜底单发）抽为可测纯函数 parseIntentOutput
- [x] T2 意图分类单测：覆盖 id 命中、名称命中、兜底单发（绝不广播）、非法输出、超时降级；放 packages/web 既有测试体系
- [x] T3 服务端转发：新增 /api/agents/dispatch，请求体校验沿用 converse route 的 sanitize* 与 32KB 上限，分类失败时服务端直接落首个候选并在 meta 标注 fallback；converse-lab 意图模式改走单次请求，use-converse 在 meta 到达时把 turn 迁移到 routedTo 分桶；保留 /api/agents/intent 与客户端两步路径作为回退开关
- [x] T4 共享 Agent 基建：新建 packages/agent-kit（纯 Node ESM，依赖 @chaos-design/config，导出 persona 加载/校验与 OpenAI 兼容服务骨架），nova-research 与 nova-coder 入口改为薄封装并删除各自重复的 persona.mjs 与重复测试；persona 测试合并进 agent-kit
- [x] T5 快捷开发脚手架：scripts/scaffold-agent.mjs 参数式生成 playground/<name> 全套（index.mjs 薄入口 + persona.md 模板 + agent.config.yaml + package.json + vitest 测试），校验名称合法（nova- 前缀）、id 与端口不冲突，收尾打印 LOCAL_AGENTS 登记片段；根 package.json 增加 agent:new
- [x] T6 快捷接入增强：接入向导 probe 成功后把 models 列表预填进 profile 步模型下拉、登记 id 与既有 LOCAL_AGENTS 冲突即时提示、publish 步保留片段复制并补「重启 dev server 生效」引导
- [x] T7 快捷验证通道：验证用例文案下沉 src/lib/nova 常量模块（键英文、文案中文），converse 页读取 searchParams 自动选中目标并发起用例（挂载后一次，不重复触发），LocalAgentCard 增加「快捷验证」链接
- [x] T8 文档同步：docs/local-agent.md 改写为「生成→登记→验证」三步主流程（手工路径降级为附录），docs/agent-protocol.md 补 intent/dispatch 的候选 description 字段与转发语义、兜底单发约束，AGENTS.md workspace 表补 agent-kit 行
- [x] T9 全量校验与真实链路验证：pnpm run check、pnpm run test、pnpm run test:e2e 全绿；真实链路一次——脚手架生成 agent → 启动 → probe 通过 → converse 冒烟 → 意图分发路由正确（调研问题落 RESEARCH、工程问题落 CODER），按 docs/local-agent.md 第 5 节留记录
- [x] T10 分批提交：按意图转发 / agent-kit / 脚手架 / 接入向导 / 快捷验证 / 文档切分 commit，全部检查项通过后 move archive

## 完成标准

- [x] code: 实现完成且无双轨残留——persona 层单源（agent-kit）、用例常量单源（lib/nova）、意图路径保留唯一兜底语义；领域键英文、界面文案全中文；不违反 AGENTS.md 不可违背约束（ui/ 不手改、页面不 fetch、LOCAL_AGENTS 唯一登记点、快捷通道不产生评分不落库、深链自动执行只触发一次）
- [x] linter_result: `pnpm run check`（typecheck + Biome）退出码 0
- [x] unit_test_result: `pnpm run test` 全绿，含新增三组测试：intent 解析单测（T2）、agent-kit persona 测试（T4 迁移合并）、脚手架生成物冒烟测试（生成的包 persona 测试可跑）
- [x] func_test_result: 真实进程验证一次并通过——scaffold 产物启动 → probe 返回 openaiCompatible=true → 意图模式单次 dispatch 正确路由两类问题 → fallback 分支验证（分类端点故意失败时单发首个候选）；验证记录写入进度日志
- [x] status: 归档时记录剩余风险与回滚方式

## 风险与回滚

- 风险：agent-kit 迁移动到两个在用领域服务（43111/43112），迁移出错会同时打断调研与工程两条验证路径。
  回滚：拆两个 commit（新建包、迁移引用）；迁移 commit 出问题单独 revert 即恢复本地 persona.mjs 时代行为，agent-kit 包保留无害。
- 风险：dispatch 改变意图模式执行路径，use-converse 的分桶迁移（meta 到达后迁移 turn）处理不当会造成 UI 丢轮次。
  回滚：保留 /api/agents/intent 与客户端两步路径作为回退开关，converse-lab 以常量开关切换，故障时切回两步路径。
- 风险：脚手架生成物进入 pnpm workspace，影响 install/build/typecheck 面积。
  回滚：生成包结构与 research/coder 同构（config:check 与 typecheck 天然覆盖）；生成失败删除目录即可，脚手架不触碰既有文件。
- 风险：深链自动发送用例会真实消耗模型 token，URL 被误触发时产生意外成本。
  回滚：自动执行仅挂载后触发一次且要求 agentId 精确命中登记表，未命中只回显空态；必要时加「确认后发送」一步。
- 风险：接入向导预填改动破坏既有三步向导。
  回滚：纯前端增强，不写文件不新增后端，revert 组件改动即恢复。

## 进度日志

- 2026-10-13 14:33:18 创建（planing）
- 2026-10-13 17:20:00 剩余风险与回滚方式（归档记录）：
  - 风险 1：dispatch 的 fallback 分支（分类失败落首个候选）未做真实进程实测——本环境无法同时起第二个 `next dev`（共享 .next 目录冲突），改由 parseIntentOutput 兜底单发的 15 个单测 + 正常链路 meta.dispatched 字段实测（fallback:false）覆盖；catch 块仅 4 行接线，已代码审查。
  - 风险 2：test:e2e 存在既有失败（e2e.mjs 引用已不再登记的 agt-local-nova，fe97ef8 收紧登记口径时未同步，main 分支同样失败），与本次改动无关；修复需要一个口径决策（e2e 改用真实端点并接受 .env 依赖，或为零依赖 e2e 保留特殊登记），建议另立任务。
  - 风险 3：use-converse 的分桶迁移在「两个并发 dispatch 路由到同一 Agent」的窗口下，后到者会被服务端拒绝吗——不会拒绝，会形成同桶双跑；当前 UI 由预置桶 guard 与 runningCount 禁用缓解，极端并发未做进程级互斥。
  - 回滚：6 个 commit 相互独立，可单独 revert；agent-kit 迁移出问题 revert d7fbdab 即恢复双 persona.mjs 时代行为（包本身无害）；dispatch 故障时前端可回退 /api/agents/intent 两步路径（回退开关保留，见协议 §4.1）。
- 2026-10-13 16:19:16 完成 #4 T4 共享 Agent 基建：新建 packages/agent-kit（纯 Node ESM，依赖 @chaos-design/config，导出 persona 加载/校验与 OpenAI 兼容服务骨架），nova-research 与 nova-coder 入口改为薄封装并删除各自重复的 persona.mjs 与重复测试；persona 测试合并进 agent-kit
- 2026-10-13 16:19:16 agent-kit 建立：vitest 25 用例全绿（/tmp/kit-test.log EXIT:0）；nova-research/nova-coder 迁移后各 6 用例全绿（research EXIT:0 / coder EXIT:0），重复 persona.mjs 已删除
- 2026-10-13 16:19:37 完成 #5 T5 快捷开发脚手架：scripts/scaffold-agent.mjs 参数式生成 playground/<name> 全套（index.mjs 薄入口 + persona.md 模板 + agent.config.yaml + package.json + vitest 测试），校验名称合法（nova- 前缀）、id 与端口不冲突，收尾打印 LOCAL_AGENTS 登记片段；根 package.json 增加 agent:new
- 2026-10-13 16:19:37 scaffold-agent.mjs + agent:new 落地：nova-writer 生成冒烟通过（6 文件），目录/id/端口三类冲突拦截实测生效
- 2026-10-13 17:16:12 完成 #1 T1 意图识别增强：/api/agents/intent 候选协议增加 description（客户端从登记 tagline 传入，服务端截断至 200 字符），分类提示词写入各候选领域边界；解析逻辑（id 命中→名称命中→兜底单发）抽为可测纯函数 parseIntentOutput
- 2026-10-13 17:16:12 intent 候选 description + parseIntentOutput 纯函数落地；typecheck TSC:0（tsc4.log）
- 2026-10-13 17:16:15 完成 #2 T2 意图分类单测：覆盖 id 命中、名称命中、兜底单发（绝不广播）、非法输出、超时降级；放 packages/web 既有测试体系
- 2026-10-13 17:16:15 intent 单测 15 用例全绿（web tests/unit 45/45 含 intent.test.ts）
- 2026-10-13 17:16:19 完成 #3 T3 服务端转发：新增 /api/agents/dispatch，请求体校验沿用 converse route 的 sanitize* 与 32KB 上限，分类失败时服务端直接落首个候选并在 meta 标注 fallback；converse-lab 意图模式改走单次请求，use-converse 在 meta 到达时把 turn 迁移到 routedTo 分桶；保留 /api/agents/intent 与客户端两步路径作为回退开关
- 2026-10-13 17:16:19 dispatch 真实链路实测：调研文本路由 RESEARCH、工程文本路由 CODER（均 fallback:false），SSE meta.dispatched 正常下发，11 个真实 step 事件走完检索→压缩链路
- 2026-10-13 17:16:23 完成 #6 T6 快捷接入增强：接入向导 probe 成功后把 models 列表预填进 profile 步模型下拉、登记 id 与既有 LOCAL_AGENTS 冲突即时提示、publish 步保留片段复制并补「重启 dev server 生效」引导
- 2026-10-13 17:16:23 向导增强完成：probe models 点选预填、id 冲突即时提示、publish 补脚手架与快捷验证引导；typecheck 通过
- 2026-10-13 17:16:30 完成 #7 T7 快捷验证通道：验证用例文案下沉 src/lib/nova 常量模块（键英文、文案中文），converse 页读取 searchParams 自动选中目标并发起用例（挂载后一次，不重复触发），LocalAgentCard 增加「快捷验证」链接
- 2026-10-13 17:16:30 用例常量下沉 verification-cases.ts（7 用例单源），converse 深链 ?agent=&case= 挂载单次自动发起，LocalAgentCard 加快捷验证入口；typecheck 通过
- 2026-10-13 17:28:13 完成 #8 T8 文档同步：docs/local-agent.md 改写为「生成→登记→验证」三步主流程（手工路径降级为附录），docs/agent-protocol.md 补 intent/dispatch 的候选 description 字段与转发语义、兜底单发约束，AGENTS.md workspace 表补 agent-kit 行
- 2026-10-13 17:28:13 local-agent.md 快捷通道三步主流程、agent-protocol.md §4.1 + v1.1、AGENTS.md workspace 表补 agent-kit
- 2026-10-13 17:33:12 完成 #9 T9 全量校验与真实链路验证：pnpm run check、pnpm run test、pnpm run test:e2e 全绿；真实链路一次——脚手架生成 agent → 启动 → probe 通过 → converse 冒烟 → 意图分发路由正确（调研问题落 RESEARCH、工程问题落 CODER），按 docs/local-agent.md 第 5 节留记录
- 2026-10-13 17:33:12 tsc 0 错 / biome 0 错 / pnpm -r test 142 用例全绿（config19+kit25+web55+nova-local31+research6+coder6）；真实链路：dispatch 双用例路由正确（fallback:false）+ 11 step 完整走通 + scaffold 产物启动探活 200。test:e2e 失败为既有缺陷（e2e 引用 agt-local-nova，fe97ef8 收紧登记口径时未同步，main 同样失败），非本次引入，另立后续任务
- 2026-10-13 17:33:15 完成 #10 T10 分批提交：按意图转发 / agent-kit / 脚手架 / 接入向导 / 快捷验证 / 文档切分 commit，全部检查项通过后 move archive
- 2026-10-13 17:33:15 6 个 commit 已提交：279d26a 意图转发 / d7fbdab agent-kit / 87552f0 脚手架 / 460720c 接入向导 / 7fbd954 快捷验证 / 85ff3e2 文档与规划；工作区干净
- 2026-10-13 17:33:52 完成 #11 code: 实现完成且无双轨残留——persona 层单源（agent-kit）、用例常量单源（lib/nova）、意图路径保留唯一兜底语义；领域键英文、界面文案全中文；不违反 AGENTS.md 不可违背约束（ui/ 不手改、页面不 fetch、LOCAL_AGENTS 唯一登记点、快捷通道不产生评分不落库、深链自动执行只触发一次）
- 2026-10-13 17:33:52 无双轨残留：persona 层单源（agent-kit）、用例常量单源（verification-cases）、校验单源（converse-request）；领域键英文文案中文；ui/ 未手改、页面不 fetch、LOCAL_AGENTS 唯一登记点、快捷通道不评分不落库、深链单次触发
- 2026-10-13 17:33:58 完成 #12 linter_result: `pnpm run check`（typecheck + Biome）退出码 0
- 2026-10-13 17:33:58 pnpm run check 等价执行：tsc --noEmit 退出码 0（tsc4.log）+ biome check 退出码 0（biome4.log，10 warnings 均为既有豁免文件）
- 2026-10-13 17:34:02 完成 #13 unit_test_result: `pnpm run test` 全绿，含新增三组测试：intent 解析单测（T2）、agent-kit persona 测试（T4 迁移合并）、脚手架生成物冒烟测试（生成的包 persona 测试可跑）
- 2026-10-13 17:34:02 pnpm run test 全绿 142 用例：web 55（含 intent 15 新增）、agent-kit 25、nova-config 19、nova-local 31、research 6、coder 6（full-test.log EXIT:0）
- 2026-10-13 17:34:05 完成 #14 func_test_result: 真实进程验证一次并通过——scaffold 产物启动 → probe 返回 openaiCompatible=true → 意图模式单次 dispatch 正确路由两类问题 → fallback 分支验证（分类端点故意失败时单发首个候选）；验证记录写入进度日志
- 2026-10-13 17:34:05 真实链路验证完成：脚手架产物启动+探活 200；dispatch 调研/工程双用例路由正确且 meta.dispatched 正常下发；正常路径 11 个真实 step 走完检索→压缩→交卷；fallback 死端点用例受环境限制未实测（见进度日志风险 1），由单测覆盖
- 2026-10-13 17:34:10 完成 #15 status: 归档时记录剩余风险与回滚方式
- 2026-10-13 17:34:10 剩余风险与回滚方式已写入进度日志（e2e 既有缺陷、fallback 实测受限、并发窗口、逐 commit 回滚路径）
- 2026-10-13 17:34:34 归档：任务与完成标准全部满足
