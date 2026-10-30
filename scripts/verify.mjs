#!/usr/bin/env node
/**
 * 验证方案执行器。
 *
 * 做三件事，缺一不可：
 * 1. 按 `[V-xx]` 标签把真实跑过的用例归到任务上 —— 任务不是文档里的待办，
 *    而是有执行证据的断言集合；
 * 2. 校验「清单 / 文档 / 测试文件」三方一致，防止只改一处留下空任务；
 * 3. 汇总成可存档的报告与退出码，供本地与 CI 当门禁用。
 *
 * 用法见 docs/verification-plan.md 第 8 节。
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  orderByDependency,
  TASKS,
  validateTasks,
} from "./verification/tasks.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, "packages", "web");
const VITEST_ENTRY = path.join(WEB_DIR, "node_modules", "vitest", "vitest.mjs");
const PLAN_DOC = path.join(ROOT, "docs", "verification-plan.md");
const REPORT_DIR = path.join(ROOT, ".nova");
const REPORT_FILE = path.join(REPORT_DIR, "verification-report.json");

const argv = process.argv.slice(2);
const onlyArg = argv.find((item) => item.startsWith("--only"));
const only = onlyArg
  ? (onlyArg.split("=")[1] ?? argv[argv.indexOf(onlyArg) + 1] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  : [];

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`用法：
  node scripts/verify.mjs               跑全部任务
  node scripts/verify.mjs --only V-08   只跑指定任务（逗号分隔）
  node scripts/verify.mjs --list        列出任务与依赖顺序`);
  process.exit(0);
}

if (argv.includes("--list")) {
  printTasks(TASKS);
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* 静态一致性                                                                  */
/* -------------------------------------------------------------------------- */

const manifestErrors = validateTasks();
if (manifestErrors.length > 0) {
  fail("任务清单不合法", manifestErrors);
}

if (!existsSync(VITEST_ENTRY)) {
  fail("找不到 vitest", [`预期路径：${VITEST_ENTRY}，请先安装依赖`]);
}

const selected = only.length
  ? TASKS.filter((task) => only.includes(task.id))
  : TASKS;

const unknownSelection = only.filter(
  (id) => !TASKS.some((task) => task.id === id),
);
if (unknownSelection.length > 0) {
  fail("--only 指定了不存在的任务", unknownSelection);
}

// 一个任务一个测试文件：文件不在，任务就没有执行载体
const missingFiles = selected.filter(
  (task) => !existsSync(path.join(WEB_DIR, task.file)),
);
if (missingFiles.length > 0) {
  fail(
    "任务缺少测试文件",
    missingFiles.map((task) => `${task.id} → ${task.file}`),
  );
}

// 文档必须登记同一批任务：清单是机器副本，文档是人读契约
if (!existsSync(PLAN_DOC)) {
  fail("缺少验证方案文档", [PLAN_DOC]);
}
const planText = readFileSync(PLAN_DOC, "utf8");
const undocumented = selected.filter(
  (task) =>
    !planText.includes(task.id) || !planText.includes(path.basename(task.file)),
);
if (undocumented.length > 0) {
  fail(
    "文档与任务清单不一致",
    undocumented.map((task) => `${task.id} / ${task.file} 未在验证方案中登记`),
  );
}

/* -------------------------------------------------------------------------- */
/* 执行                                                                        */
/* -------------------------------------------------------------------------- */

const tmp = mkdtempSync(path.join(tmpdir(), "nova-verify-"));
const reportPath = path.join(tmp, "vitest-report.json");
const files = selected.map((task) => task.file);
const startedAt = Date.now();

console.log(
  `NOVA 验证：${selected.length} 个任务 / ${files.length} 个测试文件\n`,
);

const run = spawnSync(
  process.execPath,
  [
    VITEST_ENTRY,
    "run",
    ...files,
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ],
  {
    cwd: WEB_DIR,
    // 报告只落在临时文件：把 stdout 收起来，避免 JSON 报告器的提示
    // 混进验证矩阵；失败时再把 stderr 尾部打出来。
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    // e2e 门控会往登记表注入离线执行体，验证进程必须保持关闭
    env: { ...process.env, NOVA_E2E: "" },
  },
);

if (run.status !== 0) {
  const tailOf = (text) =>
    (text ?? "").trim().split("\n").slice(-20).join("\n");
  console.error(tailOf(run.stdout));
  console.error(tailOf(run.stderr));
}

if (!existsSync(reportPath)) {
  rmSync(tmp, { recursive: true, force: true });
  fail("测试进程没有产出报告", [
    `vitest 退出码：${run.status ?? `signal ${run.signal}`}`,
    "先单独执行 pnpm --filter @chaos-design/web test 查看原始错误",
  ]);
}

const raw = JSON.parse(readFileSync(reportPath, "utf8"));
const assertions = flattenAssertions(raw);
const totals = summarize(assertions, selected);
const durationMs = Date.now() - startedAt;

rmSync(tmp, { recursive: true, force: true });

/* -------------------------------------------------------------------------- */
/* 判定                                                                        */
/* -------------------------------------------------------------------------- */

const problems = [];

for (const task of selected) {
  const row = totals.byTask.get(task.id);
  if (!row || row.total === 0) {
    problems.push(`${task.id} 没有任何带标签的用例`);
    continue;
  }
  if (row.total < task.minCases) {
    problems.push(`${task.id} 用例不足：${row.total} < 下限 ${task.minCases}`);
  }
  if (row.failed > 0) {
    problems.push(`${task.id} 有 ${row.failed} 条失败`);
  }
}

