import { readFileSync } from "node:fs";
import { findTagIssues, PERSONA_MAX_CHARS } from "@chaos-design/agent-kit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentServer } from "../index.mjs";

/**
 * 调研专员入口的集成测试。
 *
 * 纯整形逻辑（人格层 / 上游错误映射）已上移 @chaos-design/agent-kit
 * 并在其包内覆盖；这里验证两件事：本 Agent 的 persona.md 结构完好，
 * 以及入口接线产物（模型标识、路由分发）在真实 HTTP 栈上行为正确。
 * 上游用全局 stub 拦截，不烧真实 token。
 */

const MODEL = "nova-research-agent";

const upstreamOk = {
  choices: [{ message: { role: "assistant", content: "调研结论…" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("persona.md 与入口的一致性", () => {
  it("入口加载的就是仓库里的 persona.md（trim 后、标签配对、长度合规）", () => {
    const filePrompt = readFileSync(
      new URL("../persona.md", import.meta.url),
      "utf8",
    )
      .replace(/^\uFEFF/, "")
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
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
    vi.unstubAllGlobals();
  });

  it("GET /v1/models：返回登记的模型 id", async () => {
    const response = await realFetch(`${baseUrl}/v1/models`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data[0].id).toBe(MODEL);
    expect(body.data[0].owned_by).toBe("nova-research");
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
        messages: [{ role: "user", content: "帮我调研一下。" }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe(MODEL);
    expect(body.choices[0].message.content).toBe("调研结论…");
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
