#!/usr/bin/env node
/**
 * 产物组装与打包。
 *
 * 把 standalone 构建产物 + 静态资源 + 运行所需配置拼成一个自包含目录，
 * 再打成 tar.gz。目标是：解压后配好 .env 就能 `node server.js` 跑起来。
 *
 * 输出：release/<version>/          自包含目录
 *       release/nova-<version>.tar.gz   压缩包
 *
 * 注意：打入的是 **.env.example 而不是 .env** —— 产物里绝不携带真实密钥。
 *
 * monorepo 说明：构建产物在 `packages/web/.next`，静态资源在
 * `packages/web/.next/static`，前端资源在 `packages/web/public`。Agent 依赖的
 * 配置加载器是独立包 `packages/nova-config`，需要一并带入才能让 `@chaos-design/config`
 * 在产物里解析成功。
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getConfig, projectRoot } from "@chaos-design/config";

const config = getConfig();
const root = projectRoot();

// 发布版本以根 package.json 为唯一事实来源（release:version 也写这里）
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;

const webDir = path.join(root, "packages", "web");
const outDir = path.join(root, config.release.outDir);
const target = path.join(outDir, version);
const archive = path.join(outDir, `nova-${version}.tar.gz`);

/* ---------- 前置：必须先构建 ---------- */
const standalone = path.join(root, "packages", "web", ".next", "standalone");
if (!existsSync(standalone)) {
  console.error(
    `✗ 未找到 ${path.relative(root, standalone)}，请先执行 pnpm run release:build`,
  );
  process.exit(1);
}

/* ---------- 组装 ---------- */
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

cpSync(standalone, target, { recursive: true });

// standalone 只带服务端代码，静态资源与 public 要自己搬
const staticDir = path.join(webDir, ".next", "static");
if (existsSync(staticDir)) {
  cpSync(staticDir, path.join(target, ".next", "static"), { recursive: true });
}
const publicDir = path.join(webDir, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(target, "public"), { recursive: true });
}

// 运行所需配置：主配置 + 环境变量模板（**不是** .env）
copyFileSync(path.join(root, "config.yaml"), path.join(target, "config.yaml"));
copyFileSync(
  path.join(root, ".env.example"),
  path.join(target, ".env.example"),
);
copyFileSync(
  path.join(webDir, "package.json"),
  path.join(target, "package.json"),
);

// playground 里的 Agent 也要带上：控制台要能拉起本地 Agent
const playgroundDir = path.join(root, "playground");
if (existsSync(playgroundDir)) {
  cpSync(playgroundDir, path.join(target, "playground"), { recursive: true });
}
// Agent 依赖共享配置包，一并带入，让 @chaos-design/config 在产物里可解析
const configPkgDir = path.join(root, "packages", "nova-config");
if (existsSync(configPkgDir)) {
  cpSync(configPkgDir, path.join(target, "packages", "nova-config"), {
    recursive: true,
  });
}

// 启动说明写进产物，避免"拿到压缩包不知道怎么跑"
writeFileSync(
  path.join(target, "README-RELEASE.txt"),
  [
    `NOVA ${version} 发布产物`,
    "",
    "运行步骤：",
    "  1. cp .env.example .env    # 按注释填写需要的变量",
    "  2. node server.js          # 默认 3234 端口，可用 NOVA_DEV_PORT 覆盖",
    "",
    "本地 Agent（可选）：",
    "  node playground/nova-local/index.mjs   # 默认 43110 端口",
    "",
    "配置说明见 config.yaml（注释含每个项的用途、默认值与是否必填）。",
    `打包时间：${new Date().toISOString()}`,
  ].join("\n"),
  "utf8",
);

/* ---------- 打压缩包 ---------- */
rmSync(archive, { force: true });
mkdirSync(outDir, { recursive: true });
execFileSync("tar", ["-czf", archive, "-C", outDir, version]);

const size = (file) => (statSync(file).size / 1024 / 1024).toFixed(2);

console.log(`✓ 产物目录：${path.relative(root, target)}`);
console.log(`✓ 压缩包：${path.relative(root, archive)}（${size(archive)} MB）`);
console.log("\n  下一步：pnpm run release:publish");
