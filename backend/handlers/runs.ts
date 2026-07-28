import type { Context } from "hono";
import type {
  ChatRequest,
  CreateRunRequest,
  CreateRunResponse,
} from "../../shared/types.ts";
import type { AppStateStore } from "../state/types.ts";
import { ChatRunManager, streamResponse } from "./chat.ts";

function readCreateRunRequest(value: unknown): CreateRunRequest | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { message?: unknown }).message !== "string" ||
    !(value as { message: string }).message.trim()
  ) {
    return null;
  }
  return value as CreateRunRequest;
}

export async function handleCreateRunRequest(c: Context, runs: ChatRunManager) {
  let body: CreateRunRequest | null;
  try {
    body = readCreateRunRequest(await c.req.json());
  } catch {
    body = null;
  }
  if (!body) return c.json({ error: "Invalid run request" }, 400);

  const request: ChatRequest = {
    ...body,
    requestId: body.requestId || crypto.randomUUID(),
  };
  if (runs.hasRun(request.requestId)) {
    return c.json({ error: "Run already exists" }, 409);
  }
  runs.start(request);
  return c.json<CreateRunResponse>({ runId: request.requestId }, 202);
}

export function handleRunEventsRequest(
  c: Context,
  runs: ChatRunManager,
  state?: AppStateStore,
) {
  const runId = c.req.param("runId") ?? "";
  if (!runId || (!runs.hasRun(runId) && !state?.getRun(runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  const after = Number.parseInt(c.req.query("after") || "0", 10);
  return streamResponse(
    runs.createEventStream(runId, Number.isFinite(after) ? after : 0),
  );
}

export function handleRunRequest(c: Context, state?: AppStateStore) {
  const run = state?.getRun(c.req.param("runId") ?? "");
  return run
    ? c.json(run)
    : c.json({ error: "Run not found or persistence is disabled" }, 404);
}

export function handleRunInteractionsRequest(
  c: Context,
  state?: AppStateStore,
) {
  if (!state) {
    return c.json({ error: "Interaction persistence is disabled" }, 501);
  }
  const runId = c.req.param("runId") ?? "";
  if (!state.getRun(runId)) return c.json({ error: "Run not found" }, 404);
  return c.json({ interactions: state.listPendingInteractions(runId) });
}

export function handleInteractionRequest(c: Context, state?: AppStateStore) {
  const interaction = state?.getInteraction(c.req.param("interactionId") ?? "");
  return interaction
    ? c.json(interaction)
    : c.json({ error: "Interaction not found" }, 404);
}
