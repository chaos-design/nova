import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAgentServer, HttpError } from "../index.mjs";

/**
 * Agent 入口的 HTTP 测试。
 *
 * persona.test.ts 已覆盖纯整形逻辑；这里补 IO 侧：上游调用的错误映射
 * （stub 全局 fetch，不烧真实 token）与路由分发（临时端口起真服务）。
 */

const MODEL = "nova-coder-agent";

const upstreamOk = {
  choices: [{ message: { role: "assistant", content: "实现完成…" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => impl() as never),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callUpstream 错误映射", () => {
  it("上游 200 + JSON：原样返回解析结果", async () => {
    stubFetch(
      async () => new Response(JSON.stringify(upstreamOk), { status: 200 }),
    );
    const { callUpstream } = await import("../index.mjs");
    const payload = await callUpstream({ model: "agnes-3.0-flash" });
    expect(payload.choices[0].message.content).toBe("实现完成…");
  });

  it("上游非 2xx：状态码原样透传，文案指向 NOVA_LLM_* 配置", async () => {
    stubFetch(async () => new Response("quota exceeded", { status: 429 }));
    const { callUpstream } = await import("../index.mjs");
    const error = await callUpstream({}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(429);
    expect(error.message).toContain("429");
    expect(error.message).toContain("NOVA_LLM_");
  });

  it("连接失败：504 与可读的端点信息", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { callUpstream } = await import("../index.mjs");
    const error = await callUpstream({}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(504);
    expect(error.message).toContain("无法连接上游模型端点");
  });

  it("上游超时（TimeoutError）：504 与超时文案", async () => {
    stubFetch(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const { callUpstream } = await import("../index.mjs");
    const error = await callUpstream({}).catch((e) => e);

    expect(error.status).toBe(504);
    expect(error.message).toContain("超时");
  });

  it("上游返回非 JSON：502", async () => {
    stubFetch(
      async () => new Response("<html>bad gateway</html>", { status: 200 }),
    );
    const { callUpstream } = await import("../index.mjs");
    const error = await callUpstream({}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(502);
    expect(error.message).toContain("非 JSON");
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
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("GET /v1/models：返回登记的模型 id", async () => {
    const response = await realFetch(`${baseUrl}/v1/models`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data[0].id).toBe(MODEL);
  });

  it("POST /v1/chat/completions：转发上游并以登记模型 id 返回", async () => {
    stubUpstream(
      async () => new Response(JSON.stringify(upstreamOk), { status: 200 }),
    );
    const response = await realFetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "帮我写个部署脚本。" }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe(MODEL);
    expect(body.choices[0].message.content).toBe("实现完成…");
  });

  it("模型标识不一致：400 且不触达上游", async () => {
    stubUpstream(async () => {
      throw new Error("不应触达上游");
    });
    const response = await realFetch(`${baseUrl}/v1/chat/completions`, {
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
    const response = await realFetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });

    expect(response.status).toBe(400);
  });

  it("未知路由：404", async () => {
    const response = await realFetch(`${baseUrl}/v1/other`);
    expect(response.status).toBe(404);
  });
});
