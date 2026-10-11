import { getConfig } from "@chaos-design/config";
import { defineConfig } from "vitest/config";

/**
 * Agent 包的测试配置。
 *
 * 覆盖率阈值与输出目录从仓库根的 config.yaml 读（经 @chaos-design/config），
 * 与 web / config 包共用同一套口径。
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
      include: ["index.mjs", "policy.mjs"],
      exclude: ["**/node_modules/**"],
      thresholds: {
        lines: config.test.coverageThreshold,
        statements: config.test.coverageThreshold,
      },
    },
  },
});
