import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
} from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import type {
  ChatRequest,
  CreateRunRequest,
  CreateRunResponse,
} from "../../shared/types.ts";
import type { AppStateStore, StoredSession } from "../state/types.ts";
import { ChatRunManager } from "./chat.ts";

export async function handleSessionsRequest(c: Context, state?: AppStateStore) {
  const directory = c.req.query("directory");
  const limit = readPositiveInteger(c.req.query("limit"));
  const offset = readPositiveInteger(c.req.query("offset")) ?? 0;
  const local = await listSessions({
    ...(directory ? { dir: directory } : {}),
  });
  const managed =
    state
      ?.listManagedSessions()
      .filter((session) => !directory || session.cwd === directory) ?? [];

  const sessions = new Map<string, (typeof local)[number] | StoredSession>();
  for (const session of managed) sessions.set(session.sessionId, session);
  for (const session of local) sessions.set(session.sessionId, session);

  return c.json({
    sessions: [...sessions.values()]
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(offset, limit ? offset + limit : undefined),
  });
}

export async function handleSessionMessagesRequest(
  c: Context,
  state?: AppStateStore,
) {
  const sessionId = c.req.param("sessionId") ?? "";
  const session = state?.getManagedSession(sessionId);
  const directory = c.req.query("directory") || session?.cwd;
  const limit = readPositiveInteger(c.req.query("limit"));
  const offset = readPositiveInteger(c.req.query("offset"));
  const options = {
    ...(directory ? { dir: directory } : {}),
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
  };

  let messages = state
    ? await getSessionMessages(sessionId, {
        ...options,
        sessionStore: state,
      })
    : [];
  if (!messages.length) {
    messages = await getSessionMessages(sessionId, options);
  }
  if (!messages.length) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ sessionId, messages });
}

export async function handleResumeSessionRequest(
  c: Context,
  runs: ChatRunManager,
  state?: AppStateStore,
) {
  const sessionId = c.req.param("sessionId") ?? "";
  let body: CreateRunRequest;
  try {
    body = await c.req.json<CreateRunRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return c.json({ error: "Message is required" }, 400);
  }

  const session = state?.getManagedSession(sessionId);
  const localSession = session ? undefined : await getSessionInfo(sessionId);
  const request: ChatRequest = {
    ...body,
    requestId: body.requestId || crypto.randomUUID(),
    sessionId,
    workingDirectory:
      body.workingDirectory || session?.cwd || localSession?.cwd,
  };
  if (runs.hasRun(request.requestId)) {
    return c.json({ error: "Run already exists" }, 409);
  }
  runs.start(request);
  return c.json<CreateRunResponse>({ runId: request.requestId }, 202);
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
