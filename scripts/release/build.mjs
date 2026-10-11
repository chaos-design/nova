#!/usr/bin/env node
/**
 * 发布构建。
 *
 * 与 `pnpm run build` 的区别：
 *   - 固定 `NOVA_ENV=production`；
 *   - 打开 `NOVA_RELEASE_BUILD=true`，让 next.config.ts 产出 standalone 产物
 *     （日常开发不需要 standalone，它只服务于打包）。
 *
 * monorepo：构建发生在 `packages/web`（next 的 cwd 必须是包目录，
 * 否则找不到 next.config.ts），产物落在 `packages/web/.next/`
 * （standalone 在 `packages/web/.next/standalone`），
 * 由 release:package 组装成可分发目录与压缩包。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { getConfig, projectRoot } from "@chaos-design/config";

const config = getConfig();
const root = projectRoot();
const webDir = path.join(root, "packages", "web");

console.log(`▸ 发布构建：${config.app.name}（${config.release.output} 产物）`);

const result = spawnSync(
  process.execPath,
  [path.join(webDir, "node_modules/next/dist/bin/next"), "build"],
  {
    cwd: webDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NOVA_ENV: "production",
      NOVA_RELEASE_BUILD: "true",
    },
  },
);

if (result.status !== 0) {
  console.error(`\n✗ 构建失败（退出码 ${result.status}）`);
  process.exit(result.status ?? 1);
}

console.log("\n✓ 构建完成，产物在 packages/web/.next/");
console.log("  下一步：pnpm run release:package");
