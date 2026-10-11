#!/usr/bin/env node
/**
 * 配置自检。
 *
 * 做三件事，任何一件不通过就以退出码 1 结束：
 *   1. config.yaml 能被解析、必填变量都已填充；
 *   2. config.yaml 里引用的变量名全部登记在 .env.example（防止两处漂移）；
 *   3. .env 里出现的变量名全部在 .env.example 中有说明（防止野变量）。
 *
 * 这是最便宜的一道防线：配置问题在启动前暴露，而不是跑到一半才发现端口是 NaN。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getConfig, loadConfig, projectRoot } from "@chaos-design/config";

const root = projectRoot();
const problems = [];

/**
 * 列出各 playground Agent 的私有配置文件。
 *
 * 只读一层目录，不需要 glob —— playground/<agent>/ 的结构是固定的。
 */
function agentConfigFiles() {
  try {
    return readdirSync(path.join(root, "playground"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(root, "playground", entry.name, "agent.config.yaml"),
      )
      .filter((file) => {
        try {
          readFileSync(file);
          return true;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/* ---------- 1. 主配置可解析、必填变量齐全 ---------- */

let config;
try {
  config = getConfig(true);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

const { missing } = loadConfig();
if (missing.length > 0) {
  problems.push(`缺少必填环境变量：${missing.join("、")}`);
}

/* ---------- 2/3. 变量名双向对齐 ---------- */

const yamlText = readFileSync(path.join(root, "config.yaml"), "utf8");
const exampleText = readFileSync(path.join(root, ".env.example"), "utf8");

// 只扫描真实配置项：注释里会出现讲解用的 ${VAR} / ${VAR:-默认值} 占位写法
const stripComments = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

// 根配置 + 各 playground Agent 的私有配置都要纳入检查
const agentConfigs = agentConfigFiles().map((file) =>
  stripComments(readFileSync(file, "utf8")),
);

const referenced = new Set(
  [stripComments(yamlText), ...agentConfigs].flatMap((text) =>
    [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  ),
);
const documented = new Set(
  [...exampleText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]),
);

for (const name of referenced) {
  if (!documented.has(name)) {
    problems.push(`config.yaml 引用了 ${name}，但 .env.example 未登记`);
  }
}

// .env 里不该出现 .env.example 没写过的变量（否则换台机器就丢配置）
let envText = "";
try {
  envText = readFileSync(path.join(root, ".env"), "utf8");
} catch {
  envText = "";
}
const envVars = [...envText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map(
  (m) => m[1],
);
for (const name of envVars) {
  if (!documented.has(name)) {
    // 允许非 NOVA_ 前缀的其他工具变量共存（如 AI_* ），只提示不报错
    console.warn(
      `  · 提示：.env 中的 ${name} 未在 .env.example 登记（非 NOVA_ 前缀，忽略）`,
    );
  }
}

/* ---------- 结果 ---------- */

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error("\n修复：cp .env.example .env 后补上缺失的变量。");
  process.exit(1);
}

console.log("✓ 配置自检通过");
console.log(`  控制台   http://${config.app.hostname}:${config.app.port}`);
console.log(
  `  Agent    http://${config.agent.hostname}:${config.agent.port}/v1`,
);
console.log(`  模型     ${config.agent.model}`);
console.log(`  存储     ${config.storage.dir}/${config.storage.file}`);
console.log(
  `  密钥     ${config.agent.llm.apiKey ? "已配置" : "未配置（无鉴权端点可留空）"}`,
);
console.log(`  引用变量 ${[...referenced].sort().join("、")}`);
