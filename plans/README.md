# NOVA 计划中心

本目录保存当前仓库的审计结论、实施计划、待决事项和历史基线。
每个任务都从真实代码审查出发，证据以 `文件:行号` 落地；不收录"凭感觉"的任务描述。

## 状态目录

| 目录 | 含义 | 进入条件 | 离开条件 |
| --- | --- | --- | --- |
| [`planning`](planning/) | 已完成设计和拆解，可按依赖顺序实施 | 问题、证据、方案和 DoD 明确 | 完成后移入 `archive`；失去前置条件时移入 `pending` |
| [`pending`](pending/) | 需要产品、标准或平台决策 | 存在无法由代码单独决定的约束 | 决策完成并补齐 DoD 后移入 `planning` |
| [`archive`](archive/) | 已完成的审计、验证基线和历史计划 | 结论已固化或任务已完成 | 只做勘误，不继续追加实施任务 |

## 当前问题状态

基线日期 **2026-10-07**（首次全库代码审查，
证据全文见 [archive/2026-10-07-code-review-baseline.md](archive/2026-10-07-code-review-baseline.md)）。
同日完成第一轮整改：T01–T05、T07 全部落地并通过 `npm run check` 与真实链路回归。

| 领域 | completed | partial | planned | blocked |
| --- | ---: | ---: | ---: | ---: |
| API 与安全 | 2 | 0 | 0 | 0 |
| 沙盒执行链路 | 3 | 0 | 0 | 0 |
| 界面与项目约定 | 1 | 0 | 1 | 0 |
| 代码卫生 | 1 | 0 | 0 | 0 |
| 数据与口径 | 0 | 0 | 0 | 1 |
| 平台能力 | 0 | 0 | 0 | 1 |
| 对接口径与本地 Agent | 1 | 0 | 0 | 0 |
| **总计** | **8** | **0** | **1** | **2** |

### 任务索引

| 任务 | 标题 | 优先级 | 领域 | 状态 |
| --- | --- | --- | --- | --- |
| [T01](archive/2026-10-07-t01-probe-ssrf-done.md) | 探针 SSRF：重定向可绕过主机黑名单 | P1 | API 与安全 | ✅ completed 10-07 |
| [T02](archive/2026-10-07-t02-api-hardening-done.md) | 沙盒 Route 加固：SSE 拆除防护与请求校验 | P1 | API 与安全 | ✅ completed 10-07 |
| [T03](archive/2026-10-07-t03-sandbox-lifecycle-done.md) | 沙盒运行生命周期：卸载不中止、中止标成完成 | P1 | 沙盒执行链路 | ✅ completed 10-07 |
| [T04](archive/2026-10-07-t04-injection-detection-done.md) | 注入服从检测：通配符正则造成系统性误判 | P1 | 沙盒执行链路 | ✅ completed 10-07 |
| [T05](archive/2026-10-07-t05-executor-consistency-done.md) | 执行器口径一致性修正 | P2 | 沙盒执行链路 | ✅ completed 10-07 |
| [T06](planning/06-p2-convention-convergence.md) | 项目约定收敛：语义色、barrel 出口与常量复用 | P2 | 界面与项目约定 | planned |
| [T07](archive/2026-10-07-t07-interaction-a11y-done.md) | 交互与可达性打磨 | P2 | 界面与项目约定 | ✅ completed 10-07 |
| [T08](archive/2026-10-10-t08-dead-code-done.md) | 死代码清理 | P2 | 代码卫生 | ✅ completed 10-10 |
| [T09](pending/01-run-scores-provenance.md) | 历史运行分数的口径归属 | P2 | 数据与口径 | blocked |
| [T10](pending/02-real-backend.md) | 真实后端与持久化接入 | P2 | 平台能力 | blocked |
| [T11](archive/2026-10-10-t11-agent-protocol-standardization-done.md) | Agent 对接协议规范化与本地执行体完善 | P2 | 对接口径与本地 Agent | ✅ completed 10-10 |

下一轮建议：T08（死代码，含被 T06 联动的导出处置）→ T06（语义色收敛，按组件分批）。

## 优先级

| 级别 | 定义 | 处理要求 |
| --- | --- | --- |
| P0 | 密钥或内部数据泄漏、评分造假、破坏确定性数据铁律 | 立即处理，不带病合入 |
| P1 | 可触达内网/云元数据的 SSRF、资源泄漏（运行不随页面卸载终止、SSE 流拆除抛错）、评分口径错误（误判/漏判 Agent） | 在下一个功能迭代前处理 |
| P2 | 项目约定收敛、口径一致性、可达性、代码卫生 | 在 P0/P1 收敛后处理 |

## 统一完成标准

每个实施任务必须同时满足：

1. `code`：实现完成，不保留双轨逻辑；领域键保持英文稳定键，界面文案全部中文。
2. `check`：`npm run check`（typecheck + Biome）退出码为 0。
3. `convention`：不违反 [`AGENTS.md`](../AGENTS.md) 的不可违背约束——
   `src/components/ui/` 不手改、主题私有配置只进 `nova-theme.css`、页面不写 `fetch`、
   mock 三铁律、界面上出现的分数可追溯。
4. `verify`：涉及评分口径的改动同步 `docs/nova-standard.md`（含第 8 节对应表）；
   涉及执行器/API 的改动按 `docs/local-agent.md` 第 5 节完成一次真实链路验证，
   或给出等价的手工验证记录。
5. `status`：任务文件移入 `archive`，记录验证结果、剩余风险与回滚方式。

## 变更原则

- 数据访问的边界是 `src/lib/nova/`；页面与组件不直接 `fetch`。
- 语义色统一走 `theme.ts` 的映射（状态/等级/向量），界面主色只用
  `text-nova-accent` / `bg-nova-accent`；六个亮色调不散落在组件里。
- 界面上没有预置数据：档案 / 评分 / 遥测全部由 `.nova/runs.json` 里的真实运行
  记录派生（`run-store.ts`）；落库只发生在服务端，读存储的页面必须 `force-dynamic`。
- 派生值不硬编码；改评分口径必须同步改 `docs/nova-standard.md`。
- 密钥只存环境变量名，不落进档案；未跑完验证的本地 Agent 不进排行榜与矩阵。
- 时间格式化只走 `format.ts`，固定北京时间。
- 新增依赖或修改 Next.js 配置后跑一次 `npx next typegen`。
