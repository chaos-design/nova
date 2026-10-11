#!/usr/bin/env node
/**
 * 发布编排。
 *
 *   npm run release -- patch
 *   npm run release -- minor
 *   npm run release -- 1.2.3
 *
 * 严格按依赖顺序执行，任一步失败即整体中止（不再往下走）：
 *
 *   check ──> version ──> build ──> package ──> publish
 *   校验      版本号      构建      产物        远端发布
 *
 * 之所以串成一条链而不是五条独立命令：发布是有副作用的流程，
 * 半途继续只会留下"版本号改了但没构建"这类烂摊子。
 */

import { spawnSync } from "node:child_process";
import { projectRoot } from "@chaos-design/config";

const root = projectRoot();
const bump = process.argv[2] ?? "patch";

const steps = [
  { label: "发布前校验", script: "scripts/release/check.mjs", args: [] },
  { label: "版本号", script: "scripts/release/version.mjs", args: [bump] },
  { label: "构建", script: "scripts/release/build.mjs", args: [] },
  { label: "产物打包", script: "scripts/release/package.mjs", args: [] },
  { label: "发布", script: "scripts/release/publish.mjs", args: [] },
];

console.log(`▸ NOVA 发布流程（${bump}）\n`);

for (const [index, step] of steps.entries()) {
  console.log(`\n──── ${index + 1}/${steps.length} · ${step.label} ────`);

  const result = spawnSync(process.execPath, [step.script, ...step.args], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(
      `\n✗ 发布中止于「${step.label}」（退出码 ${result.status}）。\n` +
        `  已完成的步骤：${
          steps
            .slice(0, index)
            .map((s) => s.label)
            .join(" → ") || "无"
        }。\n` +
        `  修复后可单独重跑：node ${step.script}${step.args.length ? ` ${step.args.join(" ")}` : ""}`,
    );
    process.exit(result.status ?? 1);
  }
}

console.log("\n✓ 发布流程全部完成");
