import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatHandler } from "../service.mjs";
import {
  createDomainToolkit,
  defineTool,
  fetchJson,
  parseToolArgs,
  TOOL_RESULT_CAP,
} from "../tools.mjs";

/**
 * 领域工具层测试。
 *
 * 这一层承担的是「Agent 自带工具」与「NOVA 的工具」之间的分界，因此
 * 用例集中在三件事上：执行边界的归属是否正确、失败是否被如实回灌、
 * 循环是否有硬护栏。全部用桩上游与桩 fetch，不烧真实 token、不打真网。
 */

const MODEL = "kit-tools-model";

const persona = {
  prompt: "<role>工具层测试</role>",
  toUpstreamPayload(body, upstreamModel) {
    return {
      model: upstreamModel,
      messages: [
        { role: "system", content: this.prompt },
        ...(body?.messages ?? []),
      ],
      ...(body?.tools?.length
        ? { tools: body.tools, tool_choice: "auto" }
        : {}),
      stream: false,
    };
  },
};

const novaTools = [
  {
    type: "function",
    function: {
      name: "external_search",
      description: "NOVA 的检索",
      parameters: {},
    },
  },
  {
    type: "function",
    function: { name: "summarize", description: "NOVA 的压缩", parameters: {} },
  },
];

function callOf(name, args, id = `call_${name}`) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeToolkit(handler, options = {}) {
  return createDomainToolkit({
    tools: [
      defineTool({
        name: "lookup_local",
        description: "本地工具",
        parameters: { type: "object", properties: {} },
        handler,
      }),
    ],
    ...options,
  });
}

/** 桩上游收到的载荷：只声明断言用到的字段 */
interface UpstreamPayload {
  tools?: { function: { name: string } }[];
  messages: { role: string; content?: unknown }[];
}

const usageOf = (prompt, completion) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defineTool", () => {
  it("工具名不合法直接拒绝（模型只认名字，名字错等于工具不存在）", () => {
    expect(() =>
      defineTool({ name: "查询天气", handler: async () => ({}) }),
    ).toThrow(/工具名不合法/);
    expect(() => defineTool({ name: "", handler: async () => ({}) })).toThrow(
      /工具名不合法/,
    );
  });

  it("缺少 handler 直接拒绝：领域工具必须在 Agent 侧真实执行", () => {
    expect(() => defineTool({ name: "noop" })).toThrow(/缺少 handler/);
  });
});

describe("createDomainToolkit", () => {
  it("重名工具拒绝装配（名字是模型选择工具的唯一依据）", () => {
    const tool = defineTool({
      name: "dup",
      handler: async () => ({ content: "x" }),
    });

    expect(() => createDomainToolkit({ tools: [tool, tool] })).toThrow(/重名/);
  });

  it("无工具时整层等价于不存在（payload 不被改写）", () => {
    const toolkit = createDomainToolkit({ tools: [] });

    expect(toolkit.enabled).toBe(false);
    expect(toolkit.definitions).toEqual([]);
  });

  it("装出的定义是标准 OpenAI 形状", () => {
    const toolkit = makeToolkit(async () => ({ content: "ok", records: 1 }));

    expect(toolkit.enabled).toBe(true);
    expect(toolkit.definitions[0]).toMatchObject({
      type: "function",
      function: { name: "lookup_local" },
    });
  });

  it("handler 抛错转成可读错误，不向上抛（失败也是可观测结果）", async () => {
    const toolkit = makeToolkit(async () => {
      throw new Error("数据源返回 500");
    });

    const outcome = await toolkit.run("lookup_local", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("lookup_local 执行失败");
    expect(outcome.content).toContain("500");
  });

  it("未知工具名返回可读错误", async () => {
    const toolkit = makeToolkit(async () => ({ content: "ok" }));
    const outcome = await toolkit.run("nope", {});

    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("未知领域工具");
  });

  it("超长结果被截断（长结果会把上游上下文撑爆）", async () => {
    const toolkit = makeToolkit(async () => ({
      content: "字".repeat(TOOL_RESULT_CAP + 500),
      records: 1,
    }));

    const outcome = await toolkit.run("lookup_local", {});
    expect(outcome.content.length).toBe(TOOL_RESULT_CAP + 1);
  });
});

describe("parseToolArgs", () => {
  it("字符串 JSON 正常解析；对象原样返回；坏输入退化为空参数", () => {
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArgs({ a: 1 })).toEqual({ a: 1 });
    expect(parseToolArgs("{broken")).toEqual({});
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs(null)).toEqual({});
  });
});

describe("fetchJson 错误映射", () => {
  it("非 2xx：带上状态码与前缀内容，便于模型判断是否重试", async () => {
    vi.stubGlobal("fetch", async () => new Response("quota", { status: 429 }));

    const error = await fetchJson("https://example.com/x").catch((e) => e);
    expect(error.message).toContain("429");
    expect(error.message).toContain("quota");
  });

  it("非 JSON：如实报告", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html></html>", { status: 200 }),
    );

    const error = await fetchJson("https://example.com/x").catch((e) => e);
    expect(error.message).toContain("非 JSON");
  });

  it("超时：文案里带预算时长", async () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });

    const error = await fetchJson("https://example.com/x", {
      timeoutMs: 3_000,
    }).catch((e) => e);
    expect(error.message).toContain("3000ms");
  });

  it("成功：返回解析后的 JSON", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );

    await expect(fetchJson("https://example.com/x")).resolves.toEqual({
      ok: 1,
    });
  });
});

