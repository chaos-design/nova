#!/usr/bin/env node
/**
 * 开发阶段：启动 NOVA 控制台。
 *
 * 为什么不用 `next dev --port 3234` 直接写在 package.json 里：
 * 端口与监听地址是配置项，应当从 config.yaml + .env 读，
 * 而不是在 npm script 里硬编码一份、在配置文件里再写一份。
 *
 * 子进程以继承 stdio 的方式运行，因此 Turbopack 的热重载与日志照常工作。
 */

import { spawn } from "node:child_process";
import { getConfig, projectRoot, readEnvFile } from "@chaos-design/config";

const config = getConfig();
const { port, hostname, name } = config.app;

console.log(
  `▸ 启动 ${name} 控制台：http://${hostname}:${port}（${config.app.env}）`,
);

// Next 只加载包内 .env*，而配置事实来源在仓库根：把根 .env 并入子进程环境，
// local-agents 与 route 里的 process.env.NOVA_* 才读得到（进程环境优先于文件）
const rootEnv = readEnvFile(projectRoot());

const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--port",
    String(port),
    "--hostname",
    hostname,
  ],
  { stdio: "inherit", env: { ...rootEnv, ...process.env } },
);

// 父进程收到终止信号时先传给子进程，避免留下孤儿 dev server
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