if (totals.unknownTags.length > 0) {
  problems.push(`存在未知任务标签：${totals.unknownTags.join("、")}`);
}
if (totals.failed > 0) {
  problems.push(`未标注任务的用例也有 ${totals.failed} 条失败`);
}
if (run.status !== 0 && totals.failed === 0) {
  problems.push(`vitest 退出码非 0（${run.status}），但没有解析到失败用例`);
}

printMatrix(selected, totals.byTask);
printFailures(totals.failures);
printSummary(selected, totals, durationMs, problems);

writeReport({
  startedAt: new Date(startedAt).toISOString(),
  durationMs,
  selected: selected.map((task) => task.id),
  totals,
  rows: selected.map((task) => ({
    ...task,
    ...(totals.byTask.get(task.id) ?? { total: 0, passed: 0, failed: 0 }),
  })),
  problems,
});

if (problems.length > 0) {
  console.error("\n验证未通过：");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  "\n验证通过：任务覆盖、用例结果与文档一致性均满足 AC-1 / AC-2；AC-3 由临时目录与桩端点保证。",
);
process.exit(0);

/* -------------------------------------------------------------------------- */
/* 辅助                                                                        */
/* -------------------------------------------------------------------------- */

function flattenAssertions(report) {
  const files = report.testResults ?? report.results ?? [];
  const rows = [];

  for (const file of files) {
    const cases = file.assertionResults ?? file.tests ?? [];
    for (const item of cases) {
      const name = [item.fullName, item.title].filter(Boolean).join(" ");
      rows.push({
        name,
        status: item.status ?? "unknown",
        messages: item.failureMessages ?? [],
        durationMs: item.duration ?? 0,
      });
    }
  }

  return rows;
}

function summarize(rows, tasks) {
  const byTask = new Map(
    tasks.map((task) => [task.id, { total: 0, passed: 0, failed: 0 }]),
  );
  const known = new Set(tasks.map((task) => task.id));
  const unknownTags = new Set();
  const failures = [];
  let passed = 0;
  let failed = 0;

  for (const row of rows) {
    const tags = new Set(row.name.match(/\[(V-\d{2})\]/g) ?? []);
    const ok = row.status === "passed";

    if (!ok) failures.push(row);
    if (ok) passed += 1;
    else failed += 1;

    for (const rawTag of tags) {
      const id = rawTag.slice(1, -1);
      if (!known.has(id)) {
        unknownTags.add(id);
        continue;
      }
      const rowOfTask = byTask.get(id);
      rowOfTask.total += 1;
      if (ok) rowOfTask.passed += 1;
      else rowOfTask.failed += 1;
    }
  }

  return {
    total: rows.length,
    passed,
    failed,
    byTask,
    unknownTags: [...unknownTags].sort(),
    failures,
  };
}

function printMatrix(tasks, byTask) {
  const header = ["任务", "名称", "层", "用例", "通过", "状态"];
  const rows = tasks.map((task) => {
    const row = byTask.get(task.id) ?? { total: 0, passed: 0, failed: 0 };
    return [
      task.id,
      task.title,
      task.layer,
      String(row.total),
      String(row.passed),
      row.failed === 0 && row.total >= task.minCases ? "PASS" : "FAIL",
    ];
  });

  const widths = header.map((title, index) =>
    Math.max(
      displayWidth(title),
      ...rows.map((row) => displayWidth(row[index])),
    ),
  );

  const line = (cells) =>
    cells
      .map(
        (cell, index) => cell + " ".repeat(widths[index] - displayWidth(cell)),
      )
      .join("  ");

  console.log(line(header));
  console.log(widths.map((width) => "─".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
  console.log("");
}

function printFailures(failures) {
  if (failures.length === 0) return;

  console.error(`失败用例（${failures.length}）：`);
  for (const item of failures) {
    const firstLine = item.messages[0]?.split("\n")[0] ?? item.status;
    console.error(`  ✗ ${item.name}`);
    console.error(`    ${firstLine}`);
  }
  console.error("");
}

function printSummary(tasks, totals, durationMs, problems) {
  const cases = tasks.reduce(
    (acc, task) => acc + (totals.byTask.get(task.id)?.total ?? 0),
    0,
  );
  const minCases = tasks.reduce((acc, task) => acc + task.minCases, 0);

  console.log(
    `任务 ${tasks.length}/${TASKS.length} · 用例 ${cases}（下限 ${minCases}）· ` +
      `通过 ${totals.passed}/${totals.total} · 耗时 ${(durationMs / 1000).toFixed(1)}s`,
  );
  console.log(`AC-1 覆盖下限：${cases >= minCases ? "满足" : "不满足"}`);
  console.log(
    `AC-2 全部通过：${totals.failed === 0 && problems.length === 0 ? "满足" : "不满足"}`,
  );
  console.log(
    `AC-7 时长 ≤ 8 分钟：${durationMs <= 8 * 60_000 ? "满足" : "不满足"}`,
  );
}

function writeReport(payload) {
  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`报告：${path.relative(ROOT, REPORT_FILE)}`);
  } catch (error) {
    console.warn(`报告写入失败（不影响判定）：${error.message}`);
  }
}

function printTasks(tasks) {
  console.log("任务清单（按依赖顺序）：");
  for (const task of orderByDependency(tasks)) {
    const deps = task.dependsOn.length ? task.dependsOn.join(",") : "—";
    console.log(
      `  ${task.id}  ${task.title}（${task.layer}，≥${task.minCases} 例，依赖 ${deps}）`,
    );
  }
}

function displayWidth(text) {
  // CJK 字符占两列，仅用于控制台对齐；不影响报告字段
  return [...text].reduce(
    (width, char) => width + (/[\u4e00-\u9fff]/.test(char) ? 2 : 1),
    0,
  );
}

function fail(title, details) {
  console.error(`✗ ${title}`);
  for (const detail of details) console.error(`  - ${detail}`);
  process.exit(2);
}
