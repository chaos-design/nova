#!/usr/bin/env node
/**
 * 版本号管理。
 *
 *   npm run release:version -- patch
 *   npm run release:version -- minor
 *   npm run release:version -- 1.2.3
 *
 * 做三件事：
 *   1. 校验参数与当前版本；
 *   2. 写回 package.json（保持原有 JSON 格式与缩进）；
 *   3. 在 CHANGELOG.md 顶部插入一条待填条目。
 *
 * 刻意不自动打 tag —— 打 tag 属于 publish 阶段：版本号可以反复调整，
 * 一旦打了 tag 就变成对外承诺。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "@chaos-design/config";

const root = projectRoot();
const pkgPath = path.join(root, "package.json");
const changelogPath = path.join(root, "CHANGELOG.md");

const bump = process.argv[2];

if (!bump) {
  console.error("用法：npm run release:version -- <patch|minor|major|x.y.z>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

const parts = current.split(".").map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`当前版本号无法解析：${current}`);
  process.exit(1);
}

let next;
if (bump === "patch" || bump === "minor" || bump === "major") {
  const [major, minor, patch] = parts;
  next =
    bump === "major"
      ? [major + 1, 0, 0]
      : bump === "minor"
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1];
  next = next.join(".");
} else if (/^\d+\.\d+\.\d+$/.test(bump)) {
  next = bump;
} else {
  console.error(
    `无法识别的版本参数：${bump}（应为 patch / minor / major / x.y.z）`,
  );
  process.exit(1);
}

if (next === current) {
  console.error(`目标版本与当前版本相同（${current}），无需变更。`);
  process.exit(1);
}

/* ---------- 写回 package.json ---------- */
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`✓ package.json: ${current} → ${next}`);

/* ---------- 插入 CHANGELOG 条目 ---------- */
const today = new Date().toISOString().slice(0, 10);
const entry = `## [${next}] - ${today}\n\n### 变更\n\n- （待补充：本次发布的主要内容）\n\n`;

let changelog = "";
try {
  changelog = readFileSync(changelogPath, "utf8");
} catch {
  changelog =
    "# 更新日志\n\n所有值得记录的变更都写在这里，格式遵循 Keep a Changelog。\n\n";
}

// 插到第一条版本记录之前，保留文件头
const marker = changelog.indexOf("\n## [");
if (marker === -1) {
  changelog = `${changelog.replace(/\n+$/, "")}\n\n${entry}`;
} else {
  changelog =
    changelog.slice(0, marker + 1) + entry + changelog.slice(marker + 1);
}

writeFileSync(changelogPath, changelog, "utf8");
console.log(`✓ CHANGELOG.md 已插入 [${next}] 条目`);

/* ---------- 提示下一步 ---------- */
console.log(`\n下一步：填写 CHANGELOG 中 [${next}] 的内容，然后依次执行`);
console.log("  npm run release:build");
console.log("  npm run release:package");
console.log("  npm run release:publish");

// 供发布编排脚本读取
if (process.env.NOVA_RELEASE_EMIT_VERSION === "true") {
  execFileSync("echo", [next]);
}
