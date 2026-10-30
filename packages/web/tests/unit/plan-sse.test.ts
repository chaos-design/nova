import { describe, expect, it } from "vitest";
import { readSseStream } from "@/lib/nova";

/**
 * [V-07] SSE 分帧、容错与中止。
 *
 * 服务端按 `data: {json}\n\n` 输出；客户端必须能处理「一帧被拆到两个
 * chunk」「一个 chunk 里有多帧」「坏帧」「中止」这几种真实网络形态。
 */

const encoder = new TextEncoder();

function streamOf(chunks: readonly (string | Uint8Array)[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

async function collect(
  body: ReadableStream<Uint8Array>,
  options: { stopAfter?: number } = {},
) {
  const events: number[] = [];
  await readSseStream<{ n: number }>(
    body,
    new AbortController().signal,
    (event) => {
      events.push(event.n);
      return options.stopAfter !== undefined &&
        events.length >= options.stopAfter
        ? "stop"
        : "continue";
    },
  );
  return events;
}

describe("[V-07] SSE 分帧、容错与中止", () => {
  it("一个 chunk 里的多帧按顺序全部投递", async () => {
    const events = await collect(
      streamOf(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n']),
    );
    expect(events).toEqual([1, 2, 3]);
  });

  it("帧被拆到两个 chunk 时等到边界再解析", async () => {
    const events = await collect(
      streamOf(['data: {"n":1}\n\ndata: {"n"', ":2}\n\n"]),
    );
    expect(events).toEqual([1, 2]);
  });

  it("多字节字符被切在字节中间也不会乱码", async () => {
    const frame = 'data: {"n":1,"text":"中文片段"}\n\n';
    const bytes = encoder.encode(frame);

    let cut = 18;
    while (cut < bytes.length && (bytes[cut] & 0xc0) !== 0x80) cut += 1;

    const events: string[] = [];
    await readSseStream<{ text: string }>(
      streamOf([bytes.slice(0, cut), bytes.slice(cut)]),
      new AbortController().signal,
      (event) => {
        events.push(event.text);
        return "continue";
      },
    );

    expect(events).toEqual(["中文片段"]);
  });

  it("坏 JSON 帧被跳过，后续有效帧继续投递", async () => {
    const events = await collect(
      streamOf(['data: {"n":1}\n\ndata: {broken}\n\ndata: {"n":3}\n\n']),
    );
    expect(events).toEqual([1, 3]);
  });

  it("没有 data 前缀的帧被忽略", async () => {
    const events = await collect(
      streamOf(['event: ping\n\ndata: {"n":2}\n\n: comment\n\n']),
    );
    expect(events).toEqual([2]);
  });

  it("回调返回 stop 后不再投递剩余帧", async () => {
    const events = await collect(
      streamOf(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n']),
      { stopAfter: 1 },
    );
    expect(events).toEqual([1]);
  });

  it("读取中触发中止：Promise 正常收敛，不抛未处理拒绝", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"n":1}\n\n'));
      },
    });

    const abort = new AbortController();
    const events: number[] = [];

    await expect(
      readSseStream<{ n: number }>(body, abort.signal, (event) => {
        events.push(event.n);
        abort.abort();
        return "continue";
      }),
    ).resolves.toBeUndefined();

    expect(events).toEqual([1]);
  });

  it("空流立即收敛", async () => {
    const events = await collect(streamOf([]));
    expect(events).toEqual([]);
  });

  it("末尾不完整的帧在流关闭前不会被误投递", async () => {
    const events = await collect(streamOf(['data: {"n":1}\n\ndata: {"n":2}']));
    expect(events).toEqual([1]);
  });

  it("空 data 帧被忽略，不影响后续帧", async () => {
    const events = await collect(streamOf(['data: \n\ndata: {"n":9}\n\n']));
    expect(events).toEqual([9]);
  });
});
