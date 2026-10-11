#!/usr/bin/env node
/**
 * 开发阶段：一条命令同时拉起控制台与本地 Agent。
 *
 * 刻意不引入 concurrently —— 两个子进程 + 信号转发二十行就写完了，
 * 为一个演示项目加一个进程管理依赖不划算。
 *
 * 任一个子进程退出即整体退出，避免"控制台关了 Agent 还在跑"这种残留。
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { getConfig, projectRoot } from "@chaos-design/config";

const config = getConfig();
const root = projectRoot();
const webDir = path.join(root, "packages", "web");

const children = [
  {
    label: "console",
    color: "\u001b[36m",
    // next 的 bin 在 packages/web/node_modules 下，必须从包目录启动
    script: path.join(webDir, "scripts", "dev.mjs"),
    cwd: webDir,
  },
  {
    label: "agent",
    color: "\u001b[35m",
    script: path.join(root, "playground", config.agent.name, "index.mjs"),
    cwd: root,
  },
].map(({ label, color, script, cwd }) => {
  const child = spawn(process.execPath, [script], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const prefix = `${color}[${label}]\u001b[0m `;
  const pipe = (stream, target) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    console.log(`${prefix}退出（code=${code ?? "-"} signal=${signal ?? "-"}）`);
    shutdown(signal ? 1 : (code ?? 0));
  });

  return child;
});

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  }
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

console.log(
  `▸ 控制台 http://${config.app.hostname}:${config.app.port} · Agent http://${config.agent.hostname}:${config.agent.port}/v1`,
);
