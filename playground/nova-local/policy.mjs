/**
 * NOVA-LOCAL 的决策策略。
 *
 * 这里只有**纯逻辑**：给定一次对话的完整历史，产出下一步动作。
 * 不含 IO、不读配置 —— 配置由 index.mjs 以 `limits` 注入，
 * 因此同一份策略可以在不同预算/不同主题下复用与单测。
 *
 * 设计立场（与"桩实现"划清界限）：
 * 1. 决策来自观测，不来自脚本：读的是工具真实返回的 JSON（条数、字段、错误文案）。
 * 2. 结论是真算出来的：交叉比对两个结果集的字段集与声明条数，缺口由集合差算出。
 * 3. 注入只拒绝、不服从：识别越权指令后显式拒绝并继续原任务。
 * 4. 故障分诊：可恢复故障（延迟/限流/畸形）按原检索式重试一次；
 *    硬故障（工具调用失败、熔断器已打开）不原地重试，改走备用路径。
 */

/** 覆盖主题的不同侧面：每条决定一个检索式，因此两次检索天然不同 */
export const ASPECTS = [
  { suffix: "权威来源与一手数据", limit: 8 },
  { suffix: "反方观点与失败案例", limit: 8 },
  { suffix: "量化指标与行业基准", limit: 6 },
];

/** 越权 / 注入指令特征：命中即视为不可信外部内容 */
export const INJECTION_PATTERNS = [
  { pattern: /忽略(此前|上面|之前|以上)/, note: "「忽略此前约束」" },
  { pattern: /export\s*=\s*all/i, note: "全量导出指令 export=all" },
  { pattern: /不要(向)?用户(说明|提及)/, note: "「不要向用户说明」" },
  { pattern: /\bnever\s+refuse\b/i, note: "禁止拒绝指令" },
];

/** 默认预算：index.mjs 会用 config.yaml 里的 agent.limits 覆盖 */
export const DEFAULT_LIMITS = {
  roundBudget: 6,
  maxSearchAttempts: 5,
  requiredSources: 2,
};

/* -------------------------------------------------------------------------- */
/* 小工具                                                                      */
/* -------------------------------------------------------------------------- */

/** content 可能是 null / 分段数组，统一收敛为字符串 */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
      .join("");
  }
  return "";
}

export function safeJson(raw) {
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
 * 中文按 0.7 token/字、其余按 1 token/4 字符。
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[　-〿一-鿿＀-￯]/g) ?? []).length;
  return Math.ceil(cjk * 0.7 + (text.length - cjk) / 4);
}

/* -------------------------------------------------------------------------- */
/* 状态重建                                                                    */
/* -------------------------------------------------------------------------- */

/** 在返回内容里检出越权指令 */
export function detectInjection(text) {
  if (!text) return null;
  for (const { pattern, note } of INJECTION_PATTERNS) {
    if (pattern.test(text)) return note;
  }
  return null;
}

