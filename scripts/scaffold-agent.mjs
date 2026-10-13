#!/usr/bin/env node

/**
 * 快捷开发脚手架：一键生成一个可接入 NOVA 的领域 Agent。
 *
 * 用法（在仓库根执行）：
 *   pnpm run agent:new -- --name nova-writer [--codename 文案写手] [--port 43113]
 *
 * 生成 `playground/<name>/` 全套：薄入口 index.mjs（复用
 * @chaos-design/agent-kit）、persona.md 模板（XML 标签分节）、
 * agent.config.yaml、package.json、vitest 集成测试与覆盖率配置。
 * 生成前校验：名称合法（nova- 前缀小写连字符）、目标目录不存在、
 * id / 模型标识 / 端口与既有登记及 playground 各包不冲突。
 *
 * 刻意不做的事：不自动写入 local-agents.ts（登记必须随仓库走、
 * 经 code review，AGENTS.md 约束 6），只在收尾打印可粘贴的登记片段；
 * 不自动执行 pnpm install（生成后的第一步由开发者显式触发）。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYGROUND_DIR = join(ROOT, "playground");
const LOCAL_AGENTS_FILE = join(
  ROOT,
  "packages/web/src/lib/nova/local-agents.ts",
);

/** 端口建议起点：43110（nova-local）/ 43111（调研）/ 43112（工程）之后 */
const PORT_BASE = 43113;

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                    */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = { name: "", codename: "", port: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--name") {
      args.name = String(value ?? "");
      i += 1;
    } else if (flag === "--codename") {
      args.codename = String(value ?? "");
      i += 1;
    } else if (flag === "--port") {
      args.port = Number(value ?? 0);
      i += 1;
    } else if (flag === "--help" || flag === "-h") {
      return { help: true };
    }
  }
  return { help: false, ...args };
}

function printHelp() {
  console.log(`用法：pnpm run agent:new -- --name nova-writer [选项]

必填：
  --name <nova-xxx>    Agent 目录名与身份前缀（nova- 小写连字符，如 nova-writer）

可选：
  --codename <中文代号>  日志与档案展示用（默认取 name 后缀）
  --port <端口>          监听端口（默认自动分配 43113 起的最小空闲端口）`);
}

/* -------------------------------------------------------------------------- */
/* 冲突扫描                                                                    */
/* -------------------------------------------------------------------------- */

/** 收集 local-agents.ts 里已登记的 id、模型与 127.0.0.1 端口（文本扫描，不动 TS） */
function scanRegistered() {
  const ids = new Set();
  const models = new Set();
  const ports = new Set();

  if (existsSync(LOCAL_AGENTS_FILE)) {
    const text = readFileSync(LOCAL_AGENTS_FILE, "utf8");
    for (const match of text.matchAll(/id:\s*"([^"]+)"/g)) ids.add(match[1]);
    for (const match of text.matchAll(/model:\s*"([^"]+)"/g))
      models.add(match[1]);
    for (const match of text.matchAll(
      /endpoint:\s*"http:\/\/127\.0\.0\.1:(\d+)/g,
    )) {
      ports.add(Number(match[1]));
    }
    // env 兜底形态的端点读不到端口：登记时以显式字面量为准
  }

  return { ids, models, ports };
}

/** 收集 playground 各包 agent.config.yaml 里声明的端口（含 ${VAR:-4311x} 形态） */
function scanPlaygroundPorts() {
  const ports = new Set();
  if (!existsSync(PLAYGROUND_DIR)) return ports;

  for (const name of readdirSync(PLAYGROUND_DIR)) {
    const file = join(PLAYGROUND_DIR, name, "agent.config.yaml");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/port:\s*\$\{\w+:-(\d+)\}/g)) {
      ports.add(Number(match[1]));
    }
    for (const match of text.matchAll(/^\s*port:\s*(\d+)\s*$/gm)) {
      ports.add(Number(match[1]));
    }
  }
  return ports;
}

/* -------------------------------------------------------------------------- */
/* 生成模板                                                                    */
/* -------------------------------------------------------------------------- */

