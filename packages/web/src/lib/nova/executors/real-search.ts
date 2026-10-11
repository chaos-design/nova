import "server-only";

/**
 * 真实外部检索：多源聚合，全部真实数据、没有伪造语料。
 *
 * - 主源 Wikipedia API（en + zh）：免密钥、稳定 JSON、技术主题相关性好；
 * - 补位源 Bing RSS（cn.bing.com）：web 范围更宽，Wikipedia 不足额时填充。
 *
 * 这是对话验证路径里 external_search 的唯一数据源 —— 工具结果必须来自
 * 真实互联网，"验证"才不是演戏。两个源都是尽力而为的公开接口：网络
 * 不可达、限流或结构变化会以可读错误抛出，由执行器作为真实工具失败
 * 回灌给 Agent —— 失败本身也是可观测数据，Agent 的降级路径因此有东西
 * 可验证。
 */

/** 单条真实检索结果 */
export interface RealSearchItem {
  title: string;
  url: string;
  /** 纯文本摘要 */
  snippet: string;
  /** 结果来自哪个真实源，Agent 引用时可以标注 */
  source: "wikipedia" | "bing";
}

export interface RealSearchResult {
  query: string;
  count: number;
  items: RealSearchItem[];
}

/** 单源超时（毫秒）；真实网络的失败要让 Agent 看得见 */
const SOURCE_TIMEOUT_MS = 10_000;

export async function realExternalSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<RealSearchResult> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20);
  const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // 两类源并行跑：某个源挂了不拖垮整体，也不让结果集空在半路
  const [wiki, bing] = await Promise.allSettled([
    searchWikipedia(query, bounded, merged),
    searchBingRss(query, bounded, merged),
  ]);

  const items: RealSearchItem[] = [
    ...(wiki.status === "fulfilled" ? wiki.value : []),
    ...(bing.status === "fulfilled" ? bing.value : []),
  ].slice(0, bounded);

  // 两个源全部失败才算检索失败；部分失败时结果仍是真实的
  if (items.length === 0) {
    const reason =
      wiki.status === "rejected"
        ? describe(wiki.reason)
        : bing.status === "rejected"
          ? describe(bing.reason)
          : "两个检索源均未命中";
    throw new Error(`检索未获得结果：${reason}`);
  }

  return { query, count: items.length, items };
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/* ------------------------------- Wikipedia -------------------------------- */

async function searchWikipedia(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<RealSearchItem[]> {
  const perLang = Math.ceil(limit / 1); // 每个语言独立取满，合并后统一裁剪
  const langs = ["en", "zh"] as const;

  const results = await Promise.allSettled(
    langs.map(async (lang) => {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(query)}&srlimit=${perLang}&format=json`;
      const response = await fetch(url, {
        headers: {
          // Wikimedia 对无 UA 的请求会拒绝服务
          "User-Agent":
            "NOVA-ConverseLab/1.0 (https://github.com/chaos-design/nova)",
        },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Wikipedia(${lang}) 返回 ${response.status}`);
      }

      const payload = (await response.json()) as {
        query?: {
          search?: { title: string; snippet?: string }[];
        };
      };
      const hits = payload.query?.search ?? [];

      return hits.map<RealSearchItem>((hit) => ({
        title: `${hit.title}（${lang === "en" ? "英文" : "中文"}维基百科）`,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replaceAll(" ", "_"))}`,
        snippet: stripTags(hit.snippet ?? ""),
        source: "wikipedia",
      }));
    }),
  );

  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .slice(0, limit);
}

/* --------------------------------- Bing ----------------------------------- */

async function searchBingRss(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<RealSearchItem[]> {
  const url =
    `https://cn.bing.com/search?q=${encodeURIComponent(query)}` +
    `&format=rss&count=${limit}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Bing 返回 ${response.status}`);
  }

  const xml = await response.text();
  const blocks = xml.split("<item>").slice(1, limit + 1);

  return blocks
    .map<RealSearchItem | null>((block) => {
      const title = tagOf(block, "title");
      const link = tagOf(block, "link");
      if (title.length === 0) return null;
      return {
        title,
        url: link,
        snippet: stripTags(tagOf(block, "description")),
        source: "bing",
      };
    })
    .filter((item): item is RealSearchItem => item !== null);
}

/** 提取单个 XML 标签的文本内容 */
function tagOf(block: string, name: string): string {
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"),
  );
  return match ? stripTags(match[1].trim()) : "";
}

/** 去掉高亮 / 段落标签并解码常见实体 */
function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
