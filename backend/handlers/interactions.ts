import type {
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import type {
  AskUserQuestionItem,
  InteractionResponse,
} from "../../shared/types.ts";
import type { AppStateStore } from "../state/types.ts";

type PendingInteractionBase = {
  requestId: string;
  resolve: (result: PermissionResult) => void;
  cleanup: () => void;
};

type PendingInteraction =
  | (PendingInteractionBase & {
      kind: "question";
      questions: AskUserQuestionItem[];
    })
  | (PendingInteractionBase & {
      kind: "permission";
      toolName: string;
      input: Record<string, unknown>;
      suggestions?: PermissionUpdate[];
    });

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

  constructor(private readonly state?: AppStateStore) {}

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
    const onAbort = () =>
      this.cancelInteraction(interactionId, "Request aborted");

    this.pending.set(interactionId, {
      kind: "question",
      requestId,
      questions,
      resolve: resolveResponse,
      cleanup: () => signal.removeEventListener("abort", onAbort),
    });
    this.state?.createInteraction({
      id: interactionId,
      runId: requestId,
      kind: "question",
      input: { questions },
      status: "pending",
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) this.cancelRequest(requestId, "Request aborted");

    return { interactionId, response };
  }

  createPermission(
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    suggestions: PermissionUpdate[] | undefined,
    signal: AbortSignal,
  ) {
    const interactionId = crypto.randomUUID();
    let resolveResponse!: (result: PermissionResult) => void;
    const response = new Promise<PermissionResult>((resolve) => {
      resolveResponse = resolve;
    });
    const onAbort = () =>
      this.cancelInteraction(interactionId, "Request aborted");

    this.pending.set(interactionId, {
      kind: "permission",
      requestId,
      toolName,
      input,
      suggestions,
      resolve: resolveResponse,
      cleanup: () => signal.removeEventListener("abort", onAbort),
    });
    this.state?.createInteraction({
      id: interactionId,
      runId: requestId,
      kind: "permission",
      input: { toolName, input, suggestions },
      status: "pending",
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) this.cancelRequest(requestId, "Request aborted");

    return { interactionId, response };
  }

  respond(
    interactionId: string,
    body: unknown,
  ): "ok" | "invalid" | "not_found" | "expired" {
    const pending = this.pending.get(interactionId);
    if (!pending) {
      return this.state?.getInteraction(interactionId)
        ? "expired"
        : "not_found";
    }

    if (pending.kind === "permission") {
      if (
        !isObject(body) ||
        (body.permission !== "allow" && body.permission !== "deny") ||
        (body.remember !== undefined && typeof body.remember !== "boolean") ||
        (body.mode !== undefined &&
          body.mode !== "default" &&
          body.mode !== "acceptEdits") ||
        (body.mode !== undefined && pending.toolName !== "ExitPlanMode") ||
        (body.permission === "deny" &&
          (body.remember !== undefined || body.mode !== undefined)) ||
        (body.remember === true && !pending.suggestions?.length)
      ) {
        return "invalid";
      }

      if (body.permission === "deny") {
        this.settle(
          interactionId,
          pending,
          {
            behavior: "deny",
            message: "User denied permission",
          },
          "answered",
          body as InteractionResponse,
        );
        return "ok";
      }

      const mode: "default" | "acceptEdits" | undefined =
        body.mode === "default"
          ? "default"
          : body.mode === "acceptEdits"
            ? "acceptEdits"
            : undefined;
      const updatedPermissions: PermissionUpdate[] = [
        ...(body.remember ? (pending.suggestions ?? []) : []),
        ...(mode
          ? [
              {
                type: "setMode" as const,
                mode,
                destination: "session" as const,
              },
            ]
          : []),
      ];
      this.settle(
        interactionId,
        pending,
        {
          behavior: "allow",
          updatedInput: pending.input,
          ...(updatedPermissions.length ? { updatedPermissions } : {}),
        },
        "answered",
        body as InteractionResponse,
      );
      return "ok";
    }

    if (isCancelled(body)) {
      this.settle(
        interactionId,
        pending,
        {
          behavior: "deny",
          message: "User cancelled the question",
        },
        "answered",
        body,
      );
      return "ok";
    }
    const answers = readAnswers(body, pending.questions);
    if (!answers) return "invalid";

    this.settle(
      interactionId,
      pending,
      {
        behavior: "allow",
        updatedInput: { questions: pending.questions, answers },
      },
      "answered",
      body as InteractionResponse,
    );
    return "ok";
  }

  cancelRequest(requestId: string, message: string) {
    for (const [interactionId, pending] of this.pending) {
      if (pending.requestId === requestId) {
        this.settle(
          interactionId,
          pending,
          { behavior: "deny", message },
          "interrupted",
        );
      }
    }
  }

  private cancelInteraction(interactionId: string, message: string) {
    const pending = this.pending.get(interactionId);
    if (pending) {
      this.settle(
        interactionId,
        pending,
        { behavior: "deny", message },
        "interrupted",
      );
    }
  }

  private settle(
    interactionId: string,
    pending: PendingInteraction,
    result: PermissionResult,
    status: "answered" | "interrupted",
    response?: InteractionResponse,
  ) {
    this.pending.delete(interactionId);
    this.state?.finishInteraction(interactionId, status, response);
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
  if (result === "expired") {
    return c.json({ error: "Interaction is no longer active" }, 409);
  }
  if (result === "invalid") {
    return c.json({ error: "Invalid interaction response" }, 400);
  }
  return c.json({ ok: true });
}
