/**
 * 验证任务清单（机器可读的唯一副本）。
 *
 * 设计文档：docs/verification-plan.md
 * 执行器：scripts/verify.mjs
 *
 * 约定：
 * - `id` 同时是测试用例的标签（describe 标题以 `[V-xx]` 开头）；
 * - 一个任务对应一个测试文件，`file` 相对 packages/web；
 * - `minCases` 是该任务必须达到的用例数，低于它视为覆盖不足；
 * - `dependsOn` 只表达验证顺序上的前置关系，执行器会校验存在性与无环。
 *
 * 改动这里必须同步文档第 4、5 节；执行器会反过来校验两边是否一致。
 */

export const TASKS = [
  {
    id: "V-01",
    title: "评分与等级派生",
    layer: "unit",
    file: "tests/unit/plan-scoring.test.ts",
    minCases: 10,
    dependsOn: [],
    standard: "nova-standard §1.2 / §1.3",
  },
  {
    id: "V-02",
    title: "观测 → 判定口径",
    layer: "unit",
    file: "tests/unit/plan-verdict.test.ts",
    minCases: 8,
    dependsOn: ["V-01"],
    standard: "nova-standard §3.5 / §4",
  },
  {
    id: "V-03",
    title: "混沌排布与环境裁剪",
    layer: "unit",
    file: "tests/unit/plan-chaos.test.ts",
    minCases: 9,
    dependsOn: [],
    standard: "nova-standard §2 / §3.1",
  },
  {
    id: "V-04",
    title: "工具确定性与注入判定",
    layer: "unit",
    file: "tests/unit/plan-tools.test.ts",
    minCases: 12,
    dependsOn: [],
    standard: "nova-standard §3.3",
  },
  {
    id: "V-05",
    title: "对话请求信任边界",
    layer: "unit",
    file: "tests/unit/plan-converse-request.test.ts",
    minCases: 12,
    dependsOn: [],
    standard: "agent-protocol §2 / §5",
  },
  {
    id: "V-06",
    title: "连接档案与旧键迁移",
    layer: "unit",
    file: "tests/unit/plan-llm-profiles.test.ts",
    minCases: 12,
    dependsOn: [],
    standard: "architecture §7",
  },
  {
    id: "V-07",
    title: "SSE 分帧、容错与中止",
    layer: "unit",
    file: "tests/unit/plan-sse.test.ts",
    minCases: 9,
    dependsOn: [],
    standard: "agent-protocol §6",
  },
  {
    id: "V-08",
    title: "意图解析与单发兜底",
    layer: "unit",
    file: "tests/unit/plan-intent.test.ts",
    minCases: 9,
    dependsOn: [],
    standard: "agent-protocol §4.1",
  },
  {
    id: "V-09",
    title: "运行记录落库与派生",
    layer: "unit",
    file: "tests/unit/plan-run-store.test.ts",
    minCases: 11,
    dependsOn: ["V-02"],
    standard: "nova-standard §5 / §6",
  },
  {
    id: "V-10",
    title: "用例清单与深链契约",
    layer: "unit",
    file: "tests/unit/plan-cases.test.ts",
    minCases: 6,
    dependsOn: [],
    standard: "agent-protocol §4.2",
  },
  {
    id: "V-11",
    title: "路由入参校验",
    layer: "integration",
    file: "tests/integration/plan-routes.test.ts",
    minCases: 13,
    dependsOn: ["V-05"],
    standard: "agent-protocol §5",
  },
  {
    id: "V-12",
    title: "沙盒全链路（桩模型）",
    layer: "integration",
    file: "tests/integration/plan-sandbox-live.test.ts",
    minCases: 4,
    dependsOn: ["V-03", "V-04", "V-09", "V-11"],
    standard: "nova-standard §3.4 / §5",
  },
  {
    id: "V-13",
    title: "对话全链路（桩模型）",
    layer: "integration",
    file: "tests/integration/plan-converse-live.test.ts",
    minCases: 4,
    dependsOn: ["V-04", "V-05", "V-07", "V-11"],
    standard: "agent-protocol §2 / §3.4",
  },
  {
    id: "V-14",
    title: "报告契约与展示口径",
    layer: "unit",
    file: "tests/unit/plan-report.test.ts",
    minCases: 10,
    dependsOn: ["V-01"],
    standard: "nova-standard §7",
  },
];

/** 任务 id → 任务，供执行器与文档校验复用 */
export const TASK_MAP = new Map(TASKS.map((task) => [task.id, task]));

/** 按依赖拓扑排序（同层保持清单顺序），用于打印建议执行顺序 */
export function orderByDependency(tasks = TASKS) {
  const pending = new Map(
    tasks.map((task) => [task.id, new Set(task.dependsOn)]),
  );
  const ordered = [];

  while (pending.size > 0) {
    const ready = tasks.filter(
      (task) => pending.has(task.id) && pending.get(task.id).size === 0,
    );
    if (ready.length === 0) break; // 有环时由 validateTasks 报错

    for (const task of ready) {
      ordered.push(task);
      pending.delete(task.id);
      for (const rest of pending.values()) rest.delete(task.id);
    }
  }

  return ordered;
}

/**
 * 清单自检：id 唯一、依赖存在、无环、必填字段完整。
 * 返回值是错误信息数组，空数组表示通过。
 */
export function validateTasks(tasks = TASKS) {
  const errors = [];
  const ids = new Set();

  for (const task of tasks) {
    if (!/^V-\d{2}$/.test(task.id)) errors.push(`任务 id 不合规：${task.id}`);
    if (ids.has(task.id)) errors.push(`任务 id 重复：${task.id}`);
    ids.add(task.id);

    if (!task.title?.trim()) errors.push(`${task.id} 缺少标题`);
    if (!task.file?.startsWith("tests/")) {
      errors.push(`${task.id} 的测试文件必须位于 tests/ 下`);
    }
    if (!Number.isInteger(task.minCases) || task.minCases < 1) {
      errors.push(`${task.id} 的 minCases 必须是正整数`);
    }
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) {
        errors.push(`${task.id} 依赖不存在的任务：${dependency}`);
      }
    }
  }

  if (orderByDependency(tasks).length !== tasks.length) {
    errors.push("任务依赖存在环，无法确定执行顺序");
  }

  return errors;
}
