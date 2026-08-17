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

  it("accepts sandbox-test runs only in the isolated chat workspace", async () => {
    vi.clearAllMocks();

    const wrongDirectory = await handleCreateRunRequest(
      context({
        message: "start",
        runMode: "sandbox_test",
        workingDirectory: "/home/user/workspace/builder",
      }),
      runs,
    );
    const extraDirectory = await handleCreateRunRequest(
      context({
        message: "start",
        runMode: "sandbox_test",
        workingDirectory: "/home/user/workspace/chat",
        additionalDirectories: ["/system/fde-suite"],
      }),
      runs,
    );
    const accepted = await handleCreateRunRequest(
      context({
        message: "start",
        requestId: "sandbox-run",
        runMode: "sandbox_test",
        workingDirectory: "/home/user/workspace/chat",
      }),
      runs,
    );

    expect(wrongDirectory).toMatchObject({ status: 400 });
    expect(extraDirectory).toMatchObject({ status: 400 });
    expect(accepted).toMatchObject({ status: 202 });
    expect(runs.start).toHaveBeenCalledOnce();
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "sandbox-run",
        runMode: "sandbox_test",
        workingDirectory: "/home/user/workspace/chat",
      }),
    );
  });
});
