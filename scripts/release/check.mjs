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
// tsc 依赖 Next 生成的全局路由类型（.next/types），先按 AGENTS.md §3.1 同一条
// 命令生成，再一并跑 typecheck + biome。不能在根目录用 `npx tsc`：typescript
// 不是根依赖，npx 会去装那个假 tsc 包而不是真正的类型检查。
try {
  run("pnpm", ["--filter", "@chaos-design/web", "exec", "next", "typegen"]);
  run("pnpm", ["run", "check"]);
  notes.push("类型检查与代码规范检查通过");
} catch {
  failures.push("类型检查 / lint 未通过，运行 pnpm run check 查看详情。");
}

/* ---------- 5. 测试 ---------- */
if (preflight.requireTests) {
  try {
    // vitest 是各包（web / nova-config）的 devDependency，不是根依赖；
    // tests/unit、tests/integration 也是 web 包内的相对路径。统一走 pnpm -r。
    run("pnpm", ["run", "test"]);
    notes.push("单元与集成测试通过");
  } catch {
    failures.push("测试未通过，运行 pnpm run test 查看详情。");
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
