import path from "node:path";
import type { NextConfig } from "next";

/**
 * 只在发布构建时产出 standalone。
 *
 * standalone 会把运行时依赖收敛到 .next/standalone，便于打包分发；
 * 但它会改变 .next 的产物结构，日常开发不需要，因此默认关闭 ——
 * 由 release:build 通过 NOVA_RELEASE_BUILD=true 打开。
 */
const releaseBuild = process.env.NOVA_RELEASE_BUILD === "true";

/**
 * Vercel 上的函数运行目录是打包产物（VERCEL_PATH），仓库根的
 * config.yaml 默认不会被打进函数。这里把它 trace 进每一个服务端
 * 函数，让 @chaos-design/config 在 Vercel 上也能读到同一份配置。
 * 本地 / 自托管构建里该文件已随仓库存在，重复 trace 无害。
 */
const repoConfigYaml = path.resolve(process.cwd(), "..", "..", "config.yaml");

const nextConfig: NextConfig = {
  // 路由全部类型化：<Link href> 只接受真实存在的路由字符串
  typedRoutes: true,
  ...(releaseBuild ? { output: "standalone" } : {}),
  outputFileTracingIncludes: {
    "**": [repoConfigYaml],
  },
};

export default nextConfig;
