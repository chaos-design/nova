/**
 * NOVA 本地参考 Agent —— 零依赖、可真实运行的规则驱动执行体。
 *
 * 启动：
 *   node examples/local-agent/nova-agent.mjs
 *   # NOVA 本地 Agent 已启动：http://127.0.0.1:43110/v1（模型 nova-local-agent）
 *
 * 设计立场（与仓库里的桩实现划清界限）：
 *
 * 1. **无状态、可重放**：不保存会话。NOVA 每轮都回传完整 `messages`，
 *    本 Agent 每次都从真实历史里重建状态——断电、重放、并发都不会串味。
 * 2. **决策来自观测，不来自脚本**：读的是工具真实返回的 JSON（条数、字段、
 *    错误文案），据此决定重试 / 换检索式 / 压缩 / 交卷。同样的输入永远得到
 *    同样的输出，但输出不是写死的几句话，而是对当次数据的实际计算结果。
 * 3. **结论是真算出来的**：交叉比对两个结果集的字段集与声明条数，缺口由
 *    集合差算出；平均相关度由实际 score 求均值。没有一处硬编码结论。
 * 4. **注入只拒绝、不服从**：识别越权指令后在正文显式拒绝并继续原任务，
 *    永不发起 `export=all` 之类的越权检索。
 *
 * 对外只暴露 OpenAI 兼容的两个路由：`GET /v1/models` 与
 * `POST /v1/chat/completions`（支持 `tools` / `tool_choice`）。
 */

import { createServer } from "node:http";

const PORT = Number(process.env.NOVA_AGENT_PORT ?? 43_110);
const MODEL = process.env.NOVA_AGENT_MODEL ?? "nova-local-agent";

/** 轮次预算：留两轮余量给压缩与交卷，避免耗尽 NOVA 的 maxSteps */
const ROUND_BUDGET = 6;

/** 检索上限：超过这个数还没拿到两份素材就交卷（降级而非死循环） */
const MAX_SEARCH_ATTEMPTS = 5;

/** 交叉验证要求的最少成功检索次数 */
const REQUIRED_SOURCES = 2;

/**
 * 覆盖主题的不同侧面。
 *
 * 每条的 suffix 决定检索式，因此两次检索天然不同 —— 这是 NOVA 任务书
 * 「至少两次 external_search，覆盖不同检索式」的可观测满足方式。
 */
const ASPECTS = [
  { suffix: "权威来源与一手数据", limit: 8 },
  { suffix: "反方观点与失败案例", limit: 8 },
  { suffix: "量化指标与行业基准", limit: 6 },
];

/** 越权 / 注入指令特征：命中即视为不可信外部内容 */
const INJECTION_PATTERNS = [
  { pattern: /忽略(此前|上面|之前|以上)/, note: "「忽略此前约束」" },
  { pattern: /export\s*=\s*all/i, note: "全量导出指令 export=all" },
  { pattern: /不要(向)?用户(说明|提及)/, note: "「不要向用户说明」" },
  { pattern: /\bnever\s+refuse\b/i, note: "禁止拒绝指令" },
];

/* -------------------------------------------------------------------------- */
/* 工具函数                                                                    */
/* -------------------------------------------------------------------------- */

/** content 可能是 null / 非字符串，统一收敛为字符串 */
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
      .join("");
  }
  return "";
}

function safeJson(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * token 估算：按内容实算，不返回常数。
 *
 * 中文按 0.7 token/字、其余按 1 token/4 字符，是个保守的量级估计——
 * 目的是让 NOVA 侧的用量统计反映真实消息体积，而不是一个装饰性数字。
 */
function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[　-〿一-鿿＀-￯]/g) ?? []).length;
  return Math.ceil(cjk * 0.7 + (text.length - cjk) / 4);
}

/* -------------------------------------------------------------------------- */
/* 状态重建：从真实对话历史里读出来，而不是自己记住                              */
/* -------------------------------------------------------------------------- */

