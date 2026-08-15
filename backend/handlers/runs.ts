import type { Context } from "hono";
import type {
  ChatRequest,
  CreateRunRequest,
  CreateRunResponse,
} from "../../shared/types.ts";
import type { RunStateStore } from "../state/types.ts";
import { readSimulationCommand } from "../simulation.ts";
import { ChatRunManager, streamResponse } from "./chat.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCreateRunRequest(value: unknown): CreateRunRequest | null {
  const request = value as {
    message?: unknown;
    systemPrompt?: unknown;
    simulation?: unknown;
  };
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof request.message !== "string" ||
    !request.message.trim() ||
    (request.systemPrompt !== undefined &&
      (typeof request.systemPrompt !== "string" ||
        !request.systemPrompt.trim()))
  ) {
    return null;
  }
  const simulation =
    request.simulation === undefined
      ? undefined
      : readSimulationCommand(request.simulation);
  if (request.simulation !== undefined && !simulation) return null;
  return {
    ...(value as CreateRunRequest),
    ...(simulation ? { simulation } : {}),
  };
}

export async function handleCreateRunRequest(c: Context, runs: ChatRunManager) {
  let body: CreateRunRequest | null;
  try {
    body = readCreateRunRequest(await c.req.json());
  } catch {
    body = null;
  }
  if (!body) return c.json({ error: "Invalid run request" }, 400);
  if (body.newSessionId && body.sessionId) {
    return c.json(
      { error: "newSessionId and sessionId are mutually exclusive" },
      400,
    );
  }
  if (
    (body.newSessionId && !UUID.test(body.newSessionId)) ||
    (body.sessionId && !UUID.test(body.sessionId))
  ) {
    return c.json({ error: "Session IDs must be UUIDs" }, 400);
  }

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
  runStore?: RunStateStore,
) {
  const runId = c.req.param("runId") ?? "";
  if (!runId || (!runs.hasRun(runId) && !runStore?.getRun(runId))) {
    return c.json({ error: "Run not found" }, 404);
  }
  const after = Number.parseInt(c.req.query("after") || "0", 10);
  return streamResponse(
    runs.createEventStream(runId, Number.isFinite(after) ? after : 0),
  );
}

export function handleRunRequest(c: Context, runStore?: RunStateStore) {
  const run = runStore?.getRun(c.req.param("runId") ?? "");
  return run
    ? c.json(run)
    : c.json({ error: "Run not found or persistence is disabled" }, 404);
}

export function handleRunInteractionsRequest(
  c: Context,
  runStore?: RunStateStore,
) {
  if (!runStore) {
    return c.json({ error: "Interaction persistence is disabled" }, 501);
  }
  const runId = c.req.param("runId") ?? "";
  if (!runStore.getRun(runId)) return c.json({ error: "Run not found" }, 404);
  return c.json({ interactions: runStore.listPendingInteractions(runId) });
}

export function handleInteractionRequest(c: Context, runStore?: RunStateStore) {
  const interaction = runStore?.getInteraction(
    c.req.param("interactionId") ?? "",
  );
  return interaction
    ? c.json(interaction)
    : c.json({ error: "Interaction not found" }, 404);
}
