import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { handleInteractionResponse, PendingInteractions } from "./interactions";

const questions = [
  {
    question: "Which format?",
    header: "Format",
    options: [
      { label: "Short", description: "Summary" },
      { label: "Long", description: "Details" },
    ],
    multiSelect: false,
  },
];

describe("PendingInteractions", () => {
  it("resumes once with answers in the original AskUserQuestion input", async () => {
    const store = new PendingInteractions();
    const pending = store.create(
      "request-1",
      questions,
      new AbortController().signal,
    );

    expect(
      store.respond(pending.interactionId, {
        answers: { "Which format?": "Short" },
      }),
    ).toBe("ok");
    await expect(pending.response).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        questions,
        answers: { "Which format?": "Short" },
      },
    });
    expect(
      store.respond(pending.interactionId, {
        answers: { "Which format?": "Long" },
      }),
    ).toBe("not_found");
  });

  it("keeps the interaction pending when an answer is missing", () => {
    const store = new PendingInteractions();
    const pending = store.create(
      "request-1",
      questions,
      new AbortController().signal,
    );

    expect(store.respond(pending.interactionId, { answers: {} })).toBe(
      "invalid",
    );
    expect(
      store.respond(pending.interactionId, {
        answers: { "Which format?": "Short" },
      }),
    ).toBe("ok");
  });

  it("denies a cancelled interaction", async () => {
    const store = new PendingInteractions();
    const pending = store.create(
      "request-1",
      questions,
      new AbortController().signal,
    );

    expect(store.respond(pending.interactionId, { cancelled: true })).toBe(
      "ok",
    );
    await expect(pending.response).resolves.toEqual({
      behavior: "deny",
      message: "User cancelled the question",
    });
  });

  it("denies every interaction belonging to an aborted request", async () => {
    const store = new PendingInteractions();
    const controller = new AbortController();
    const pending = store.create("request-1", questions, controller.signal);

    controller.abort();

    await expect(pending.response).resolves.toEqual({
      behavior: "deny",
      message: "Request aborted",
    });
    expect(store.respond(pending.interactionId, { cancelled: true })).toBe(
      "not_found",
    );
  });

  it("resumes a tool permission in place and can remember SDK suggestions", async () => {
    const store = new PendingInteractions();
    const input = { command: "npm test" };
    const suggestions: PermissionUpdate[] = [
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "npm test" }],
        behavior: "allow",
        destination: "session",
      },
    ];
    const pending = store.createPermission(
      "request-1",
      "Bash",
      input,
      suggestions,
      new AbortController().signal,
    );

    expect(
      store.respond(pending.interactionId, {
        permission: "allow",
        remember: true,
      }),
    ).toBe("ok");
    await expect(pending.response).resolves.toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: suggestions,
    });
  });

  it("denies a tool permission without ending the request", async () => {
    const store = new PendingInteractions();
    const pending = store.createPermission(
      "request-1",
      "Write",
      { file_path: "/tmp/example" },
      undefined,
      new AbortController().signal,
    );

    expect(store.respond(pending.interactionId, { permission: "deny" })).toBe(
      "ok",
    );
    await expect(pending.response).resolves.toEqual({
      behavior: "deny",
      message: "User denied permission",
    });
  });

  it("rejects remember when the SDK did not provide permission suggestions", () => {
    const store = new PendingInteractions();
    const pending = store.createPermission(
      "request-1",
      "Write",
      { file_path: "/tmp/example" },
      undefined,
      new AbortController().signal,
    );

    expect(
      store.respond(pending.interactionId, {
        permission: "allow",
        remember: true,
      }),
    ).toBe("invalid");
    expect(store.respond(pending.interactionId, { permission: "allow" })).toBe(
      "ok",
    );
  });

  it("keeps sibling permissions pending when one tool signal is aborted", async () => {
    const store = new PendingInteractions();
    const firstController = new AbortController();
    const first = store.createPermission(
      "request-1",
      "Bash",
      { command: "pwd" },
      undefined,
      firstController.signal,
    );
    const second = store.createPermission(
      "request-1",
      "Write",
      { file_path: "/tmp/example" },
      undefined,
      new AbortController().signal,
    );

    firstController.abort();
    await expect(first.response).resolves.toMatchObject({
      behavior: "deny",
      message: "Request aborted",
    });
    expect(store.respond(second.interactionId, { permission: "allow" })).toBe(
      "ok",
    );
    await expect(second.response).resolves.toMatchObject({
      behavior: "allow",
    });
  });

  it("changes the SDK session mode when ExitPlanMode is accepted", async () => {
    const store = new PendingInteractions();
    const pending = store.createPermission(
      "request-1",
      "ExitPlanMode",
      {},
      undefined,
      new AbortController().signal,
    );

    expect(
      store.respond(pending.interactionId, {
        permission: "allow",
        mode: "acceptEdits",
      }),
    ).toBe("ok");
    await expect(pending.response).resolves.toEqual({
      behavior: "allow",
      updatedInput: {},
      updatedPermissions: [
        {
          type: "setMode",
          mode: "acceptEdits",
          destination: "session",
        },
      ],
    });
  });

  it("returns 400 for incomplete answers and 404 for expired interactions", async () => {
    const store = new PendingInteractions();
    const app = new Hono();
    app.post("/api/interactions/:interactionId/respond", (c) =>
      handleInteractionResponse(c, store),
    );
    const pending = store.create(
      "request-1",
      questions,
      new AbortController().signal,
    );

    const invalid = await app.request(
      `/api/interactions/${pending.interactionId}/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: {} }),
      },
    );
    expect(invalid.status).toBe(400);

    store.cancelRequest("request-1", "Request ended");
    const expired = await app.request(
      `/api/interactions/${pending.interactionId}/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelled: true }),
      },
    );
    expect(expired.status).toBe(404);
  });
});