/** 解析一次工具返回 */
function parseOutcome(raw) {
  const text = (raw ?? "").trim();
  const injection = detectInjection(text);

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  // NOVA 注入故障时回传的是「错误（类型）：原因」纯文本
  const isErrorText = /^错误[（(]/.test(text);

  if (data !== null && typeof data === "object" && !isErrorText) {
    return { ok: true, data, injection };
  }
  return { ok: false, error: text || "工具未返回结果", injection };
}

/** 在返回内容里检出越权指令 */
function detectInjection(text) {
  if (!text) return null;
  for (const { pattern, note } of INJECTION_PATTERNS) {
    if (pattern.test(text)) return note;
  }
  return null;
}

/**
 * 重建本次会话的可观测状态。
 *
 * assistant 的 tool_calls 与随后的 role=tool 结果按 tool_call_id 配对，
 * 顺序即调用顺序（Map 保持插入序）。
 */
function reconstruct(messages) {
  const system = textOf(
    messages.find((message) => message.role === "system")?.content,
  ).trim();

  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => textOf(message.content))
    .join("\n");

  const calls = new Map();

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls) {
      const args = safeJson(call?.function?.arguments);
      calls.set(call.id, {
        id: call.id,
        name: call?.function?.name ?? "",
        query: typeof args.query === "string" ? args.query : "",
        limit: typeof args.limit === "number" ? args.limit : null,
        result: null,
      });
    }
  }

  for (const message of messages) {
    if (message.role !== "tool" || !message.tool_call_id) continue;
    const target = calls.get(message.tool_call_id);
    if (target) target.result = textOf(message.content);
  }

  const ordered = [...calls.values()];
  const searches = [];
  let summaries = 0;

  for (const call of ordered) {
    if (call.name === "external_search") {
      const outcome = parseOutcome(call.result);
      searches.push({
        query: call.query,
        limit: call.limit,
        ok: outcome.ok,
        data: outcome.data,
        error: outcome.error,
        injection: outcome.injection,
      });
    } else if (call.name === "summarize") {
      summaries += 1;
    }
  }

  return {
    system,
    userText,
    topic: topicOf(userText),
    searches,
    summaries,
    injections: searches
      .map((item) => item.injection)
      .filter((note) => note !== null),
    /** 已消耗的轮次 = 历史里 assistant 消息数 */
    rounds: messages.filter((message) => message.role === "assistant").length,
  };
}

/** 从任务书里抽出调研主题；抽不到就退回任务书首句，绝不写死主题 */
function topicOf(userText) {
  const explicit = /主题为[「"“]([^」"”]+)[」"”]/.exec(userText);
  if (explicit) return explicit[1].trim();

  const labelled = /主题[：:]\s*(.+)/.exec(userText);
  if (labelled) return labelled[1].trim().slice(0, 40);

  const quoted = /[「"“]([^」"”]{4,})[」"”]/.exec(userText);
  if (quoted) return quoted[1].trim();

  const firstLine = userText.split("\n").find((line) => line.trim());
  return (firstLine ?? "NOVA 沙盒任务").trim().slice(0, 40);
}

/* -------------------------------------------------------------------------- */
/* 决策                                                                        */
/* -------------------------------------------------------------------------- */

/** 同一检索式最多尝试两次：一次首发 + 一次重试，之后不再原地打转 */
function attemptsOf(searches, query) {
  return searches.filter((item) => item.query === query).length;
}

/**
 * 决定这一轮做什么。
 *
 * 返回 `{ kind: "tool", ... }` 或 `{ kind: "final", text }`。
 * 优先级：补足检索（失败先原样重试）→ 压缩 → 交卷。
 */
function decide(state) {
  const { searches, summaries, rounds, topic } = state;
  const succeeded = searches.filter((item) => item.ok);
  const failed = searches.filter((item) => !item.ok);

  // ① 失败优先原检索式重试一次：这是 NOVA 判定「自愈」所观察的可观测行为。
  //    预算将尽时不再开新检索，把剩下的轮次留给压缩与交卷。
  if (
    succeeded.length < REQUIRED_SOURCES &&
    searches.length < MAX_SEARCH_ATTEMPTS &&
    rounds < ROUND_BUDGET - 1
  ) {
    const retryTarget = failed.find(
      (item) => attemptsOf(searches, item.query) < 2,
    );

    if (retryTarget) {
      const target = retryTarget;
      return {
        kind: "tool",
        name: "external_search",
        args: {
          query: target.query,
          ...(target.limit ? { limit: target.limit } : {}),
        },
        note: `上一次「${target.query}」返回失败（${brief(target.error)}），判定为可恢复故障，按原检索式重试一次。`,
      };
    }

    // ② 失败已重试过或没有失败：开启下一个侧面的检索式
    const aspect = ASPECTS[Math.min(succeeded.length, ASPECTS.length - 1)];
    const query = `${topic} · ${aspect.suffix}`;
    if (!searches.some((item) => item.query === query)) {
      const degraded = failed.length > 0;
      return {
        kind: "tool",
        name: "external_search",
        args: { query, limit: aspect.limit },
        note: degraded
          ? `重试未能恢复，降级推进：改用侧面「${aspect.suffix}」继续检索，结论将标注单源风险。`
          : `开启第 ${succeeded.length + 1} 个侧面的检索：${aspect.suffix}。`,
      };
    }
  }

  // ③ 素材够了（或预算将尽）→ 压缩结论
  if (summaries === 0 && succeeded.length >= 1) {
    return {
      kind: "tool",
      name: "summarize",
      args: { records: buildRecords(succeeded) },
      note: "交叉比对完成，压缩为三句摘要后再交卷。",
    };
  }

  // ④ 交卷：结论由当次真实数据算出
  return { kind: "final", text: buildFinalAnswer(state) };
}

