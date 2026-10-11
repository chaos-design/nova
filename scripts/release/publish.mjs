#!/usr/bin/env node
/**
 * 发布：提交版本号、打 tag 并创建 GitHub Release。
 *
 * 受 config.yaml 的 release.createGithubRelease 控制：
 *   设为 false 时只在本机提交 + 打 tag，不碰远端。
 *
 * 前置依赖（由 release:index.mjs 保证顺序）：
 *   release:check → release:version → release:build → release:package
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { getConfig, projectRoot } from "@chaos-design/config";

const config = getConfig();
const root = projectRoot();

const pkgVersion = execFileSync(
  "node",
  ["-p", "require('./package.json').version"],
  { cwd: root, encoding: "utf8" },
).trim();

const tag = `v${pkgVersion}`;
const archive = path.join(
  root,
  config.release.outDir,
  `nova-${pkgVersion}.tar.gz`,
);

if (!existsSync(archive)) {
  console.error(`✗ 未找到产物 ${archive}，请先执行 npm run release:package`);
  process.exit(1);
}

/* ---------- 1. 提交版本变更 ---------- */
const status = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (status.length > 0) {
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-m", `chore(release): ${tag}`], {
    cwd: root,
    stdio: "inherit",
  });
  console.log(`✓ 已提交版本变更 ${tag}`);
} else {
  console.log("✓ 没有待提交的变更");
}

/* ---------- 2. 打 tag ---------- */
const existingTags = execFileSync("git", ["tag", "-l", tag], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (existingTags === tag) {
  console.log(`✓ tag ${tag} 已存在，跳过`);
} else {
  execFileSync("git", ["tag", "-a", tag, "-m", `NOVA ${tag}`], {
    cwd: root,
    stdio: "inherit",
  });
  console.log(`✓ 已打 tag ${tag}`);
}

/* ---------- 3. 远端发布 ---------- */
if (!config.release.createGithubRelease) {
  console.log(
    "\n· release.createGithubRelease=false，跳过远端发布。\n" +
      `  需要推送时手动执行：git push origin ${tag}`,
  );
  process.exit(0);
}

const push = spawnSync("git", ["push", "origin", "HEAD", "--follow-tags"], {
  cwd: root,
  stdio: "inherit",
});
if (push.status !== 0) {
  console.error("✗ 推送失败，请检查远端权限与网络。");
  process.exit(push.status ?? 1);
}
console.log("✓ 已推送提交与 tag");

const release = spawnSync(
  "gh",
  [
    "release",
    "create",
    tag,
    archive,
    "--title",
    `NOVA ${tag}`,
    "--generate-notes",
  ],
  { cwd: root, stdio: "inherit" },
);

if (release.status !== 0) {
  console.error(
    "✗ 创建 GitHub Release 失败。请确认已安装并登录 gh（gh auth status）。",
  );
  process.exit(release.status ?? 1);
}

console.log(`\n✓ 已发布 ${tag}`);
