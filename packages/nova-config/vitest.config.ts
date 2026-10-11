import { fileURLToPath } from "node:url";
import { getConfig } from "@chaos-design/config";
import { defineConfig } from "vitest/config";

/**
 * 配置包的测试配置。
 *
 * 覆盖率阈值与输出目录从仓库根的 config.yaml 读（经 @chaos-design/config 自身），
 * 与 web 包共用同一套口径，避免"配置里写 60、这里写 70"。
 */
const config = getConfig();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: config.test.coverageDir,
      reporter: ["text", "html", "json-summary"],
      all: true,
      include: ["src/config.mjs"],
      exclude: ["**/*.d.mts", "**/node_modules/**"],
      thresholds: {
        lines: config.test.coverageThreshold,
        statements: config.test.coverageThreshold,
      },
    },
  },
  resolve: {
    alias: {
      // 包内自引用：pnpm 不会把包链接进它自己的 node_modules，
      // 测试与配置里 import @chaos-design/config 需要显式指回本地源码。
      "@chaos-design/config": fileURLToPath(
        new URL("./src/config.mjs", import.meta.url),
      ),
    },
  },
});
