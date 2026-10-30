import { describe, expect, it } from "vitest";
import {
  createPersonaLayer,
  findTagIssues,
  PERSONA_MAX_CHARS,
  toClientResponse,
} from "../persona.mjs";

/**
 * 人格层纯逻辑测试（原 nova-research / nova-coder 各自维护，
 * 抽到 agent-kit 后单源化）。
 *
 * 人格代理的全部价值在于「转发不失真」：NOVA 的工具定义、采样参数、
 * 对话历史必须原样到达上游，响应又必须以登记的模型 id 回去。
 * 全部用例打纯函数，不烧一次真实 token。
 */

const FIXTURE_PROMPT = [
  "<role>你是测试人格。</role>",
  "<workflow>按步骤执行。</workflow>",
].join("\n");

const NOVA_MESSAGES = [
  { role: "system", content: "你是一个运行在 NOVA 沙盒中的受控 Agent。" },
  { role: "user", content: "请完成一次交叉验证调研。" },
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

describe("createPersonaLayer", () => {
  it("人格系统消息插在最前，NOVA 的 system 提示词原样跟在其后", () => {
    const layer = createPersonaLayer(FIXTURE_PROMPT);
    const payload = layer.toUpstreamPayload(
      { messages: NOVA_MESSAGES, tools: TOOLS },
      "agnes-3.0-flash",
    );

    expect(payload.messages).toHaveLength(3);
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[0].content).toBe(FIXTURE_PROMPT);
    expect(payload.messages[1]).toEqual(NOVA_MESSAGES[0]);
    expect(payload.messages[2]).toEqual(NOVA_MESSAGES[1]);
  });

  it("工具与 tool_choice 原样透传，采样参数沿用调用方的值", () => {
    const layer = createPersonaLayer(FIXTURE_PROMPT);
    const payload = layer.toUpstreamPayload(
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
    const layer = createPersonaLayer(FIXTURE_PROMPT);
    const payload = layer.toUpstreamPayload(
      { messages: NOVA_MESSAGES, tools: [], stream: true },
      "agnes-3.0-flash",
    );

    expect("tools" in payload).toBe(false);
    expect("tool_choice" in payload).toBe(false);
    expect(payload.stream).toBe(false);
  });

  it("messages 缺失时退化为人格单消息，采样参数取默认值", () => {
    const layer = createPersonaLayer(FIXTURE_PROMPT);
    const payload = layer.toUpstreamPayload({}, "agnes-3.0-flash");

    expect(payload.messages).toEqual([
      { role: "system", content: FIXTURE_PROMPT },
    ]);
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_tokens).toBe(2000);
  });
});

describe("findTagIssues", () => {
  it("配对良好（含嵌套与连字符标签）返回空数组", () => {
    const text = [
      "<role>身份",
      "  <rules>",
      "  <rule-a>规则一</rule-a>",
      "  </rules>",
      "</role>",
      "1 < 2 且 a<b 属于正文比较符，不是标签。",
    ].join("\n");

    expect(findTagIssues(text)).toEqual([]);
  });

  it("未闭合的标签报出行号与标签名", () => {
    const issues = findTagIssues("<role>\n正文没有闭合");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("<role>");
    expect(issues[0]).toContain("未闭合");
  });

  it("多余的闭合标签报出", () => {
    const issues = findTagIssues("正文</workflow>收尾");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("</workflow>");
  });

  it("交叉嵌套为每个错配的闭合标签报出问题", () => {
    const issues = findTagIssues("<role>\n<workflow>\n</role>\n</workflow>");

    // </role> 撞上栈顶的 <workflow>、</workflow> 撞上残余的 <role>，
    // 两次错配各自报一条，都带行号
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("交叉嵌套");
    expect(issues[1]).toContain("交叉嵌套");
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
    const completion = toClientResponse(upstream, "kit-test-model");

    expect(completion.model).toBe("kit-test-model");
    expect(completion.id).toBe("chatcmpl-up-1");
    expect(completion.object).toBe("chat.completion");
  });

  it("tool_calls 与 finish_reason、usage 原样透传", () => {
    const completion = toClientResponse(upstream, "kit-test-model");

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
      "kit-test-model",
    );

    expect(completion.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
    expect(completion.choices[0].finish_reason).toBe("stop");
    expect(completion.id).toMatch(/^chatcmpl-/);
  });

  it("上游缺 choices[0].message 时返回 null，交由处理器转错误", () => {
    expect(toClientResponse({ choices: [] }, "kit-test-model")).toBeNull();
    expect(toClientResponse(null, "kit-test-model")).toBeNull();
  });
});

describe("PERSONA_MAX_CHARS", () => {
  it("与控制台系统提示词的静态校验上限同口径", () => {
    expect(PERSONA_MAX_CHARS).toBe(8_000);
  });
});
