import "server-only";

import type { EndpointProbe } from "@/lib/nova";
import { normalizeEndpoint } from "@/lib/nova";

/**
 * 本地 Agent 端点探针。
 *
 * 接入向导需要回答一个问题：「用户填的这个地址到底能不能跑 NOVA？」——
 * 与其让用户提交完再去沙盒里试错，不如在这里先把协议与可达性验掉。
 *
 * 为什么由服务端发请求：Agent 端点通常只监听 127.0.0.1，浏览器无法直连；
 * 同时密钥只存在于服务端环境变量，探测时也不该经过客户端。
 */
/** 单次请求体上限，远低于实际需要的长度 */
const MAX_BODY_BYTES = 4_096;

/** 响应体读取上限：探针只需要判断结构，不该把大 JSON 读进内存 */
const MAX_RESPONSE_BYTES = 64 * 1024;

/** 探测超时。端点是本机或同网段，超过 4s 基本就是配错了 */
const PROBE_TIMEOUT_MS = 4_000;

/** 这是一个 SSRF 原语，必须挡住云厂商的元数据地址 */
const BLOCKED_HOSTS = [
  /^169\.254\./,
  /^metadata\./i,
  /^metadata$/i,
  /^instance-data$/i,
];

export async function POST(request: Request) {
  let endpoint: string;

  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: "请求体过大" }, 413);
    }
    endpoint = String(JSON.parse(text).endpoint ?? "").trim();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  const url = parseEndpoint(endpoint);
  if ("error" in url) {
    return json({ error: url.error, hint: url.hint }, 400);
  }

  return json(await probe(normalizeEndpoint(url.href)));
}

export async function GET() {
  return new Response("本地 Agent 端点探针仅接受 POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/* -------------------------------------------------------------------------- */
/* 探测                                                                        */
/* -------------------------------------------------------------------------- */

type ParsedEndpoint = { href: string } | { error: string; hint?: string };

function parseEndpoint(raw: string): ParsedEndpoint {
  if (!raw) {
    return { error: "缺少 endpoint" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      error: "端点不是合法 URL",
      hint: "应当形如 http://127.0.0.1:11434/v1 —— 记得带 /v1 前缀。",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `不支持的协议：${url.protocol}` };
  }

  if (BLOCKED_HOSTS.some((pattern) => pattern.test(url.hostname))) {
    return {
      error: "该主机不允许被探测",
      hint: "云厂商的元数据端点不是模型服务。",
    };
  }

  return { href: url.href };
}

/** GET {endpoint}/models，返回结构化的探测结论 */
async function probe(endpoint: string): Promise<EndpointProbe> {
  const url = `${endpoint}/models`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      reachable: false,
      openaiCompatible: false,
      models: [],
      latencyMs: Date.now() - startedAt,
      message: timedOut
        ? `端点在 ${PROBE_TIMEOUT_MS / 1_000}s 内没有响应`
        : `无法连接 ${endpoint}`,
      hint: timedOut
        ? "确认模型服务已经启动，并且监听地址不是仅限容器的 127.0.0.1。"
        : "确认端口号正确、且该进程允许来自本机的 HTTP 请求。",
    };
  }

  const latencyMs = Date.now() - startedAt;

  if (response.status === 401 || response.status === 403) {
    return {
      reachable: true,
      openaiCompatible: false,
      models: [],
      latencyMs,
      message: `端点可达，但拒绝了当前请求（${response.status}）`,
      hint: "密钥缺失或无效。这不影响可达性结论，但跑沙盒前需要配好 LLM_API_KEY。",
    };
  }

  if (!response.ok) {
    return {
      reachable: true,
      openaiCompatible: false,
      models: [],
      latencyMs,
      message: `${url} 返回 ${response.status}`,
      hint: "确认地址指向的是 OpenAI 兼容的 /v1 根，而不是某个具体路由。",
    };
  }

  const body = await readBoundedText(response);
  if (body === null) {
    return {
      reachable: true,
      openaiCompatible: false,
      models: [],
      latencyMs,
      message: "模型清单响应体过大或读取失败",
      hint: "该地址可能不是模型服务。",
    };
  }

  let models: string[] = [];
  try {
    const parsed = JSON.parse(body) as { data?: unknown };
    if (Array.isArray(parsed.data)) {
      models = parsed.data
        .map((item) => (item as { id?: unknown }).id)
        .filter((id): id is string => typeof id === "string");
    }
  } catch {
    // 结构不对会在下面的 openaiCompatible 判定里体现
  }

  const openaiCompatible = models.length > 0;

  return {
    reachable: true,
    openaiCompatible,
    models,
    latencyMs,
    message: openaiCompatible
      ? null
      : "响应不是 OpenAI 兼容的模型清单（缺少 data[].id）",
    hint: openaiCompatible
      ? null
      : 'NOVA 需要 { "data": [{ "id": "..." }] } 这种结构来选模型。',
  };
}

/** 最多读 `MAX_RESPONSE_BYTES` 字节，多了直接放弃而不是无上限累积 */
async function readBoundedText(response: Response): Promise<string | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
