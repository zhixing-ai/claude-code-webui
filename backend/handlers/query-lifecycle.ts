import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/** Keep the SDK control channel alive across background-agent parent turns. */
export async function* queryWithTaskLifetime(
  prompt: string,
  options: Options,
): AsyncGenerator<SDKMessage> {
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signal = options.abortController?.signal;
  signal?.addEventListener("abort", release, { once: true });
  if (signal?.aborted) release();

  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: { role: "user", content: prompt },
    };
    await finished;
  }

  const pendingTasks = new Set<string>();
  try {
    for await (const message of query({ prompt: input(), options })) {
      if (message.type === "system") {
        if (message.subtype === "task_started") {
          pendingTasks.add(message.task_id);
        } else if (message.subtype === "task_notification") {
          pendingTasks.delete(message.task_id);
        }
      }
      // Notifications precede the parent's follow-up turn. Do not close on the
      // last notification: the parent may still call tools or launch more work.
      // SDK 0.3.220 declares an idle event, but CLI 2.1.220 does not emit it here.
      if (
        message.type === "result" &&
        (message.is_error || pendingTasks.size === 0)
      ) {
        release();
      }
      yield message;
    }
  } finally {
    release();
    signal?.removeEventListener("abort", release);
  }
}
