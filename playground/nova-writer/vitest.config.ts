import { getConfig } from "@chaos-design/config";
import { defineConfig } from "vitest/config";

/**
 * Agent 包的测试配置（scaffold-agent.mjs 生成）。
 *
 * 覆盖率阈值与输出目录从仓库根 config.yaml 读（经 @chaos-design/config），
 * 与 web / config / agent-kit / playground 各包共用同一套口径。
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
      include: ["index.mjs"],
      exclude: ["**/node_modules/**"],
      thresholds: {
        lines: config.test.coverageThreshold,
        statements: config.test.coverageThreshold,
      },
    },
  },
});
