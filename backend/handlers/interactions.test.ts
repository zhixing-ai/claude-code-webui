import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  handleInteractionResponse,
  PendingInteractions,
} from "./interactions";

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

    expect(
      store.respond(pending.interactionId, { cancelled: true }),
    ).toBe("ok");
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
    expect(
      store.respond(pending.interactionId, { cancelled: true }),
    ).toBe("not_found");
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
