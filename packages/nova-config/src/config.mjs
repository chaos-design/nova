/**
 * NOVA 统一配置加载器（`@chaos-design/config`）。
 *
 * 这是**全项目唯一的配置读取入口** —— 控制台（Next.js）与 playground 里的
 * 本地 Agent 都从这里取配置，保证两边看到的是同一套命名与同一份真值。
 * 独立成一个共享包，是因为「被测的 Agent」与「测试它的控制台」都需要它，
 * 放在任何一方内部都会造成反向依赖。
 *
 * 加载顺序（后者覆盖前者）：
 *
 *   1. 根目录 `config.yaml`
 *   2. 调用方传入的私有 config（如 playground/<agent>/agent.config.yaml）
 *   3. 环境变量：进程环境 > `.env` 文件
 *
 * 敏感值与环境相关值在 config.yaml 里一律写成 `${VAR}` 或 `${VAR:-默认值}`
 * 插值，由环境变量填充 —— 配置仓库里不落任何真实密钥。
 *
 * 注意：本模块会读文件系统，**只能在服务端或 Node 进程中使用**，
 * 不要从客户端组件里 import。
 */

import { existsSync, readFileSync } from "node:fs";
import path, { dirname } from "node:path";
import yaml from "js-yaml";

/** 插值语法：${NAME} 或 ${NAME:-默认值} */
const INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** monorepo 根标记：pnpm workspace 的清单文件 */
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** 标量字面量 → 真实类型（YAML 里只有字符串会被这段处理） */
export function coerce(text) {
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  return text;
}

/**
 * 解析一份 `.env`。
 *
 * 刻意不引入 dotenv：格式本身只有十几行（KEY=VALUE、# 注释、可带引号、
 * 可带 `export` 前缀），为一个演示项目拉一个依赖不划算。
 * 行为对齐 dotenv：**已存在的进程环境变量优先**，不被文件覆盖。
 */
export function parseEnvFile(content) {
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;

    const key = body.slice(0, eq).trim();
    if (key.length === 0) continue;

    let value = body.slice(eq + 1).trim();

    // 去掉成对引号，并剥离行尾注释（仅在未加引号时）
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    entries[key] = value;
  }

  return entries;
}

/** 读取项目根的 `.env`（不存在返回空对象，不算错误） */
export function readEnvFile(root = projectRoot()) {
  try {
    return parseEnvFile(readFileSync(path.join(root, ".env"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * 项目根：`NOVA_ROOT` 可覆盖；否则 Vercel 上 `VERCEL_PATH`（函数运行目录，
 * config.yaml 已被 trace 到此）；否则从进程工作目录向上找 `pnpm-workspace.yaml`。
 *
 * monorepo 里各包（web、agent）的脚本 cwd 各不相同，而 `config.yaml`、`.env`、
 * `.nova` 等落在仓库根。向上探测 workspace 标记，让"无论从哪个包启动"都能
 * 命中同一份根配置，而不是依赖恰好等于仓库根的 cwd。
 *
 * Vercel 的函数运行目录里既没有 pnpm-workspace.yaml 也大概率没有仓库，向上
 * 探测会落空退回 cwd；VERCEL_PATH 直指被 trace 进函数的 config.yaml 所在处，
 * 因此排在向上探测之前。
 */
export function projectRoot() {
  const override =
    process.env.NOVA_ROOT?.trim() || process.env.VERCEL_PATH?.trim();
  if (override) return override;

  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd(); // 找不到标记，退回 cwd
    dir = parent;
  }
}

/**
 * 变量查找表：进程环境优先于 `.env`。
 *
 * 这样本地开发与 CI 用同一份文件，但 CI 里注入的真实密钥永远赢。
 */
export function buildEnvLookup(root = projectRoot()) {
  const fileEnv = readEnvFile(root);
  return (name) => process.env[name] ?? fileEnv[name];
}

/** 递归展开插值 */
function interpolate(node, lookup, missing) {
  if (typeof node === "string") {
    return node.replace(INTERPOLATION, (_match, name, fallback) => {
      const value = lookup(name);
      if (value !== undefined && value !== "") return value;
      if (fallback !== undefined) return fallback;
      missing.push(name);
      return "";
    });
  }

  if (Array.isArray(node)) {
    return node.map((item) => interpolate(item, lookup, missing));
  }

  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = interpolate(value, lookup, missing);
    }
    return out;
  }

  return node;
}

/** 把展开后仍是字符串的数值/布尔标量还原成真实类型 */
function coerceScalars(node) {
  if (typeof node === "string") return coerce(node);
  if (Array.isArray(node)) return node.map(coerceScalars);
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = coerceScalars(value);
    }
    return out;
  }
  return node;
}