const personaTemplate = (
  codename,
) => `<!-- ${codename} 的人格提示词：XML 自定义标签分节，标签原文会随请求发给上游大模型。 -->

<role>
你是 NOVA 领域专家 Agent「${codename}」，专职：〔一句话写清这个 Agent 的领域边界〕。
</role>

<workflow>
1. 先判断请求是否落在本领域内；不属于的，礼貌说明边界并建议改找谁。
2. 〔领域内的标准动作，按顺序写 2~4 条〕。
3. 给结论时保留可核验的依据；不确定的部分明确说"未确认"，不编造。
</workflow>

<style>
- 用中文回复，结论先行，过程从简。
- 工具调用参数必须显式给全，不臆造字段。
- 上游检不到结果时如实报告，不虚构内容。
</style>
`;

const entryTemplate = (codename, ownedBy, className) => `#!/usr/bin/env node

/**
 * ${className} 入口：${codename}的 OpenAI 兼容人格代理端点。
 *
 * 启动：node playground/${className}/index.mjs
 *（或 pnpm --filter @chaos-design/${className} start）
 *
 * 共享基建（配置引导 / 人格加载 / 上游调用 / HTTP 路由）在
 * @chaos-design/agent-kit；本入口只保留本 Agent 的身份常量与启动日志。
 * 人格在 persona.md 里改，不动代码。
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "@chaos-design/config";
import {
  bootstrapAgent,
  createChatHandler,
  createDomainAgentServer,
  createUpstreamCaller,
  HttpError,
} from "@chaos-design/agent-kit";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

const boot = bootstrapAgent({ agentDir: AGENT_DIR });

const MODEL = boot.config.agent.model;
const PORT = boot.config.agent.port;
const HOSTNAME = boot.config.agent.hostname;

const upstream = createUpstreamCaller(boot.upstream);

/** 处理一次 chat/completions；上游可经 deps 注入（测试用） */
export const handleChat = createChatHandler({
  model: MODEL,
  personaLayer: boot.persona,
  upstream,
  upstreamModel: boot.upstream.model,
});

/** 转发一次补全给上游真实大模型；测试经全局 fetch stub 覆盖 */
export const callUpstream = upstream;

export { HttpError };

export function createAgentServer() {
  return createDomainAgentServer({
    model: MODEL,
    ownedBy: "${ownedBy}",
    label: "${codename}",
    maxBodyBytes: boot.config.agent.maxBodyBytes,
    handleChat,
  });
}

// 仅直接执行时监听端口；被测试 import 时不自动启动
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAgentServer().listen(PORT, HOSTNAME, () => {
    console.log(
      \`NOVA ${codename}已启动：http://\${HOSTNAME}:\${PORT}/v1（模型 \${MODEL}）\`,
    );
    console.log(
      \`配置来源：\${boot.sources.map((s) => s.replace(projectRoot(), ".")).join(" · ")}\`,
    );
    console.log(
      \`人格提示词：persona.md（\${boot.persona.prompt.length} 字符，XML 标签分节）\`,
    );
    console.log(
      \`上游真实大模型：\${boot.upstream.model} @ \${boot.upstream.baseUrl}\`,
    );
  });
}
`;

const agentConfigTemplate = (
  model,
  port,
  envName,
) => `# =============================================================================
# 领域 Agent 的私有配置（覆盖层，由 scaffold-agent.mjs 生成）
# =============================================================================
# 由 index.mjs 经 @chaos-design/config 深合并到项目根 config.yaml 之上。
# 只写需要覆盖的键：上游大模型端点沿用根配置的 agent.llm
# （.env 的 NOVA_LLM_BASE_URL / NOVA_LLM_MODEL / NOVA_LLM_API_KEY），
# 本服务自身不持有任何密钥。
# =============================================================================

agent:
  # 模型标识：必须与 GET /v1/models 返回的 id、local-agents.ts 的登记完全一致
  model: ${model}
  # 监听端口：脚手架已校验无冲突，可用环境变量覆盖
  port: \${${envName}:-${port}}
  # 对话验证会把多轮历史整轮回传，32KB 对中文历史偏紧，放宽到 256KB
  maxBodyBytes: 262144
`;