describe("createChatHandler 的工具循环", () => {
  it("领域工具定义并进上游 tools，NOVA 的工具保持在前", async () => {
    let captured: UpstreamPayload | undefined;
    const handler = createChatHandler({
      model: MODEL,
      personaLayer: persona,
      upstreamModel: "agnes-3.0-flash",
      toolkit: makeToolkit(async () => ({ content: "ok", records: 1 })),
      upstream: async (payload) => {
        captured = payload;
        return {
          choices: [{ message: { role: "assistant", content: "结论。" } }],
          usage: usageOf(10, 5),
        };
      },
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "问题" }],
      tools: novaTools,
    });

    expect(captured.tools.map((tool) => tool.function.name)).toEqual([
      "external_search",
      "summarize",
      "lookup_local",
    ]);
    expect(completion.choices[0].message.content).toBe("结论。");
  });

  it("纯本地轮：就地执行后回灌，下一轮收口，usage 累计上报", async () => {
    const seen = [];
    let executed = 0;
    const toolkit = makeToolkit(async (args) => {
      executed += 1;
      return { content: JSON.stringify({ echo: args.city }), records: 1 };
    });

    const handler = createChatHandler({
      model: MODEL,
      personaLayer: persona,
      upstreamModel: "agnes-3.0-flash",
      toolkit,
      upstream: async (payload) => {
        seen.push(payload);
        const last = payload.messages.at(-1);

        if (last?.role === "tool") {
          return {
            choices: [
              { message: { role: "assistant", content: "最终结论。" } },
            ],
            usage: usageOf(100, 20),
          };
        }
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  callOf("lookup_local", { city: "西安" }, "call_1"),
                ],
              },
            },
          ],
          usage: usageOf(80, 10),
        };
      },
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "西安天气" }],
      tools: novaTools,
    });

    expect(executed).toBe(1);
    expect(seen).toHaveLength(2);
    expect(completion.usage).toEqual(usageOf(180, 30));
    expect(seen[1].messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
    });
  });

  it("混合轮：本地工具就地执行，NOVA 的调用原样回传且结果摘要在 content 里", async () => {
    const toolkit = makeToolkit(async () => ({
      content: JSON.stringify({ city: "西安", high: 21 }),
      records: 1,
    }));

    const handler = createChatHandler({
      model: MODEL,
      personaLayer: persona,
      upstreamModel: "agnes-3.0-flash",
      toolkit,
      upstream: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "先查本地再检索。",
              tool_calls: [
                callOf("lookup_local", { city: "西安" }, "call_local"),
                callOf("external_search", { query: "西安" }, "call_nova"),
              ],
            },
          },
        ],
        usage: usageOf(50, 10),
      }),
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "西安三天" }],
      tools: novaTools,
    });

    const message = completion.choices[0].message;
    expect(message.tool_calls.map((call) => call.function.name)).toEqual([
      "external_search",
    ]);
    expect(message.content).toContain("先查本地再检索。");
    // 本地结果降级成可读摘要，下一轮上下文不断档
    expect(message.content).toContain("lookup_local");
    expect(message.content).toContain("high");
    expect(completion.choices[0].finish_reason).toBe("tool_calls");
  });

  it("轮次用尽：剥掉工具强制收口，本地工具名不会漏回给 NOVA", async () => {
    const seen = [];
    const handler = createChatHandler({
      model: MODEL,
      personaLayer: persona,
      upstreamModel: "agnes-3.0-flash",
      toolkit: makeToolkit(async () => ({ content: "ok", records: 1 }), {
        maxRounds: 1,
      }),
      upstream: async (payload) => {
        seen.push(payload);
        // 桩模型永远只要本地工具：真实模型在 tools 被剥掉后会走文本
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [callOf("lookup_local", {})],
              },
            },
          ],
          usage: usageOf(10, 5),
        };
      },
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "循环" }],
      tools: novaTools,
    });

    // 两次上游调用封顶：本地轮 1 次 + 收口轮，且收口轮不再带 tools
    expect(seen).toHaveLength(2);
    expect(seen[1].tools).toBeUndefined();
    // 本地工具名不能回传给 NOVA，否则会变成一条「未知工具」的失败记录
    expect(completion.choices[0].message.tool_calls).toBeUndefined();
  });

  it("未配工具层：行为与纯人格代理完全一致", async () => {
    let captured: UpstreamPayload | undefined;
    const handler = createChatHandler({
      model: MODEL,
      personaLayer: persona,
      upstreamModel: "agnes-3.0-flash",
      upstream: async (payload) => {
        captured = payload;
        return {
          choices: [{ message: { role: "assistant", content: "纯转发。" } }],
          usage: usageOf(10, 5),
        };
      },
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "问题" }],
      tools: novaTools,
    });

    expect(captured.tools.map((tool) => tool.function.name)).toEqual([
      "external_search",
      "summarize",
    ]);
    expect(completion.choices[0].message.content).toBe("纯转发。");
  });
});