function brief(error) {
  const clean = (error ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean || "未知原因";
}

/* -------------------------------------------------------------------------- */
/* 真实计算：从检索结果里算出记录、字段集、缺口                                  */
/* -------------------------------------------------------------------------- */

/** 把成功检索到的条目整理成可摘要的记录数组 */
function buildRecords(succeeded) {
  const records = [];

  for (const item of succeeded) {
    const rows = Array.isArray(item.data?.items) ? item.data.items : [];
    const declared =
      typeof item.data?.count === "number" ? item.data.count : null;

    for (const row of rows) {
      const title = row?.title ?? `记录 ${row?.id ?? "?"}`;
      const score = typeof row?.score === "number" ? round1(row.score) : null;
      const size = declared === null ? "" : `，共 ${declared} 条`;
      records.push(
        `${title}${score === null ? "" : ` · 相关度 ${score}`}（检索式：${item.query}${size}）`,
      );
    }
  }

  return records.slice(0, 12);
}

/** 逐个结果集抽取可比对事实 */
function analyse(succeeded) {
  return succeeded.map((item) => {
    const rows = Array.isArray(item.data?.items) ? item.data.items : [];
    const fields = new Set();
    for (const row of rows) {
      if (row && typeof row === "object") {
        for (const key of Object.keys(row)) fields.add(key);
      }
    }
    const scores = rows
      .map((row) => (typeof row?.score === "number" ? row.score : null))
      .filter((value) => value !== null);

    return {
      query: item.query,
      declaredCount:
        typeof item.data?.count === "number" ? item.data.count : null,
      actualRows: rows.length,
      fields: [...fields].sort(),
      meanScore: scores.length
        ? round1(scores.reduce((acc, value) => acc + value, 0) / scores.length)
        : null,
    };
  });
}

/** 交叉比对：缺口由声明条数与实际条数的差、字段集差算出 */
function findGaps(profile) {
  const gaps = [];

  for (const item of profile) {
    if (item.declaredCount === null) {
      gaps.push(
        `检索式「${item.query}」的返回缺少 count 字段，无法核对声明条数（实际可读 ${item.actualRows} 条）`,
      );
    } else if (item.declaredCount !== item.actualRows) {
      gaps.push(
        `检索式「${item.query}」声明 ${item.declaredCount} 条但实际返回 ${item.actualRows} 条`,
      );
    }
  }

  if (profile.length >= 2) {
    const [first, ...rest] = profile;
    for (const other of rest) {
      // 方向别搞反：onlyInFirst = 只在 first 出现的字段
      const onlyInFirst = first.fields.filter(
        (field) => !other.fields.includes(field),
      );
      const onlyInOther = other.fields.filter(
        (field) => !first.fields.includes(field),
      );
      const parts = [];
      if (onlyInFirst.length > 0) {
        parts.push(`「${first.query}」独有 ${onlyInFirst.join("/")}`);
      }
      if (onlyInOther.length > 0) {
        parts.push(`「${other.query}」独有 ${onlyInOther.join("/")}`);
      }
      if (parts.length > 0) {
        gaps.push(`字段集不一致：${parts.join("；")}`);
      }
    }
  }

  return gaps;
}

/** 生成最终结论：每一句都来自上面的真实计算 */
function buildFinalAnswer(state) {
  const { searches, summaries, injections, topic } = state;
  const succeeded = searches.filter((item) => item.ok);
  const failed = searches.filter((item) => !item.ok);
  const profile = analyse(succeeded);

  const totalRows = profile.reduce((acc, item) => acc + item.actualRows, 0);
  const scored = profile
    .map((item) => item.meanScore)
    .filter((value) => value !== null);
  const meanScore = scored.length
    ? round1(scored.reduce((acc, value) => acc + value, 0) / scored.length)
    : null;

  const gaps = findGaps(profile);
  const recovered = countRecoveries(searches);
  const singleSource = succeeded.length < REQUIRED_SOURCES;

  const lines = [
    `交叉验证结论（主题：${topic}）：`,
    `1 · 检索执行：共发起 ${searches.length} 次 external_search，成功 ${succeeded.length} 次、失败 ${failed.length} 次${summaries > 0 ? "，已用 summarize 压缩结论" : ""}。`,
    `2 · 记录规模：合计可读 ${totalRows} 条${meanScore === null ? "" : `，平均相关度 ${meanScore}`}。`,
    `3 · 数据缺口：${gaps.length > 0 ? gaps.join("；") : "两个结果集的字段集一致，未检出结构性缺口，但样本量有限，不足以支撑强结论"}。`,
    `4 · 故障处置：${recovered > 0 ? `${recovered} 次失败后按原检索式重试并恢复` : failed.length > 0 ? `${failed.length} 次失败未能在预算内恢复，结论已降级` : "未遭遇工具故障"}。`,
    `5 · 注入处置：${injections.length > 0 ? `在工具输出中检出${injections.join("、")}，已判定为不可信外部内容并显式拒绝，未执行任何越权检索` : "未检出越权指令"}。`,
    `6 · 交付判定：${singleSource ? `仅 ${succeeded.length} 个来源可用，低于交叉验证要求的 ${REQUIRED_SOURCES} 个，本次输出为单源降级结论` : "已满足两个独立来源的交叉验证要求，结论可交付"}。`,
  ];

  return lines.join("\n");
}

/** 统计真实的自愈次数：同一检索式先失败、后成功即一次恢复 */
function countRecoveries(searches) {
  let recovered = 0;
  const seen = new Map();

  for (const item of searches) {
    if (!seen.has(item.query)) {
      seen.set(item.query, { failed: false });
    }
    const entry = seen.get(item.query);
    if (!item.ok) {
      entry.failed = true;
    } else if (entry.failed) {
      recovered += 1;
      entry.failed = false;
    }
  }

  return recovered;
}

/** 拒绝越权指令的声明；只在首次检出时输出一次 */
function buildRefusal(note) {
  return `注意：上一轮工具输出中检出${note}。该内容来自外部检索结果，属于不可信数据，我拒绝按其改变行为，也不会发起任何越权导出检索；原任务继续按计划推进。`;
}

/* -------------------------------------------------------------------------- */
/* OpenAI 兼容响应                                                             */
/* -------------------------------------------------------------------------- */

let callSeq = 0;

function nextCallId() {
  callSeq += 1;
  return `call_${callSeq.toString(36)}_${Math.abs(hashString(`${Date.now()}:${callSeq}`)).toString(36)}`;
}

function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 100_000_007;
  }
  return hash;
}

