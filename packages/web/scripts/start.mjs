#!/usr/bin/env node
/**
 * 生产阶段：启动已构建的 NOVA 控制台。
 *
 * 与 dev.mjs 同源地读配置，保证「开发跑的端口」和「生产跑的端口」是同一个配置项。
 * 需要先执行 npm run build。
 */

import { spawn } from "node:child_process";
import { getConfig } from "@chaos-design/config";

const config = getConfig();
const { port, hostname } = config.app;

console.log(`▸ 启动生产服务：http://${hostname}:${port}`);

const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    String(port),
    "--hostname",
    hostname,
  ],
  { stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
