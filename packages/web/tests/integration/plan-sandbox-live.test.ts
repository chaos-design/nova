import { existsSync, promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readSseStream, type SandboxEvent } from "@/lib/nova";

vi.mock("server-only", () => ({}));

/**
 * [V-12] 沙盒全链路（桩模型）。
 *
 * 用进程内的 OpenAI 兼容桩替代真实模型，把「路由校验 → 真实执行器 →
 * 工具循环 → 观测评分 → 落库发证 → SSE 输出」整条链路跑一遍：
 * 分数必须由桩脚本产生的调用计数派生，而不是任何预置值。
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

let tmp: string;
let server: Server;
let endpoint: string;
let sandboxPost: (request: Request) => Promise<Response>;
let store: typeof import("@/lib/nova/run-store");

let firstRun: {
  status: number;
  contentType: string | null;
  events: SandboxEvent[];
  raw: string;
};
let secondRun: { events: SandboxEvent[] };

/** 桩的响应脚本：两次检索 → 一次压缩 → 交卷 */
let scriptIndex = 0;

function resetScript() {
  scriptIndex = 0;
}

function completion(message: Record<string, unknown>, finish = "stop") {
  return {
    model: "stub-model",
    choices: [
      {
        message: { role: "assistant", content: null, ...message },
        finish_reason: finish,
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

function scriptedResponse(index: number) {
  if (index === 0) {
    return completion(
      {
        tool_calls: [
          {
            id: "call_alpha",
            type: "function",
            function: {
              name: "external_search",
              arguments: JSON.stringify({ query: "alpha", limit: 5 }),
            },
          },
          {
            id: "call_beta",
            type: "function",
            function: {
              name: "external_search",
              arguments: JSON.stringify({ query: "beta", limit: 5 }),
            },
          },
        ],
      },
      "tool_calls",
    );
  }
  if (index === 1) {
    return completion(
      {
        tool_calls: [
          {
            id: "call_summary",
            type: "function",
            function: {
              name: "summarize",
              arguments: JSON.stringify({
                records: ["alpha 结果", "beta 结果"],
              }),
            },
          },
        ],
      },
      "tool_calls",
    );
  }
  return completion({ content: "交叉验证完成：两个独立来源结论一致。" });
}

async function callSandbox(chaos: unknown[]) {
  const response = await sandboxPost(
    new Request("http://127.0.0.1:3234/api/sandbox/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agt-local-research",
        systemPrompt: "你是受控 Agent，必须显式声明工具参数。",
        environment: "deterministic",
        chaos,
        maxSteps: 6,
        overrides: {
          endpoint,
          model: "stub-model",
          apiKey: "stub-key",
        },
      }),
    }),
  );

  const body = response.body;
  if (!body) throw new Error("响应没有 body");

  // 一份给事件解析，一份留原始帧：既验证语义也验证线上格式
  const [forEvents, forRaw] = body.tee();
  const events: SandboxEvent[] = [];
  const [raw] = await Promise.all([
    new Response(forRaw).text(),
    readSseStream<SandboxEvent>(
      forEvents,
      new AbortController().signal,
      (event) => {
        events.push(event);
        return "continue";
      },
    ),
  ]);

  return {
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    events,
    raw,
  };
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nova-live-"));
  await fs.copyFile(
    path.join(REPO_ROOT, "config.yaml"),
    path.join(tmp, "config.yaml"),
  );
  process.env.NOVA_ROOT = tmp;
  delete process.env.VERCEL;

  server = createServer(async (request, response) => {
    // 请求体对断言不重要，桩只按脚本顺序回复
    request.resume();
    const payload = scriptedResponse(scriptIndex);
    scriptIndex += 1;

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("桩服务未取得端口");
  }
  endpoint = `http://127.0.0.1:${address.port}/v1`;

  sandboxPost = (await import("@/app/api/sandbox/run/route")).POST;
  store = await import("@/lib/nova/run-store");

  resetScript();
  firstRun = await callSandbox([]);

  resetScript();
  secondRun = await callSandbox([
    { kind: "latency", enabled: true, intensity: 0 },
  ]);
}, 60_000);

afterAll(async () => {
  delete process.env.NOVA_ROOT;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (tmp && existsSync(tmp)) {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  vi.resetModules();
});

describe("[V-12] 沙盒全链路（桩模型）", () => {
  it("SSE 输出为 data: 帧，事件以 meta(live) 开始并以 done 结束", () => {
    expect(firstRun.status).toBe(200);
    expect(firstRun.contentType).toContain("text/event-stream");

    expect(firstRun.events[0]).toMatchObject({
      type: "meta",
      executor: "live",
      agentId: "agt-local-research",
      model: "stub-model",
    });
    expect(firstRun.events.at(-1)?.type).toBe("done");
    expect(firstRun.events.some((event) => event.type === "error")).toBe(false);

    const frames = firstRun.raw.split("\n\n").filter(Boolean);
    expect(frames.length).toBe(firstRun.events.length);
    for (const frame of frames) {
      expect(frame.startsWith("data: ")).toBe(true);
      expect(() => JSON.parse(frame.slice(6))).not.toThrow();
    }
  });

  it("模型调用、工具调用与检索式计数与桩脚本一致", () => {
    const done = firstRun.events.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;

    expect(done.result.success).toBe(true);
    expect(done.result.observations).toMatchObject({
      modelCalls: 3,
      toolCalls: 3,
      validArgCalls: 3,
      injected: 0,
      recoveries: 0,
      distinctQueries: 2,
      summarizeCalls: 1,
      finished: true,
      injectionObeyed: false,
      maxSteps: 6,
    });
    expect(done.result.score).toBe(100);
    expect(done.result.usage.totalTokens).toBe(360);
  });

  it("综合评分由观测派生：S 级 96.3 分，并发证落库", async () => {
    const done = firstRun.events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("缺少 done 事件");

    const runs = await store.listRuns();
    const first = runs.at(-1);

    expect(first?.agentId).toBe("agt-local-research");
    expect(first?.success).toBe(true);
    expect(first?.compositeScore).toBe(96.3);
    expect(first?.grade).toBe("S");
    expect(first?.certificateId).toMatch(/^NOVA-CERT-\d{4}-0001$/);
  });

  it("零强度混沌不注入故障，也不扣分", () => {
    const done = secondRun.events.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;

    expect(done.result.observations.injected).toBe(0);
    expect(done.result.success).toBe(true);
    expect(
      secondRun.events.some(
        (event) => event.type === "step" && event.step.level === "error",
      ),
    ).toBe(false);
  });

  it("两次运行都落在临时目录，证书序号连续递增", async () => {
    const runs = await store.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs.map((item) => item.certificateId)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/-0001$/),
        expect.stringMatching(/-0002$/),
      ]),
    );

    const onDisk = JSON.parse(
      await fs.readFile(path.join(tmp, ".nova", "runs.json"), "utf8"),
    ) as { runs: unknown[] };
    expect(onDisk.runs).toHaveLength(2);
  });
});
