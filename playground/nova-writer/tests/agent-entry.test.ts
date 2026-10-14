import { readFileSync } from "node:fs";
import {
  createChatHandler,
  findTagIssues,
  PERSONA_MAX_CHARS,
} from "@chaos-design/agent-kit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentServer, toolkit } from "../index.mjs";
import { writerTools } from "../tools.mjs";

/**
 * 文案写手入口的集成测试（scaffold-agent.mjs 生成）。
 *
 * 纯整形逻辑（人格层 / 上游错误映射）在 @chaos-design/agent-kit 包内
 * 覆盖；这里验证两件事：本 Agent 的 persona.md 结构完好，以及入口
 * 接线产物（模型标识、路由分发）在真实 HTTP 栈上行为正确。
 * 上游用全局 stub 拦截，不烧真实 token。
 */

const MODEL = "nova-writer-agent";

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
    expect(body.data[0].owned_by).toBe("nova-writer");
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

/* -------------------------------------------------------------------------- */
/* 领域工具：Agent 侧真实执行                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 文案工具的价值在于「数字是算出来的」：text_stats 的每一项都能用同样的
 * 输入复算，lookup_term 的每一条摘录都来自真实条目。测试因此断言口径
 * 而不是断言文案 —— 换个人格、改一句措辞都不该让这些用例变红。
 */

/** 按 URL 前缀分派夹具；未预期的请求直接失败，避免测试悄悄打真网 */
function stubSources(
  routes: { match: string; status?: number; body: unknown }[],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : ((input as Request | undefined)?.url ?? "");
      const hit = routes.find((route) => url.startsWith(route.match));
      if (!hit) throw new Error(`未预期的请求：${url}`);

      return new Response(
        typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body),
        { status: hit.status ?? 200 },
      );
    }),
  );
}

const wikiBody = {
  type: "standard",
  title: "注意力机制",
  description: "机器学习模型结构",
  extract:
    "注意力机制是深度学习中的一种结构，让模型在处理序列时动态关注相关部分。",
  content_urls: {
    desktop: { page: "https://zh.wikipedia.org/wiki/注意力机制" },
  },
};

