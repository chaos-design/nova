/**
 * 文案写手的领域工具：一个算真实统计，一个连真实百科。
 *
 * | 工具 | 数据来源 | 为什么写文案需要它 |
 * | :--- | :--- | :--- |
 * | `text_stats` | 纯本地真实计算 | 字数 / 句长 / 段落 / 高频字组 / 结构体检，全是算出来的，不是估的 |
 * | `lookup_term` | 中文维基百科 REST API | 核对术语与概念是否有公开出处、拿到规范定义，避免写出不存在的东西 |
 *
 * `text_stats` 刻意不查平台字数上限：各平台规则会变，写死一份口径等于
 * 用过期事实冒充权威。这里只给**可复算的结构事实**，上限判断留给模型
 * 结合用户说明去谈。
 *
 * 边界（与协议 §5 一致）：两个工具都在 Agent 侧真实执行，结果只回灌给
 * 上游模型；NOVA 观测到的工具调用仍然只有 external_search / summarize。
 */

import { defineTool, fetchJson } from "@chaos-design/agent-kit";

const WIKI_SUMMARY_URL = "https://zh.wikipedia.org/api/rest_v1/page/summary";

/** 单次统计的文本上限：再长的稿子也该分段处理，否则上下文被自己挤爆 */
const MAX_TEXT_CHARS = 20_000;

/** 长句判定阈值（字符）：中文长句在 60 字以上明显难读 */
const LONG_SENTENCE_CHARS = 60;

/** 高频字组的停用字：单字无信息量，成组的要滤掉「的了一个」这类虚词组合 */
const STOP_CHARS = new Set(
  "的了是在和与及或而就都也很不我你他她它们这那有个被把对于从到以之其此每当只还很更能会要可则且如若因所让给对再说做着过并且以及因为所以但是如果不没有不是就是什么怎么一个我们他们这个那个可以已经还是这样那样".split(
    "",
  ),
);

/** 空段落 / 标点切分用的句末符 */
const SENTENCE_END = /[。！？!?…；;\n]+/;

function countCjk(text) {
  const matched = text.match(/[\u3400-\u9fff]/g);
  return matched ? matched.length : 0;
}