/** 深合并：后者覆盖前者，对象递归，数组整体替换 */
export function mergeConfig(base, override) {
  if (override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (
    base === null ||
    typeof base !== "object" ||
    override === null ||
    typeof override !== "object"
  ) {
    return override;
  }

  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? mergeConfig(base[key], value) : value;
  }
  return out;
}

/** 读取并解析一份 YAML 配置文件 */
export function readYamlFile(file) {
  return yaml.load(readFileSync(file, "utf8"));
}

/**
 * 加载配置。
 *
 * @param {object}  [options]
 * @param {string}  [options.root]      项目根，默认 projectRoot()
 * @param {string}  [options.file]      主配置文件，默认 <root>/config.yaml
 * @param {object}  [options.overlay]   私有配置对象（深合并到主配置之上）
 * @param {string}  [options.overlayFile] 私有配置文件（读出来后当 overlay）
 * @param {(name: string) => string | undefined} [options.lookup] 变量查找函数
 * @returns {{ value: object, missing: string[], sources: string[] }}
 */
export function loadConfig(options = {}) {
  const root = options.root ?? projectRoot();
  const file = options.file ?? path.join(root, "config.yaml");
  const sources = [];

  let base = {};
  try {
    base = readYamlFile(file);
    sources.push(file);
  } catch (error) {
    throw new Error(
      `读取主配置失败：${file}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }

  let overlay = options.overlay;
  if (overlay === undefined && options.overlayFile) {
    overlay = readYamlFile(options.overlayFile);
    sources.push(options.overlayFile);
  }

  const lookup = options.lookup ?? buildEnvLookup(root);
  const missing = [];
  const merged = overlay === undefined ? base : mergeConfig(base, overlay);

  return {
    value: coerceScalars(interpolate(merged, lookup, missing)),
    missing: [...new Set(missing)],
    sources,
  };
}

/** 进程内缓存：配置在一次启动里只读一次 */
let cached = null;

/**
 * 取应用侧配置（缓存）。
 *
 * `force` 用于测试与需要重读的场景。
 */
export function getConfig(force = false) {
  if (cached === null || force) {
    const { value, missing } = loadConfig();
    if (missing.length > 0) {
      throw new Error(
        `缺少必填环境变量：${missing.join("、")}。请复制 .env.example 为 .env 后填写，或在环境中导出这些变量。`,
      );
    }
    cached = value;
  }
  return cached;
}

/**
 * Agent 侧配置：根配置 + playground/<agent>/agent.config.yaml。
 *
 * 不提供缓存：Agent 进程启动时只读一次配置，缓存只会让"改了配置要重启"
 * 这条规则变得含糊。
 */
export function getAgentConfig(agentDir) {
  return loadConfig({
    overlayFile: path.join(agentDir, "agent.config.yaml"),
  });
}

/** 顶层取值：'agent.llm.apiKey' → 对应值 */
export function configAt(config, dottedPath, fallback) {
  const value = dottedPath
    .split(".")
    .reduce(
      (node, key) =>
        node !== null && typeof node === "object" ? node[key] : undefined,
      config,
    );
  return value === undefined ? fallback : value;
}
