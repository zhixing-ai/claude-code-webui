import {
  getSessionMessages,
  listSessions,
  type SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import type {
  ChatRequest,
  CreateRunRequest,
  CreateRunResponse,
} from "../../shared/types.ts";
import { ChatRunManager } from "./chat.ts";

export async function handleSessionsRequest(
  c: Context,
  sessionStore: SessionStore,
) {
  const directory = c.req.query("directory");
  const limit = readPositiveInteger(c.req.query("limit"));
  const offset = readPositiveInteger(c.req.query("offset")) ?? 0;
  const sessions = await listSessions({
    ...(directory ? { dir: directory } : {}),
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    sessionStore,
  });
  return c.json({ sessions });
}

export async function handleSessionMessagesRequest(
  c: Context,
  sessionStore: SessionStore,
) {
  const sessionId = c.req.param("sessionId") ?? "";
  const directory = c.req.query("directory");
  const limit = readPositiveInteger(c.req.query("limit"));
  const offset = readPositiveInteger(c.req.query("offset"));
  const options = {
    ...(directory ? { dir: directory } : {}),
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
  };

  const messages = await getSessionMessages(sessionId, {
    ...options,
    sessionStore,
  });
  if (!messages.length) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ sessionId, messages });
}

export async function handleResumeSessionRequest(
  c: Context,
  runs: ChatRunManager,
) {
  const sessionId = c.req.param("sessionId") ?? "";
  let body: CreateRunRequest;
  try {
    body = await c.req.json<CreateRunRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (
    typeof body.message !== "string" ||
    !body.message.trim() ||
    (body.systemPrompt !== undefined &&
      (typeof body.systemPrompt !== "string" || !body.systemPrompt.trim()))
  ) {
    return c.json(
      { error: "Message and system prompt must be non-empty strings" },
      400,
    );
  }

  const request: ChatRequest = {
    ...body,
    requestId: body.requestId || crypto.randomUUID(),
    sessionId,
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
