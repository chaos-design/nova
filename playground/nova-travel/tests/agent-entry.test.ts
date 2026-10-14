import { readFileSync } from "node:fs";
import {
  createChatHandler,
  findTagIssues,
  PERSONA_MAX_CHARS,
} from "@chaos-design/agent-kit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentServer, toolkit } from "../index.mjs";
import { travelTools } from "../tools.mjs";

/**
 * 行程规划师入口的集成测试（scaffold-agent.mjs 生成）。
 *
 * 纯整形逻辑（人格层 / 上游错误映射）在 @chaos-design/agent-kit 包内
 * 覆盖；这里验证两件事：本 Agent 的 persona.md 结构完好，以及入口
 * 接线产物（模型标识、路由分发）在真实 HTTP 栈上行为正确。
 * 上游用全局 stub 拦截，不烧真实 token。
 */

const MODEL = "nova-travel-agent";

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
    expect(body.data[0].owned_by).toBe("nova-travel");
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
 * 这些工具是「有效 Agent」与「裸模型端点」的分界：它们真的发出 HTTP 请求，
 * 真的按返回内容算结论。测试桩只固定响应体，不替换解析与换算逻辑 ——
 * 断言的是参数校验、URL 拼装与字段映射这三件真实发生的事。
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

const geocodeBody = {
  results: [
    {
      name: "京都",
      admin1: "京都府",
      country: "日本",
      country_code: "JP",
      latitude: 35.02107,
      longitude: 135.75385,
      timezone: "Asia/Tokyo",
      population: 1464890,
    },
  ],
};

const forecastBody = {
  timezone: "Asia/Tokyo",
  daily: {
    time: ["2026-10-20", "2026-10-21"],
    temperature_2m_max: [21.4, 22.1],
    temperature_2m_min: [13.2, 12.8],
    precipitation_probability_max: [30, 10],
    wind_speed_10m_max: [12.34, 9.87],
  },
};

const fxBody = { date: "2026-10-13", rates: { JPY: 23.623 } };