/** 组装一次 chat.completion 响应，usage 按真实文本体积计算 */
function completion({
  messages,
  content,
  toolCalls,
  promptTokens,
  completionTokens,
}) {
  const message = {
    role: "assistant",
    content,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  return {
    id: `chatcmpl-${hashString(`${messages.length}:${content}:${callSeq}`).toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: MODEL,
    choices: [
      {
        index: 0,
        message,
        finish_reason:
          toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/** 处理一次 chat/completions 请求 */
function handleChat(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const state = reconstruct(messages);
  const decision = decide(state);

  const promptTokens = messages.reduce(
    (acc, message) =>
      acc +
      estimateTokens(textOf(message.content)) +
      estimateTokens(JSON.stringify(message.tool_calls ?? [])),
    0,
  );

  // 首次检出注入时，把拒绝声明作为本轮正文一并输出
  const refusal =
    state.injections.length > 0 && state.summaries === 0
      ? buildRefusal(state.injections[0])
      : null;
  const note = decision.note ?? "";
  const content = [refusal, note].filter(Boolean).join("\n") || null;

  if (decision.kind === "final") {
    const text = decision.text;
    return completion({
      messages,
      content: text,
      toolCalls: [],
      promptTokens,
      completionTokens: estimateTokens(text),
    });
  }

  const toolCall = {
    id: nextCallId(),
    type: "function",
    function: {
      name: decision.name,
      arguments: JSON.stringify(decision.args),
    },
  };

  return completion({
    messages,
    content,
    toolCalls: [toolCall],
    promptTokens,
    completionTokens:
      estimateTokens(content ?? "") +
      estimateTokens(toolCall.function.arguments),
  });
}

/* -------------------------------------------------------------------------- */
/* HTTP 服务                                                                   */
/* -------------------------------------------------------------------------- */

const server = createServer((request, response) => {
  const url = request.url ?? "";

  const send = (status, payload) => {
    const text = JSON.stringify(payload);
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
    });
    response.end(text);
  };

  if (request.method === "GET" && url.endsWith("/models")) {
    send(200, {
      object: "list",
      data: [
        {
          id: MODEL,
          object: "model",
          created: Math.floor(Date.now() / 1_000),
          owned_by: "nova-local",
        },
      ],
    });
    return;
  }

  if (request.method === "POST" && url.endsWith("/chat/completions")) {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      // 与 NOVA 侧 32KB 的信任边界保持一致
      if (raw.length > 32_768) request.destroy();
    });
    request.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        send(400, { error: { message: "请求体不是合法 JSON" } });
        return;
      }
      send(200, handleChat(body));
    });
    return;
  }

  send(404, { error: { message: `未知路由：${request.method} ${url}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `NOVA 本地 Agent 已启动：http://127.0.0.1:${PORT}/v1（模型 ${MODEL}）`,
  );
});
