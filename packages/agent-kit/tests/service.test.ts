import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createChatHandler,
  createDomainAgentServer,
  createUpstreamCaller,
  HttpError,
} from "../index.mjs";

/**
 * 服务骨架测试：上游调用的错误映射（stub 全局 fetch）与
 * chat 处理器 / HTTP 路由的行为。全部注入桩上游，不烧真实 token。
 */

const MODEL = "kit-test-model";

const FIXTURE_PERSONA = {
  prompt: "<role>测试人格。</role>",
  toUpstreamPayload(body, upstreamModel) {
    return {
      model: upstreamModel,
      messages: [
        { role: "system", content: FIXTURE_PERSONA.prompt },
        ...((body?.messages as unknown[]) ?? []),
      ],
      stream: false,
    };
  },
};

const upstreamOk = {
  choices: [{ message: { role: "assistant", content: "结论…" } }],
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

describe("createUpstreamCaller 错误映射", () => {
  const caller = createUpstreamCaller({
    baseUrl: "http://127.0.0.1:9",
    model: "agnes-3.0-flash",
    apiKey: "",
    timeoutMs: 5_000,
  });

  it("上游 200 + JSON：原样返回解析结果", async () => {
    stubFetch(
      async () => new Response(JSON.stringify(upstreamOk), { status: 200 }),
    );
    const payload = await caller({ model: "agnes-3.0-flash" });
    expect(payload.choices[0].message.content).toBe("结论…");
  });

  it("上游非 2xx：状态码原样透传，文案指向 NOVA_LLM_* 配置", async () => {
    stubFetch(async () => new Response("quota exceeded", { status: 429 }));
    const error = await caller({}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(429);
    expect(error.message).toContain("429");
    expect(error.message).toContain("NOVA_LLM_");
  });

  it("连接失败：504 与可读的端点信息", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const error = await caller({}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(504);
    expect(error.message).toContain("无法连接上游模型端点");
  });

  it("上游超时（TimeoutError）：504 与超时文案", async () => {
    stubFetch(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const error = await caller({}).catch((e) => e);

    expect(error.status).toBe(504);
    expect(error.message).toContain("超时");
  });

  it("上游返回非 JSON：502", async () => {
    stubFetch(
      async () => new Response("<html>bad gateway</html>", { status: 200 }),
    );
    const error = await caller({}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(502);
    expect(error.message).toContain("非 JSON");
  });
});

describe("createChatHandler", () => {
  const handleChat = createChatHandler({
    model: MODEL,
    personaLayer: FIXTURE_PERSONA,
    upstream: async () => upstreamOk,
    upstreamModel: "agnes-3.0-flash",
  });

  it("happy path：人格注入 + 上游转发 + 以登记模型 id 返回", async () => {
    let captured: { model?: string; messages?: unknown[] } | undefined;
    const handler = createChatHandler({
      model: MODEL,
      personaLayer: FIXTURE_PERSONA,
      upstream: async (payload) => {
        captured = payload as typeof captured;
        return upstreamOk;
      },
      upstreamModel: "agnes-3.0-flash",
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "你好" }],
    });

    expect(captured?.model).toBe("agnes-3.0-flash");
    expect(captured?.messages?.[0]).toEqual({
      role: "system",
      content: FIXTURE_PERSONA.prompt,
    });
    expect(completion.model).toBe(MODEL);
    expect(completion.choices[0].message.content).toBe("结论…");
  });

  it("模型标识不一致时 400，不烧上游 token（协议 §1）", async () => {
    const error = await handleChat({ model: "wrong-model" }).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
    expect(error.message).toContain(MODEL);
  });

  it("上游响应缺 choices[0].message 时 502", async () => {
    const handler = createChatHandler({
      model: MODEL,
      personaLayer: FIXTURE_PERSONA,
      upstream: async () => ({ object: "chat.completion" }),
      upstreamModel: "agnes-3.0-flash",
    });
    const error = await handler({ model: MODEL }).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(502);
  });
});

describe("createDomainAgentServer 路由", () => {
  const server = createDomainAgentServer({
    model: MODEL,
    ownedBy: "agent-kit-test",
    label: "测试专员",
    maxBodyBytes: 262_144,
    handleChat: createChatHandler({
      model: MODEL,
      personaLayer: FIXTURE_PERSONA,
      upstream: async () => upstreamOk,
      upstreamModel: "agnes-3.0-flash",
    }),
  });
  let baseUrl = "";
  let realFetch: typeof fetch;

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
    expect(body.data[0].owned_by).toBe("agent-kit-test");
  });

  it("POST /v1/chat/completions：转发上游并以登记模型 id 返回", async () => {
    const response = await realFetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "你好" }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe(MODEL);
    expect(body.choices[0].message.content).toBe("结论…");
  });

  it("请求体不是合法 JSON：400", async () => {
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