describe("领域工具定义", () => {
  it("三个工具名唯一、描述非空、parameters 是 object 型 Schema", () => {
    expect(travelTools).toHaveLength(3);
    expect(new Set(travelTools.map((tool) => tool.name)).size).toBe(3);

    for (const tool of travelTools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("必填参数都出现在 properties 里（模型不会被要求填一个不存在的字段）", () => {
    for (const tool of travelTools) {
      for (const required of tool.parameters.required ?? []) {
        expect(Object.keys(tool.parameters.properties)).toContain(required);
      }
    }
  });

  it("工具层装出的定义是标准 OpenAI 形状，且带 Agent 侧执行体", () => {
    expect(toolkit.definitions.map((item) => item.function.name)).toEqual(
      travelTools.map((tool) => tool.name),
    );
    expect(toolkit.names.has("geocode_place")).toBe(true);
    // NOVA 的工具不在本 Agent 的本地执行集合里：必须透传回去
    expect(toolkit.names.has("external_search")).toBe(false);
  });
});

describe("geocode_place", () => {
  const tool = travelTools.find((item) => item.name === "geocode_place");

  it("解析真实地理响应：坐标 / 时区 / 国家都取自返回体", async () => {
    stubSources([
      { match: "https://geocoding-api.open-meteo.com/", body: geocodeBody },
    ]);

    const result = await tool.handler(
      { name: "京都", count: 3 },
      { timeoutMs: 5_000 },
    );
    const parsed = JSON.parse(result.content);

    expect(result.records).toBe(1);
    expect(parsed.source).toBe("open-meteo-geocoding");
    expect(parsed.places[0]).toMatchObject({
      name: "京都",
      timezone: "Asia/Tokyo",
      country: "日本",
      latitude: 35.0211,
    });
  });

  it("检索式里带上语言与条数参数（中文地名才回中文名）", async () => {
    stubSources([
      { match: "https://geocoding-api.open-meteo.com/", body: geocodeBody },
    ]);
    await tool.handler({ name: "京都", count: 5 }, { timeoutMs: 5_000 });

    const url = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(url).toContain("language=zh");
    expect(url).toContain("count=5");
  });

  it("空参数：返回可读错误，不发请求", async () => {
    stubSources([]);
    const result = await tool.handler({ name: "  " }, { timeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("name 不能为空");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("地理库无命中：如实说明，不编一个坐标出来", async () => {
    stubSources([
      { match: "https://geocoding-api.open-meteo.com/", body: { results: [] } },
    ]);
    const result = await tool.handler(
      { name: "不存在的地方" },
      { timeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("未命中");
  });
});

describe("weather_outlook", () => {
  const tool = travelTools.find((item) => item.name === "weather_outlook");

  it("按坐标取预报并按天映射字段", async () => {
    stubSources([{ match: "https://api.open-meteo.com/", body: forecastBody }]);

    const result = await tool.handler(
      {
        latitude: 35.0211,
        longitude: 135.7539,
        days: 2,
        timezone: "Asia/Tokyo",
      },
      { timeoutMs: 5_000 },
    );
    const parsed = JSON.parse(result.content);

    expect(result.records).toBe(2);
    expect(parsed.forecasts[0]).toEqual({
      date: "2026-10-20",
      highC: 21.4,
      lowC: 13.2,
      rainChance: 30,
      maxWindKmh: 12.3,
    });
  });

  it("坐标不是数字：报错并指路 geocode_place", async () => {
    stubSources([]);
    const result = await tool.handler(
      { latitude: "京都" },
      { timeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("geocode_place");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("坐标越界：拒绝调用", async () => {
    stubSources([]);
    const result = await tool.handler(
      { latitude: 200, longitude: 0 },
      { timeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("超出合法范围");
  });
});

describe("currency_rate", () => {
  const tool = travelTools.find((item) => item.name === "currency_rate");

  it("返回真实汇率并换算金额", async () => {
    stubSources([{ match: "https://api.frankfurter.app/", body: fxBody }]);

    const result = await tool.handler(
      { from: "cny", to: "jpy", amount: 5000 },
      { timeoutMs: 5_000 },
    );
    const parsed = JSON.parse(result.content);

    expect(parsed.pair).toBe("CNY/JPY");
    expect(parsed.rate).toBe(23.623);
    expect(parsed.converted.converted).toBe(118115);
    expect(parsed.date).toBe("2026-10-13");
  });

  it("非法货币码：本地校验拦住，不发请求", async () => {
    stubSources([]);
    const result = await tool.handler(
      { from: "人民币", to: "JPY" },
      { timeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("三位字母");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("数据源不支持该货币对：如实报告", async () => {
    stubSources([
      { match: "https://api.frankfurter.app/", body: { rates: {} } },
    ]);
    const result = await tool.handler(
      { from: "CNY", to: "XYZ" },
      { timeoutMs: 5_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("不支持");
  });
});

describe("工具循环：本地工具就地执行，NOVA 的工具原样透传", () => {
  it("上游要求 geocode_place → 本服务真实执行 → 下一轮给出最终文本", async () => {
    const calls: string[] = [];
    const upstreamPayloads: Record<string, unknown>[] = [];
    const geocodeCall = {
      id: "call_geo_1",
      type: "function",
      function: { name: "geocode_place", arguments: '{"name":"西安"}' },
    };

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
        calls.push("upstream");
        upstreamPayloads.push(payload);
        const last = payload.messages.at(-1);

        if (last?.role === "tool") {
          return {
            choices: [
              { message: { role: "assistant", content: "西安三天已排好。" } },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          };
        }
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [geocodeCall],
              },
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 },
        };
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify(geocodeBody), { status: 200 }),
      ),
    );

    try {
      const completion = await handler({
        model: MODEL,
        messages: [{ role: "user", content: "帮我规划西安三天行程。" }],
      });

      // 两次上游调用（本地工具轮 + 收口轮），本地工具真实打了一次数据源
      expect(calls).toHaveLength(2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(completion.choices[0].message.content).toBe("西安三天已排好。");
      // 自执行轮的 token 一起报给 NOVA，否则工具循环在成本口径上等于没发生
      expect(completion.usage).toEqual({
        prompt_tokens: 180,
        completion_tokens: 30,
        total_tokens: 210,
      });

      // 第二轮上游看到的是标准 role=tool 消息，且工具结果来自真实响应体
      const toolMessage = upstreamPayloads[1].messages.at(-1);
      expect(toolMessage.role).toBe("tool");
      expect(toolMessage.tool_call_id).toBe("call_geo_1");
      expect(toolMessage.content).toContain("Asia/Tokyo");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("本地工具失败：错误以 role=tool 回灌，不中断请求", async () => {
    const handler = createChatHandler({
      model: MODEL,
      personaLayer: {
        prompt: "",
        toUpstreamPayload: (body, upstreamModel) => ({
          model: upstreamModel,
          messages: body.messages,
          stream: false,
        }),
      },
      upstreamModel: "agnes-3.0-flash",
      toolkit,
      upstream: async (payload) => {
        const last = payload.messages.at(-1);
        if (last?.role === "tool") {
          return {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "数据源不可用，改用公开检索。",
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        }
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_fx_1",
                    type: "function",
                    function: {
                      name: "currency_rate",
                      arguments: '{"from":"CNY","to":"人民币"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      },
    });

    const completion = await handler({
      model: MODEL,
      messages: [{ role: "user", content: "预算换算一下。" }],
    });

    expect(completion.choices[0].message.content).toContain("数据源不可用");
  });
});
