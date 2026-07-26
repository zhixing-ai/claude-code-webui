import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import type {
  AskUserQuestionItem,
  InteractionResponse,
} from "../../shared/types.ts";

type PendingInteraction = {
  requestId: string;
  questions: AskUserQuestionItem[];
  resolve: (result: PermissionResult) => void;
  cleanup: () => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCancelled(value: unknown): value is { cancelled: true } {
  return isObject(value) && value.cancelled === true;
}

function readAnswers(
  value: unknown,
  questions: AskUserQuestionItem[],
): Record<string, string> | null {
  if (!isObject(value) || !isObject(value.answers)) return null;
  const rawAnswers = value.answers;

  const answers = Object.fromEntries(
    questions.map(({ question }) => {
      const answer = rawAnswers[question];
      return [question, typeof answer === "string" ? answer.trim() : ""];
    }),
  );

  return Object.values(answers).every(Boolean) ? answers : null;
}

export class PendingInteractions {
  private readonly pending = new Map<string, PendingInteraction>();

  create(
    requestId: string,
    questions: AskUserQuestionItem[],
    signal: AbortSignal,
  ) {
    const interactionId = crypto.randomUUID();
    let resolveResponse!: (result: PermissionResult) => void;
    const response = new Promise<PermissionResult>((resolve) => {
      resolveResponse = resolve;
    });
    const onAbort = () => this.cancelRequest(requestId, "Request aborted");

    this.pending.set(interactionId, {
      requestId,
      questions,
      resolve: resolveResponse,
      cleanup: () => signal.removeEventListener("abort", onAbort),
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) this.cancelRequest(requestId, "Request aborted");

    return { interactionId, response };
  }

  respond(
    interactionId: string,
    body: unknown,
  ): "ok" | "invalid" | "not_found" {
    const pending = this.pending.get(interactionId);
    if (!pending) return "not_found";

    if (isCancelled(body)) {
      this.settle(interactionId, pending, {
        behavior: "deny",
        message: "User cancelled the question",
      });
      return "ok";
    }

    const answers = readAnswers(body, pending.questions);
    if (!answers) return "invalid";

    this.settle(interactionId, pending, {
      behavior: "allow",
      updatedInput: { questions: pending.questions, answers },
    });
    return "ok";
  }

  cancelRequest(requestId: string, message: string) {
    for (const [interactionId, pending] of this.pending) {
      if (pending.requestId === requestId) {
        this.settle(interactionId, pending, { behavior: "deny", message });
      }
    }
  }

  private settle(
    interactionId: string,
    pending: PendingInteraction,
    result: PermissionResult,
  ) {
    this.pending.delete(interactionId);
    pending.cleanup();
    pending.resolve(result);
  }
}

export async function handleInteractionResponse(
  c: Context,
  interactions: PendingInteractions,
) {
  let body: InteractionResponse;
  try {
    body = await c.req.json<InteractionResponse>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const result = interactions.respond(c.req.param("interactionId") ?? "", body);
  if (result === "not_found") {
    return c.json({ error: "Interaction not found" }, 404);
  }
  if (result === "invalid") {
    return c.json({ error: "Every question requires an answer" }, 400);
  }
  return c.json({ ok: true });
}