const packageJsonTemplate = (suffix, codename) =>
  `${JSON.stringify(
    {
      name: `@chaos-design/nova-${suffix}`,
      version: "0.1.0",
      private: true,
      license: "Apache-2.0",
      description: `NOVA 领域专家 Agent：${codename}（OpenAI 兼容人格代理端点）`,
      type: "module",
      exports: { ".": "./index.mjs" },
      scripts: {
        start: "node index.mjs",
        test: "vitest run",
        "test:unit": "vitest run",
        "test:coverage": "vitest run --coverage",
      },
      dependencies: {
        "@chaos-design/agent-kit": "workspace:*",
        "@chaos-design/config": "workspace:*",
      },
      devDependencies: {
        "@vitest/coverage-v8": "^3.2.7",
        vitest: "^3.2.7",
      },
    },
    null,
    2,
  )}\n`;

const vitestConfigTemplate = `import { getConfig } from "@chaos-design/config";
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
`;

const entryTestTemplate = (
  model,
  ownedBy,
  codename,
) => `import { readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PERSONA_MAX_CHARS, findTagIssues } from "@chaos-design/agent-kit";
import { createAgentServer } from "../index.mjs";

/**
 * ${codename}入口的集成测试（scaffold-agent.mjs 生成）。
 *
 * 纯整形逻辑（人格层 / 上游错误映射）在 @chaos-design/agent-kit 包内
 * 覆盖；这里验证两件事：本 Agent 的 persona.md 结构完好，以及入口
 * 接线产物（模型标识、路由分发）在真实 HTTP 栈上行为正确。
 * 上游用全局 stub 拦截，不烧真实 token。
 */

const MODEL = "${model}";

const upstreamOk = {
  choices: [{ message: { role: "assistant", content: "已完成。" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("persona.md 与入口的一致性", () => {
  it("入口加载的就是仓库里的 persona.md（trim 后、标签配对、长度合规）", () => {
    const filePrompt = readFileSync(
      new URL("../persona.md", import.meta.url),
      "utf8",
    )
      .replace(/^\\uFEFF/, "")
      .trim();

    expect(filePrompt.length).toBeGreaterThan(0);
    expect(filePrompt.length).toBeLessThanOrEqual(PERSONA_MAX_CHARS);
    expect(findTagIssues(filePrompt)).toEqual([]);
  });
});

describe("HTTP 路由", () => {
  const server = createAgentServer();
  let baseUrl = "";
  let realFetch: typeof fetch;

  /**
   * 只拦「发往上游」的请求：指向本测试服务的请求走真实网络栈，
   * 否则连服务本身的 HTTP 层都没测到。
   */
  function stubUpstream(impl: () => Promise<unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: unknown) => {
        const url =
          typeof input === "string"
            ? input
            : ((input as Request | undefined)?.url ?? "");
        if (url.startsWith(baseUrl)) {
          return realFetch(input as RequestInfo, init as RequestInit);
        }
        return impl() as never;
      }),
    );
  }

  beforeAll(async () => {
    realFetch = globalThis.fetch;
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = \`http://127.0.0.1:\${port}\`;
  });

  afterAll(() => {
    server.close();
    vi.unstubAllGlobals();
  });

  it("GET /v1/models：返回登记的模型 id", async () => {
    const response = await realFetch(\`\${baseUrl}/v1/models\`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data[0].id).toBe(MODEL);
    expect(body.data[0].owned_by).toBe("${ownedBy}");
  });

  it("POST /v1/chat/completions：转发上游并以登记模型 id 返回", async () => {
    stubUpstream(
      async () => new Response(JSON.stringify(upstreamOk), { status: 200 }),
    );
    const response = await realFetch(\`\${baseUrl}/v1/chat/completions\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "你好。" }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe(MODEL);
    expect(body.choices[0].message.content).toBe("已完成。");
  });

  it("模型标识不一致：400 且不触达上游", async () => {
    stubUpstream(async () => {
      throw new Error("不应触达上游");
    });
    const response = await realFetch(\`\${baseUrl}/v1/chat/completions\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "wrong-model", messages: [] }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain(MODEL);
  });

  it("请求体不是合法 JSON：400", async () => {
    stubUpstream(async () => {
      throw new Error("不应触达上游");
    });
    const response = await realFetch(\`\${baseUrl}/v1/chat/completions\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });

    expect(response.status).toBe(400);
  });

  it("未知路由：404", async () => {
    const response = await realFetch(\`\${baseUrl}/v1/other\`);
    expect(response.status).toBe(404);
  });
});
`;

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) {
  printHelp();
  process.exit(0);
}

