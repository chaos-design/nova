import { getConfig } from "@chaos-design/config";
import { defineConfig } from "vitest/config";

/**
 * agent-kit 的测试配置。
 *
 * 覆盖率阈值与输出目录从仓库根 config.yaml 读（经 @chaos-design/config），
 * 与 web / config / playground 各包共用同一套口径。bootstrap.mjs 的失败
 * 路径全部 process.exit，无法在进程内单测，不纳入覆盖率统计面。
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
      include: ["persona.mjs", "service.mjs"],
      exclude: ["**/node_modules/**"],
      thresholds: {
        lines: config.test.coverageThreshold,
        statements: config.test.coverageThreshold,
      },
    },
  },
});