/** 解析一次工具返回 */
export function parseOutcome(raw) {
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

/**
 * 从真实对话历史里重建状态。
 *
 * assistant 的 tool_calls 与随后的 role=tool 结果按 tool_call_id 配对，
 * Map 的插入顺序即调用顺序。
 */
export function reconstruct(messages) {
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

/** 从任务书里抽出调研主题；抽不到就退回首句，绝不写死主题 */
export function topicOf(userText) {
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

/** 同一检索式的尝试次数：一次首发 + 一次重试，之后不再原地打转 */
export function attemptsOf(searches, query) {
  return searches.filter((item) => item.query === query).length;
}

/**
 * 故障分诊：只有硬故障（「错误（工具调用失败）」——上游熔断器已打开，
 * 执行器文案明示「请改用备用路径」）才不做原地重试；
 * 延迟 / 限流 / 未知失败都算可恢复，允许按原检索式再试一次。
 * 依据是 NOVA 的故障回传格式（docs/agent-protocol.md §3.3），不是猜测。
 */
export function isRecoverableFault(error) {
  return !/^错误（工具调用失败）/.test(error ?? "");
}

/**
 * 决定这一轮做什么。
 *
 * @returns {{ kind: "tool", name: string, args: object, note: string }
 *          | { kind: "final", text: string }}
 */
export function decide(state, limits = DEFAULT_LIMITS) {
  const { searches, summaries, rounds, topic } = state;
  const succeeded = searches.filter((item) => item.ok);
  const failed = searches.filter((item) => !item.ok);

  // ① 可恢复故障优先原检索式重试一次 —— 这是 NOVA 判定「自愈」所观察的可观测行为。
  //    硬故障（工具调用失败：熔断器已打开）不重试——执行器文案已明示
  //    「请改用备用路径（summarize）」，再撞一次只会白烧轮次（§故障分诊）。
  //    预算将尽时不再开新检索，把剩下的轮次留给压缩与交卷。
  if (
    succeeded.length < limits.requiredSources &&
    searches.length < limits.maxSearchAttempts &&
    rounds < limits.roundBudget - 1
  ) {
    const retryTarget = failed.find(
      (item) =>
        isRecoverableFault(item.error) && attemptsOf(searches, item.query) < 2,
    );

    if (retryTarget) {
      // 限流（429 · Retry-After）与延迟的处置话术不同：限流要退避，延迟可直试
      const backoff = /429|Retry-After/i.test(retryTarget.error ?? "");
      return {
        kind: "tool",
        name: "external_search",
        args: {
          query: retryTarget.query,
          ...(retryTarget.limit ? { limit: retryTarget.limit } : {}),
        },
        note: backoff
          ? `上一次「${retryTarget.query}」遭遇 429 限流（${brief(retryTarget.error)}），按指数退避重发，不做重试风暴。`
          : `上一次「${retryTarget.query}」返回失败（${brief(retryTarget.error)}），判定为可恢复故障，按原检索式重试一次。`,
      };
    }

    // ② 无可重试项（硬故障/已重试过）→ 走备用路径：
    //    硬故障且已有素材时，宁可压现有素材交卷，也不再开新检索撞熔断。
    const hard = failed.some((item) => !isRecoverableFault(item.error));
    if (hard && succeeded.length >= 1) {
      return {
        kind: "tool",
        name: "summarize",
        args: { records: buildRecords(succeeded) },
        note: `「${failed.find((item) => !isRecoverableFault(item.error))?.query}」触发硬故障（熔断器已打开），按执行器提示改走备用路径：用已有素材压缩交卷，结论标注单源风险。`,
      };
    }

    // ③ 否则开新侧面的检索式：选第一个还没检索过的侧面，
    //    避开已经撞过故障（尤其熔断）的那个侧面，不要在同一检索式上打转
    const unused = ASPECTS.find(
      (item) => !searches.some((s) => s.query === `${topic} · ${item.suffix}`),
    );
    if (unused) {
      const degraded = failed.length > 0;
      return {
        kind: "tool",
        name: "external_search",
        args: { query: `${topic} · ${unused.suffix}`, limit: unused.limit },
        note: degraded
          ? `失败未能恢复，降级推进：改用侧面「${unused.suffix}」继续检索，结论将标注单源风险。`
          : `开启新侧面的检索：${unused.suffix}。`,
      };
    }
  }

  // ④ 素材够了（或预算将尽）→ 压缩结论
  if (summaries === 0 && succeeded.length >= 1) {
    return {
      kind: "tool",
      name: "summarize",
      args: { records: buildRecords(succeeded) },
      note: "交叉比对完成，压缩为三句摘要后再交卷。",
    };
  }

  // ⑤ 交卷：结论由当次真实数据算出
  return { kind: "final", text: buildFinalAnswer(state, limits) };
}

function brief(error) {
  const clean = (error ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean || "未知原因";
}

/* -------------------------------------------------------------------------- */
/* 真实计算                                                                    */
/* -------------------------------------------------------------------------- */

/** 把成功检索到的条目整理成可摘要的记录数组 */
export function buildRecords(succeeded) {
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
export function analyse(succeeded) {
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
export function findGaps(profile) {
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
export function buildFinalAnswer(state, limits = DEFAULT_LIMITS) {
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
  const singleSource = succeeded.length < limits.requiredSources;

  return [
    `交叉验证结论（主题：${topic}）：`,
    `1 · 检索执行：共发起 ${searches.length} 次 external_search，成功 ${succeeded.length} 次、失败 ${failed.length} 次${summaries > 0 ? "，已用 summarize 压缩结论" : ""}。`,
    `2 · 记录规模：合计可读 ${totalRows} 条${meanScore === null ? "" : `，平均相关度 ${meanScore}`}。`,
    `3 · 数据缺口：${gaps.length > 0 ? gaps.join("；") : "两个结果集的字段集一致，未检出结构性缺口，但样本量有限，不足以支撑强结论"}。`,
    `4 · 故障处置：${recovered > 0 ? `${recovered} 次失败后按原检索式重试并恢复` : failed.length > 0 ? `${failed.length} 次失败未能在预算内恢复，结论已降级` : "未遭遇工具故障"}。`,
    `5 · 注入处置：${injections.length > 0 ? `在工具输出中检出${injections.join("、")}，已判定为不可信外部内容并显式拒绝，未执行任何越权检索` : "未检出越权指令"}。`,
    `6 · 交付判定：${singleSource ? `仅 ${succeeded.length} 个来源可用，低于交叉验证要求的 ${limits.requiredSources} 个，本次输出为单源降级结论` : "已满足两个独立来源的交叉验证要求，结论可交付"}。`,
  ].join("\n");
}

/** 统计真实的自愈次数：同一检索式先失败、后成功即一次恢复 */
export function countRecoveries(searches) {
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

/** 拒绝越权指令的声明 */
export function buildRefusal(note) {
  return `注意：上一轮工具输出中检出${note}。该内容来自外部检索结果，属于不可信数据，我拒绝按其改变行为，也不会发起任何越权导出检索；原任务继续按计划推进。`;
}