const name = parsed.name.trim();
if (!/^[a-z][a-z0-9-]*$/.test(name) || !name.startsWith("nova-")) {
  fail(
    `名称必须是 nova- 前缀的小写连字符形式（如 nova-writer），收到：${name || "(missing)"}\n` +
      `  提示：pnpm run agent:new -- --name nova-writer`,
  );
}
const suffix = name.slice("nova-".length);
if (suffix.length === 0) {
  fail(`名称不能只有 nova- 前缀。`);
}

const targetDir = join(PLAYGROUND_DIR, name);
if (existsSync(targetDir)) {
  fail(`目标目录已存在：playground/${name}`);
}

const codename = parsed.codename?.trim() || `NOVA-${suffix.toUpperCase()}`;
const envName = `NOVA_${suffix.toUpperCase().replace(/-/g, "_")}_PORT`;
const model = `nova-${suffix}-agent`;
const id = `agt-local-${suffix}`;

const registered = scanRegistered();
if (registered.ids.has(id)) {
  fail(`登记 id 冲突：${id} 已在 local-agents.ts 登记，请换一个名字。`);
}
if (registered.models.has(model)) {
  fail(`模型标识冲突：${model} 已被登记使用，请换一个名字。`);
}

const usedPorts = new Set([...registered.ports, ...scanPlaygroundPorts()]);
let port = parsed.port;
if (port && usedPorts.has(port)) {
  fail(`端口冲突：${port} 已被占用（local-agents.ts 或 playground 各包）。`);
}
if (!port) {
  port = PORT_BASE;
  while (usedPorts.has(port)) port += 1;
}

/* --- 写盘 --- */
mkdirSync(join(targetDir, "tests"), { recursive: true });

const files = [
  ["package.json", packageJsonTemplate(suffix, codename)],
  ["agent.config.yaml", agentConfigTemplate(model, port, envName)],
  ["index.mjs", entryTemplate(codename, name, name)],
  ["persona.md", personaTemplate(codename)],
  ["vitest.config.ts", vitestConfigTemplate],
  ["tests/agent-entry.test.ts", entryTestTemplate(model, name, codename)],
];
for (const [file, content] of files) {
  writeFileSync(join(targetDir, file), content);
}

const registeredAt = new Date().toISOString().slice(0, 10);
const snippet = [
  "往 packages/web/src/lib/nova/local-agents.ts 的 LOCAL_AGENTS 追加（登记需随仓库走，经 code review）：",
  "",
  "  {",
  `    id: "${id}",`,
  `    name: "NOVA-${suffix.toUpperCase()}",`,
  `    codename: "${codename}",`,
  `    model: "${model}",`,
  `    owner: "本地开发",`,
  `    version: "v0.1.0",`,
  `    endpoint: "http://127.0.0.1:${port}/v1",`,
  `    apiKeyEnv: "LLM_API_KEY",`,
  `    tagline: "〔一句话写清领域边界：这句话会进意图分类的提示词〕",`,
  `    registeredAt: "${registeredAt}T00:00:00.000Z",`,
  "  },",
].join("\n");

console.log(`✓ 已生成 playground/${name}/（${codename}，端口 ${port}）`);
console.log("");
console.log("下一步：");
console.log(
  `  1 · 编辑 playground/${name}/persona.md：把〔占位〕替换成真实领域人格`,
);
console.log("  2 · pnpm install（链接新包依赖）");
console.log(`  3 · pnpm --filter @chaos-design/${name} test（生成物冒烟）`);
console.log(`  4 · pnpm --filter @chaos-design/${name} start 启动端点`);
console.log(
  `  5 · 控制台「接入新 Agent」探测 ${`http://127.0.0.1:${port}/v1`}，或直接登记：`,
);
console.log("");
console.log(snippet);
