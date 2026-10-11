/**
 * 客户端 SSE 流读取器。
 *
 * 沙盒运行与对话验证接口都是「单次 POST + 流式响应」形态，
 * 服务端按 `data: {json}\n\n` 帧编码。读取逻辑在这里收敛一份，
 * 两个消费方共用同一套分帧与容错约定。
 * 客户端安全（纯 fetch 流处理），随 `@/lib/nova` 出口导出。
 */

/**
 * 读取 SSE 流并逐帧回调；回调返回 "stop" 时立即取消读取。
 *
 * 单帧解析失败不中断整条流（服务端与客户端版本短暂不一致时，
 * 一帧坏数据不应毁掉后面几十帧有效事件）。
 */
export async function readSseStream<T>(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: T) => "continue" | "stop",
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abortHandler = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abortHandler);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分帧；末尾可能是不完整的片段，留给下一批
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;

        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);

        if (!data) continue;

        try {
          if (onEvent(JSON.parse(data) as T) === "stop") {
            await reader.cancel().catch(() => undefined);
            return;
          }
        } catch {
          // 单帧解析失败不应中断整条流
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }
}
