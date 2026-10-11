import { fileURLToPath } from "node:url";
import { getConfig } from "@chaos-design/config";
import { defineConfig } from "vitest/config";

/**
 * 测试配置。
 *
 * 覆盖率阈值与输出目录从 config.yaml 读，避免"测试里写一个 60、配置里写一个 70"。
 */
const config = getConfig();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 集成测试要起子进程，给足超时；单测本身是毫秒级
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reportsDirectory: config.test.coverageDir,
      reporter: ["text", "html", "json-summary"],
      // 只统计有测试覆盖的模块：UI 与页面不在单测范围内，
      // 把它们算进来只会让分母变成一大片 0%。
      // 配置加载器已拆到 @chaos-design/config、Agent 在 @chaos-design/nova-local，
      // 二者的覆盖率由各自包内的 vitest 配置统计，这里只管 web 本体。
      all: true,
      include: ["src/lib/nova/verdict.ts", "src/lib/nova/scoring.ts"],
      exclude: ["**/*.d.mts", "**/node_modules/**"],
      thresholds: {
        lines: config.test.coverageThreshold,
        statements: config.test.coverageThreshold,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