describe("领域工具定义", () => {
  it("两个工具名唯一、描述非空、parameters 是 object 型 Schema", () => {
    expect(writerTools).toHaveLength(2);
    expect(new Set(writerTools.map((tool) => tool.name)).size).toBe(2);

    for (const tool of writerTools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("必填参数都出现在 properties 里", () => {
    for (const tool of writerTools) {
      for (const required of tool.parameters.required ?? []) {
        expect(Object.keys(tool.parameters.properties)).toContain(required);
      }
    }
  });

  it("工具层装出的定义是标准 OpenAI 形状，且不与 NOVA 的工具重名", () => {
    expect(toolkit.definitions.map((item) => item.function.name)).toEqual([
      "text_stats",
      "lookup_term",
    ]);
    for (const tool of writerTools) {
      expect(["external_search", "summarize"]).not.toContain(tool.name);
    }
  });
});

describe("text_stats", () => {
  const tool = writerTools.find((item) => item.name === "text_stats");

  const text = [
    "降噪耳机通勤实测。",
    "早晚高峰的地铁里，噪音长期在 80 分贝以上，这个数字足以让通话质量整体下降，而大多数入耳式耳机的被动隔音只能压掉一半左右的中低频噪声，剩下的人声与报站广播依然清晰可辨。",
    "开降噪后世界安静了。",
  ].join("\n\n");

  it("统计项是对同一段文本复算出来的真实值", async () => {
    const result = await tool.handler({ text }, { timeoutMs: 5_000 });
    const { metrics } = JSON.parse(result.content);

    expect(metrics.charsWithSpaces).toBe(text.length);
    expect(metrics.paragraphs).toBe(3);
    expect(metrics.sentences).toBe(3);
    // 平均句长 = 三句长度均值，独立复算一遍
    const lengths = text
      .split(/[。！？!?…；;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((sentence) => sentence.length);
    expect(metrics.avgSentenceChars).toBe(
      Math.round(
        (lengths.reduce((sum, value) => sum + value, 0) / lengths.length) * 10,
      ) / 10,
    );
  });

  it("超长句被列出来并给出断句建议", async () => {
    const result = await tool.handler(
      { text, long_sentence_threshold: 40 },
      { timeoutMs: 5_000 },
    );
    const { metrics } = JSON.parse(result.content);

    expect(metrics.overThresholdSentences).toBe(1);
    expect(metrics.longSentences[0].chars).toBeGreaterThan(40);
    expect(metrics.suggestions.join("")).toContain("断句");
  });

  it("重复出现的二字组被识别（不用分词词典也能暴露重复用词）", async () => {
    const repeated = "降噪耳机很好用。降噪耳机在地铁里好用。降噪耳机值得买。";
    const result = await tool.handler({ text: repeated }, { timeoutMs: 5_000 });
    const { metrics } = JSON.parse(result.content);

    // 2 字滑窗下「降噪 / 噪耳 / 耳机」都出现 3 次，重复用词必须被点到
    expect(metrics.topBigrams).toContainEqual({ term: "降噪", count: 3 });
    expect(metrics.topBigrams.every((item) => item.count >= 2)).toBe(true);
  });

  it("空文本：可读错误，不返回一份空报告", async () => {
    const result = await tool.handler({ text: "   " }, { timeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("text 不能为空");
  });
});

describe("lookup_term", () => {
  const tool = writerTools.find((item) => item.name === "lookup_term");

  it("命中条目：返回规范标题、摘录与可核验链接", async () => {
    stubSources([
      {
        match: "https://zh.wikipedia.org/api/rest_v1/page/summary/",
        body: wikiBody,
      },
    ]);

    const result = await tool.handler(
      { term: "注意力机制" },
      { timeoutMs: 5_000 },
    );
    const parsed = JSON.parse(result.content);

    expect(parsed.title).toBe("注意力机制");
    expect(parsed.extract).toContain("注意力机制");
    expect(parsed.url).toContain("zh.wikipedia.org");
    expect(parsed.isDisambiguation).toBe(false);
  });

  it("未命中（404）：如实说明，并给出降级路径", async () => {
    stubSources([
      {
        match: "https://zh.wikipedia.org/api/rest_v1/page/summary/",
        status: 404,
        body: { type: "not_found" },
      },
    ]);

    const result = await tool.handler(
      { term: "量子纠缠驱动的调度协议" },
      { timeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("未命中");
    expect(result.content).toContain("external_search");
  });

  it("消歧义页会被标注（正文首次出现时必须限定语境）", async () => {
    stubSources([
      {
        match: "https://zh.wikipedia.org/api/rest_v1/page/summary/",
        body: { ...wikiBody, type: "disambiguation", title: "苹果" },
      },
    ]);

    const result = await tool.handler({ term: "苹果" }, { timeoutMs: 5_000 });
    const parsed = JSON.parse(result.content);

    expect(parsed.isDisambiguation).toBe(true);
    expect(parsed.note).toContain("消歧义");
  });

  it("空参数与超长词条名：本地拦住，不发请求", async () => {
    stubSources([]);
    const empty = await tool.handler({ term: "" }, { timeoutMs: 5_000 });
    const tooLong = await tool.handler(
      { term: "字".repeat(61) },
      { timeoutMs: 5_000 },
    );

    expect(empty.ok).toBe(false);
    expect(tooLong.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("工具循环：本地工具就地执行，NOVA 的工具原样透传", () => {
  function makeHandler(responses: { toolCall?: object; text: string }[]) {
    const payloads: Record<string, unknown>[] = [];
    let index = 0;

    const handler = createChatHandler({
      model: MODEL,
      personaLayer: {
        prompt: "测试人格",
        toUpstreamPayload: (body, upstreamModel) => ({
          model: upstreamModel,
          messages: body.messages,
          ...(body.tools?.length
            ? { tools: body.tools, tool_choice: "auto" }
            : {}),
          stream: false,
        }),
      },
      upstreamModel: "agnes-3.0-flash",
      toolkit,
      upstream: async (payload) => {
        payloads.push(payload);
        const step = responses[Math.min(index, responses.length - 1)];
        index += 1;

        return {
          choices: [
            {
              message: step.toolCall
                ? {
                    role: "assistant",
                    content: "",
                    tool_calls: [step.toolCall],
                  }
                : { role: "assistant", content: step.text },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        };
      },
    });

    return { handler, payloads };
  }

  it("上游要求 text_stats → 就地算出真实统计 → 下一轮据实交稿", async () => {
    const { handler, payloads } = makeHandler([
      {
        toolCall: {
          id: "call_stats_1",
          type: "function",
          function: {
            name: "text_stats",
            arguments: JSON.stringify({
              text: "降噪耳机通勤实测。开降噪后世界安静了。",
            }),
          },
        },
      },
      { text: "终稿：全文 18 字，两句，已按建议调整。" },
    ]);

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "写一段试用文案并体检。" }],
    });

    expect(payloads).toHaveLength(2);
    expect(completion.choices[0].message.content).toContain("终稿");

    const toolMessage = payloads[1].messages.at(-1);
    expect(toolMessage.role).toBe("tool");
    expect(JSON.parse(toolMessage.content).metrics.sentences).toBe(2);
  });

  it("NOVA 的工具调用原样回传，不会被本 Agent 吞掉", async () => {
    const { handler, payloads } = makeHandler([
      {
        text: "",
        toolCall: {
          id: "call_search_1",
          type: "function",
          function: {
            name: "external_search",
            arguments: '{"query":"降噪耳机 降噪深度"}',
          },
        },
      },
    ]);

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "找点一手资料。" }],
      tools: [
        {
          type: "function",
          function: {
            name: "external_search",
            description: "NOVA 的检索",
            parameters: { type: "object" },
          },
        },
        {
          type: "function",
          function: {
            name: "summarize",
            description: "NOVA 的压缩",
            parameters: { type: "object" },
          },
        },
      ],
    });

    // 只调用了一次上游：本地没有可执行的工具，直接透传
    expect(payloads).toHaveLength(1);
    expect(
      completion.choices[0].message.tool_calls.map(
        (call) => call.function.name,
      ),
    ).toEqual(["external_search"]);
    // 本 Agent 的工具也一并声明给上游，但归属清晰
    expect(payloads[0].tools.map((tool) => tool.function.name)).toEqual([
      "external_search",
      "summarize",
      "text_stats",
      "lookup_term",
    ]);
  });
});
