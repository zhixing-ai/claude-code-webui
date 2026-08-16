import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ChatRunManager } from "./chat.ts";
import { handleCreateRunRequest } from "./runs.ts";

function context(body: unknown): Context {
  return {
    req: { json: vi.fn().mockResolvedValue(body) },
    json: vi.fn((value, status) => ({ value, status })),
  } as unknown as Context;
}

const runs = {
  hasRun: vi.fn().mockReturnValue(false),
  start: vi.fn(),
} as unknown as ChatRunManager;

describe("create run session identity", () => {
  it("rejects ambiguous or invalid caller session IDs", async () => {
    const ambiguous = await handleCreateRunRequest(
      context({
        message: "start",
        newSessionId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
      }),
      runs,
    );
    const invalid = await handleCreateRunRequest(
      context({ message: "start", newSessionId: "not-a-uuid" }),
      runs,
    );
    const invalidPrompt = await handleCreateRunRequest(
      context({ message: "start", systemPrompt: " " }),
      runs,
    );
    const invalidMode = await handleCreateRunRequest(
      context({ message: "start", runMode: "customer" }),
      runs,
    );

    expect(ambiguous).toMatchObject({ status: 400 });
    expect(invalid).toMatchObject({ status: 400 });
    expect(invalidPrompt).toMatchObject({ status: 400 });
    expect(invalidMode).toMatchObject({ status: 400 });
  });
});
