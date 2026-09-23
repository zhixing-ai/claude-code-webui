import { describe, it, expect, vi } from "vitest";
import {
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { queryWithTaskLifetime } from "./query-lifecycle.ts";
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

const result = (error = false) =>
  ({ type: "result", is_error: error }) as SDKMessage;
const task = (subtype: string, id: string, status = "completed") =>
  ({ type: "system", subtype, task_id: id, status }) as SDKMessage;

async function run(messages: SDKMessage[], cancel = false, fail = false) {
  const controller = new AbortController();
  const closedAt: number[] = [];
  let inputClosed = false;
  let count = 0;
  let drain: Promise<unknown>;
  vi.mocked(query).mockImplementation(({ prompt }) => {
    return {
      async *[Symbol.asyncIterator]() {
        const iterator = (prompt as AsyncIterable<SDKUserMessage>)[
          Symbol.asyncIterator
        ]();
        expect((await iterator.next()).value.message.content).toBe("train");
        drain = iterator.next().then(() => {
          inputClosed = true;
          closedAt.push(count);
        });
        for (const message of messages) {
          count++;
          yield message;
          await Promise.resolve();
          await Promise.resolve();
          if (cancel && count === 2) controller.abort();
        }
        if (fail) throw new Error("transport failed");
        await drain;
        expect(inputClosed).toBe(true);
      },
    } as ReturnType<typeof query>;
  });
  const seen: SDKMessage[] = [];
  try {
    for await (const m of queryWithTaskLifetime("train", {
      abortController: controller,
    }))
      seen.push(m);
  } finally {
    await drain!;
  }
  return { seen, closedAt };
}

describe("managed SDK task lifetime", () => {
  it("keeps authorization input open after parent result, until child and final summary finish", async () => {
    const messages = [
      task("task_started", "a"),
      result(),
      task("task_notification", "a"),
      result(),
    ];
    const { seen, closedAt } = await run(messages);
    expect(seen).toEqual(messages);
    expect(closedAt).toEqual([4]);
  });
  it("handles multiple, nested and duplicate task events without closing on intermediate results", async () => {
    const { closedAt } = await run([
      task("task_started", "a"),
      task("task_started", "a"),
      task("task_started", "b"),
      result(),
      task("task_notification", "a"),
      task("task_notification", "a"),
      result(),
      task("task_started", "c"),
      task("task_notification", "b", "failed"),
      result(),
      task("task_notification", "c", "stopped"),
      result(),
    ]);
    expect(closedAt).toEqual([12]);
  });
  it("closes an ordinary turn", async () => {
    expect((await run([result()])).closedAt).toEqual([1]);
  });
  it("does not wait forever on a terminal error result", async () => {
    expect(
      (await run([task("task_started", "a"), result(true)])).closedAt,
    ).toEqual([2]);
  });
  it("releases pending input on cancellation", async () => {
    expect(
      (await run([task("task_started", "a"), result()], true)).closedAt,
    ).toEqual([2]);
  });
  it("releases pending input when transport fails", async () => {
    await expect(run([task("task_started", "a")], false, true)).rejects.toThrow(
      "transport failed",
    );
  });
});
