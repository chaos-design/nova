/**
 * 领域 Agent 的人格层（纯逻辑，无 IO）。
 *
 * 人格提示词由入口从 persona.md 读入后经工厂注入，本层据此产出
 * 转发给上游大模型的载荷，并把上游响应还原成调用方期待的 OpenAI
 * 形状。不含 IO、不读配置，因此可以脱离网络单测。
 *
 * persona.md 支持 XML 自定义标签分节（如 <role> / <workflow>）：
 * 标签原文随提示词一起发给上游（大模型对 XML 标记有稳定的遵循度），
 * findTagIssues 只负责在启动时挡住配对错误，不改写任何内容。
 *
 * 与 nova-local（规则决策执行体）的分工：领域 Agent 的回复全部
 * 来自上游真实大模型，本层只注入领域人格与协议整形 —— 这也是
 * 它们能登记进控制台的前提（登记表只收真实端点）。
 */

/** 人格提示词的长度上限：随每轮请求发送，过长会放大 token 成本（与控制台系统提示词同口径） */
export const PERSONA_MAX_CHARS = 8_000;

/**
 * 创建人格层：把 persona.md 的文本绑进载荷整形。
 *
 * @param {string} personaPrompt persona.md 的内容（trim 后）
 * @returns {{ prompt: string, toUpstreamPayload: (body: object, upstreamModel: string) => object }}
 */
export function createPersonaLayer(personaPrompt) {
  const prompt = String(personaPrompt ?? "");

  return {
    prompt,
    /**
     * 转发前的载荷整形。
     *
     * 人格系统消息插在最前：NOVA 下发的 system 提示词是受测配置的一部分，
     * 保持原样跟在其后，不做改写。工具与采样参数原样透传，让上游真实决定
     * 是否发起工具调用 —— 沙盒与对话验证的观测都建立在这一点上。
     */
    toUpstreamPayload(body, upstreamModel) {
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const tools = Array.isArray(body?.tools) ? body.tools : [];

      return {
        model: upstreamModel,
        messages: [{ role: "system", content: prompt }, ...messages],
        // 空工具数组不能发：部分 OpenAI 兼容端点会直接 400（与执行器同口径）
        ...(tools.length > 0
          ? { tools, tool_choice: body?.tool_choice ?? "auto" }
          : {}),
        temperature:
          typeof body?.temperature === "number" ? body.temperature : 0.2,
        max_tokens:
          typeof body?.max_tokens === "number" ? body.max_tokens : 2000,
        // 本服务只支持非流式，协议也约定 stream 恒为 false
        stream: false,
      };
    },
  };
}

/**
 * 校验 persona.md 里 XML 自定义标签的配对。
 *
 * 只做最小检查（开/闭配对、交叉嵌套），不做完整 XML 解析：
 * 提示词是给大模型读的散文，混入「1 < 2」这类比较符号必须原样放行。
 * 标签形态约定为严格的 `<name>` / `</name>`，不支持属性 ——
 * 这是给人写、给模型读的标记，不是数据序列化。
 *
 * @returns {string[]} 结构问题描述列表，空数组即通过
 */
export function findTagIssues(text) {
  const issues = [];
  const stack = [];
  const lineAt = (index) => text.slice(0, index).split("\n").length;

  for (const match of String(text ?? "").matchAll(
    /<(\/?)([a-zA-Z][a-zA-Z0-9_-]*)>/g,
  )) {
    const [, slash, name] = match;
    const line = lineAt(match.index);

    if (!slash) {
      stack.push({ name, line });
      continue;
    }

    const top = stack.pop();
    if (!top) {
      issues.push(`第 ${line} 行的 </${name}> 没有对应的 <${name}>`);
    } else if (top.name !== name) {
      issues.push(
        `第 ${line} 行的 </${name}> 与第 ${top.line} 行的 <${top.name}> 交叉嵌套`,
      );
    }
  }

  for (const { name, line } of stack) {
    issues.push(`第 ${line} 行的 <${name}> 未闭合`);
  }

  return issues;
}

/**
 * 上游响应 → 客户端响应。
 *
 * model 必须回显**请求**的模型 id 而不是上游的真实 id：调用方按登记的
 * 模型标识发请求，响应与请求不一致会被判协议不匹配（协议 §2）。
 * 上游响应缺 choices[0].message 时返回 null，由入口转成可读错误。
 */
export function toClientResponse(upstream, requestedModel) {
  const choice = upstream?.choices?.[0];

  if (!choice?.message) return null;

  const promptTokens = upstream?.usage?.prompt_tokens ?? 0;
  const completionTokens = upstream?.usage?.completion_tokens ?? 0;

  return {
    id:
      typeof upstream?.id === "string" && upstream.id
        ? upstream.id
        : `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created:
      typeof upstream?.created === "number"
        ? upstream.created
        : Math.floor(Date.now() / 1_000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: choice.message,
        finish_reason: choice.finish_reason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        upstream?.usage?.total_tokens ?? promptTokens + completionTokens,
    },
  };
}
