#!/usr/bin/env node
/**
 * 发布前校验（preflight）。
 *
 * 目标：把「发布到一半才发现」的问题全部前置到这一步。
 * 任何一条不通过即退出码 1 —— 后续脚本可以把本脚本当作前置依赖。
 *
 * 校验项由 config.yaml 的 release.preflight 控制开关：
 *   requireCleanTree / requireBranch / requireTests
 */

import { execFileSync } from "node:child_process";
import { getConfig, projectRoot } from "@chaos-design/config";

const config = getConfig();
const root = projectRoot();
const preflight = config.release.preflight;

/** 跑一条命令，返回输出；失败时抛错 */
function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const failures = [];
const notes = [];

/* ---------- 1. 工作区干净 ---------- */
if (preflight.requireCleanTree) {
  const status = run("git", ["status", "--porcelain"]);
  if (status.length > 0) {
    failures.push(
      `工作区不干净（${status.split("\n").length} 处改动）。请先提交或 stash。`,
    );
  } else {
    notes.push("工作区干净");
  }
}

/* ---------- 2. 在约定分支上 ---------- */
if (preflight.requireBranch) {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== preflight.requireBranch) {
    failures.push(
      `当前分支是 ${branch}，发布必须在 ${preflight.requireBranch} 上。`,
    );
  } else {
    notes.push(`分支为 ${branch}`);
  }
}

/* ---------- 3. 配置自检 ---------- */
try {
  run(process.execPath, ["scripts/check-config.mjs"]);
  notes.push("配置自检通过");
} catch {
  failures.push("配置自检未通过，运行 npm run config:check 查看详情。");
}

/* ---------- 4. 类型与规范 ---------- */
try {
  run("npx", ["tsc", "--noEmit"]);
  notes.push("类型检查通过");
} catch {
  failures.push("类型检查未通过，运行 npm run typecheck 查看详情。");
}

try {
  run("npx", ["biome", "check"]);
  notes.push("代码规范检查通过");
} catch {
  failures.push("lint 未通过，运行 npm run lint:fix 修复。");
}

/* ---------- 5. 测试 ---------- */
if (preflight.requireTests) {
  try {
    run(process.execPath, [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/unit",
      "tests/integration",
    ]);
    notes.push("单元与集成测试通过");
  } catch {
    failures.push("测试未通过，运行 npm run test 查看详情。");
  }
}

/* ---------- 结果 ---------- */
for (const note of notes) console.log(`✓ ${note}`);

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) console.error(`✗ ${failure}`);
  console.error("\n发布前校验未通过，已中止。");
  process.exit(1);
}

console.log("\n✓ 发布前校验全部通过");
