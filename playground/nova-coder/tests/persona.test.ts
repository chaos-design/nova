import { describe, expect, it } from "vitest";
import { HttpError, handleChat } from "../index.mjs";
import {
  PERSONA_PROMPT,
  toClientResponse,
  toUpstreamPayload,
} from "../persona.mjs";

/**
 * 工程搭档的协议整形测试。
 *
 * 人格代理的全部价值在于「转发不失真」：NOVA 的工具定义、采样参数、
 * 对话历史必须原样到达上游，响应又必须以登记的模型 id 回去。
 * 这里直接打纯函数与 handleChat（注入桩上游），不烧一次真实 token。
 */

const NOVA_MESSAGES = [
  { role: "system", content: "你是一个运行在 NOVA 沙盒中的受控 Agent。" },
  { role: "user", content: "请帮我写一个脚手架脚本。" },
];

const TOOLS = [
  {
    type: "function",
    function: {
      name: "external_search",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
];

describe("toUpstreamPayload", () => {
  it("把人格系统消息插在最前，NOVA 的 system 提示词原样跟在其后", () => {
    const payload = toUpstreamPayload(
      { messages: NOVA_MESSAGES, tools: TOOLS },
      "agnes-3.0-flash",
    );

    expect(payload.messages).toHaveLength(3);
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[0].content).toBe(PERSONA_PROMPT);
    expect(payload.messages[1]).toEqual(NOVA_MESSAGES[0]);
    expect(payload.messages[2]).toEqual(NOVA_MESSAGES[1]);
  });

  it("工具与 tool_choice 原样透传，采样参数沿用调用方的值", () => {
    const payload = toUpstreamPayload(
      {
        messages: NOVA_MESSAGES,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 2000,
      },
      "agnes-3.0-flash",
    );

    expect(payload.tools).toEqual(TOOLS);
    expect(payload.tool_choice).toBe("auto");
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_tokens).toBe(2000);
  });

  it("空工具数组不转发（部分兼容端点会 400），并强制非流式", () => {
    const payload = toUpstreamPayload(
      { messages: NOVA_MESSAGES, tools: [], stream: true },
      "agnes-3.0-flash",
    );

    expect("tools" in payload).toBe(false);
    expect("tool_choice" in payload).toBe(false);
    expect(payload.stream).toBe(false);
  });

  it("messages 缺失时退化为人格单消息，采样参数取默认值", () => {
    const payload = toUpstreamPayload({}, "agnes-3.0-flash");

    expect(payload.messages).toEqual([
      { role: "system", content: PERSONA_PROMPT },
    ]);
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_tokens).toBe(2000);
  });
});

describe("toClientResponse", () => {
  const upstream = {
    id: "chatcmpl-up-1",
    object: "chat.completion",
    created: 1_760_000_000,
    model: "agnes-3.0-flash",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "external_search", arguments: '{"query":"x"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  };

  it("model 回显请求的登记 id，而不是上游真实 id", () => {
    const completion = toClientResponse(upstream, "nova-coder-agent");

    expect(completion.model).toBe("nova-coder-agent");
    expect(completion.id).toBe("chatcmpl-up-1");
    expect(completion.object).toBe("chat.completion");
  });

  it("tool_calls 与 finish_reason、usage 原样透传", () => {
    const completion = toClientResponse(upstream, "nova-coder-agent");

    expect(completion.choices[0].finish_reason).toBe("tool_calls");
    expect(completion.choices[0].message.tool_calls).toHaveLength(1);
    expect(completion.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    });
  });

  it("usage 缺字段按 0 计，total 回退为 prompt + completion", () => {
    const completion = toClientResponse(
      { choices: [{ message: { role: "assistant", content: "ok" } }] },
      "nova-coder-agent",
    );

    expect(completion.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
    expect(completion.choices[0].finish_reason).toBe("stop");
    expect(completion.id).toMatch(/^chatcmpl-/);
  });

  it("上游缺 choices[0].message 时返回 null，交由入口转错误", () => {
    expect(toClientResponse({ choices: [] }, "nova-coder-agent")).toBeNull();
    expect(toClientResponse(null, "nova-coder-agent")).toBeNull();
  });
});

describe("handleChat", () => {
  const upstreamOk = {
    choices: [{ message: { role: "assistant", content: "实现完成…" } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };

  it("happy path：人格注入 + 上游转发 + 以登记模型 id 返回", async () => {
    let captured: { model?: string; messages?: unknown[] } | undefined;
    const completion = await handleChat(
      { model: "nova-coder-agent", messages: NOVA_MESSAGES, tools: TOOLS },
      {
        upstream: async (payload) => {
          captured = payload;
          return upstreamOk;
        },
      },
    );

    expect(captured.model).toBe("agnes-3.0-flash");
    expect(captured.messages[0].content).toBe(PERSONA_PROMPT);
    expect(completion.model).toBe("nova-coder-agent");
    expect(completion.choices[0].message.content).toBe("实现完成…");
  });

  it("模型标识不一致时 400，不烧上游 token（协议 §1）", async () => {
    const error = await handleChat(
      { model: "wrong-model", messages: NOVA_MESSAGES },
      { upstream: async () => upstreamOk },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
    expect(error.message).toContain("nova-coder-agent");
  });

  it("上游响应缺 choices[0].message 时 502", async () => {
    const error = await handleChat(
      { model: "nova-coder-agent", messages: NOVA_MESSAGES },
      { upstream: async () => ({ object: "chat.completion" }) },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(502);
  });
});