/** 高频二字字组：无需分词词典，2 字滑窗 + 停用字过滤即可暴露重复用词 */
function topBigrams(text, limit = 5) {
  const chars = text.match(/[\u3400-\u9fff]/g) ?? [];
  const counts = new Map();

  for (let index = 0; index + 1 < chars.length; index += 1) {
    const bigram = chars[index] + chars[index + 1];
    // 两字都是虚词，这个组合没有词汇意义，计入只会淹没真实用词
    if (STOP_CHARS.has(chars[index]) && STOP_CHARS.has(chars[index + 1])) {
      continue;
    }
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const textStats = defineTool({
  name: "text_stats",
  description:
    "对给定文本做真实统计与结构体检：字符数、句数、段落数、平均句长、超长句清单、重复出现的二字组合与可执行的修改建议。数字全部现算，不接受估算。",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "待体检的文本（标题 + 正文一起传入即可）",
      },
      long_sentence_threshold: {
        type: "integer",
        description: "长句判定阈值（字符数），默认 60",
        minimum: 20,
        maximum: 200,
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  handler(args) {
    const text = typeof args.text === "string" ? args.text : "";
    if (text.trim().length === 0) {
      return {
        ok: false,
        content: "错误：text 不能为空，请把待体检的文本传进来。",
      };
    }

    const capped = text.slice(0, MAX_TEXT_CHARS);
    const threshold =
      Number.isInteger(args.long_sentence_threshold) &&
      args.long_sentence_threshold >= 20
        ? args.long_sentence_threshold
        : LONG_SENTENCE_CHARS;

    const paragraphs = capped
      .split(/\n{2,}|\r\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    const sentences = capped
      .split(SENTENCE_END)
      .map((part) => part.trim())
      .filter(Boolean);

    const sentenceLengths = sentences.map((sentence) => sentence.length);
    const totalSentenceChars = sentenceLengths.reduce(
      (sum, length) => sum + length,
      0,
    );

    const longSentences = sentences
      .filter((sentence) => sentence.length > threshold)
      .sort((a, b) => b.length - a.length)
      .slice(0, 5)
      .map((sentence) => ({
        chars: sentence.length,
        preview: sentence.length > 80 ? `${sentence.slice(0, 80)}…` : sentence,
      }));

    const longestParagraph = paragraphs.reduce(
      (max, paragraph) => Math.max(max, paragraph.length),
      0,
    );

    const suggestions = [];
    if (longSentences.length > 0) {
      suggestions.push(
        `有 ${longSentences.length} 句超过 ${threshold} 字，建议在转折或并列处断句。`,
      );
    }
    if (longestParagraph > 300) {
      suggestions.push(
        `最长段落 ${longestParagraph} 字，建议按语义拆成 2~3 段，移动端阅读更友好。`,
      );
    }
    if (sentences.length > 0 && sentences.length < 4) {
      suggestions.push(
        "全文句子少于 4 句，结构偏单薄，可补一个例子或数据支撑。",
      );
    }

    const stats = {
      charsWithSpaces: capped.length,
      charsWithoutSpaces: capped.replace(/\s/g, "").length,
      cjkChars: countCjk(capped),
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      avgSentenceChars:
        sentences.length > 0 ? round(totalSentenceChars / sentences.length) : 0,
      longestSentenceChars: sentenceLengths.length
        ? Math.max(...sentenceLengths)
        : 0,
      longestParagraphChars: longestParagraph,
      overThresholdSentences: longSentences.length,
      topBigrams: topBigrams(capped),
      longSentences,
      suggestions,
      truncated: capped.length < text.length,
    };

    return {
      content: JSON.stringify({ source: "nova-text-stats", metrics: stats }),
      records: sentences.length,
    };
  },
});

const lookupTerm = defineTool({
  name: "lookup_term",
  description:
    "在中文维基百科核验一个术语 / 概念 / 人物：是否有公开条目、规范定义是什么、规范链接在哪。用于确认自己引用的概念真实存在且没写错。",
  parameters: {
    type: "object",
    properties: {
      term: {
        type: "string",
        description: "待核验的词条名，如「注意力机制」「敦煌莫高窟」",
      },
    },
    required: ["term"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const term = typeof args.term === "string" ? args.term.trim() : "";
    if (term.length === 0) {
      return { ok: false, content: "错误：term 不能为空。" };
    }
    if (term.length > 60) {
      return {
        ok: false,
        content: "错误：term 过长（上限 60 字符），请给规范词条名。",
      };
    }

    const url = `${WIKI_SUMMARY_URL}/${encodeURIComponent(term.replaceAll(" ", "_"))}`;

    let payload;
    try {
      payload = await fetchJson(url, {
        timeoutMs: ctx.timeoutMs,
        headers: { "User-Agent": "NOVA-Writer/1.0 (novelty check)" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("404")) {
        return {
          ok: false,
          content: `未命中：中文维基百科没有「${term}」条目。这不能证明概念不存在，但说明它缺少公开权威出处 —— 引用前请换检索式核实，或改用 external_search 找一手来源。`,
        };
      }
      throw error;
    }

    const extract = String(payload?.extract ?? "");
    const isDisambiguation = payload?.type === "disambiguation";

    return {
      content: JSON.stringify({
        source: "zh.wikipedia-rest",
        title: payload?.title ?? term,
        isDisambiguation,
        description: payload?.description ?? null,
        extract: extract.length > 400 ? `${extract.slice(0, 400)}…` : extract,
        url: payload?.content_urls?.desktop?.page ?? null,
        note: isDisambiguation
          ? "该词条是消歧义页：说明这个词有多种含义，正文里首次出现时必须限定语境。"
          : "摘录来自中文维基百科，正式引用请回到条目页核对全文与脚注。",
      }),
      records: 1,
    };
  },
});

/** 挂到 agent-kit 工具层的清单 */
export const writerTools = [textStats, lookupTerm];
