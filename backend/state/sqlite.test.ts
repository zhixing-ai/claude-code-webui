import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PendingInteractions } from "../handlers/interactions.ts";
import { SqliteStateStore } from "./sqlite.ts";

describe("SqliteStateStore", () => {
  let store: SqliteStateStore | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(() => {
    store?.close();
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("persists run events, interactions, sessions, and transcripts", async () => {
    store = new SqliteStateStore(":memory:");
    store.createRun("run-1", {
      message: "Build it",
      requestId: "run-1",
      workingDirectory: "/workspace",
    });
    const sequence = store.appendRunEvent("run-1", { type: "done" });
    store.createInteraction({
      id: "interaction-1",
      runId: "run-1",
      kind: "question",
      input: { questions: [] },
      status: "pending",
    });
    store.finishInteraction("interaction-1", "interrupted");
    store.upsertSession("session-1", "/workspace", "Build it");

    const key = {
      projectKey: "workspace",
      sessionId: "session-1",
    };
    await store.append(key, [
      {
        type: "user",
        uuid: "message-1",
        message: { role: "user", content: "Build it" },
      },
    ]);

    expect(store.getRunEvents("run-1")).toEqual([
      { sequence, event: { type: "done" } },
    ]);
    expect(store.getInteraction("interaction-1")?.status).toBe("interrupted");
    expect(store.getManagedSession("session-1")).toMatchObject({
      cwd: "/workspace",
      summary: "Build it",
    });
    expect(await store.load(key)).toEqual([
      {
        type: "user",
        uuid: "message-1",
        message: { role: "user", content: "Build it" },
      },
    ]);
  });

  it("distinguishes an interrupted interaction from an unknown id", () => {
    store = new SqliteStateStore(":memory:");
    const interactions = new PendingInteractions(store);
    const controller = new AbortController();
    const pending = interactions.create(
      "run-1",
      [
        {
          question: "Continue?",
          header: "Confirm",
          multiSelect: false,
          options: [
            { label: "Yes", description: "Continue" },
            { label: "No", description: "Stop" },
          ],
        },
      ],
      controller.signal,
    );

    controller.abort();

    expect(
      interactions.respond(pending.interactionId, { cancelled: true }),
    ).toBe("expired");
    expect(interactions.respond("missing", { cancelled: true })).toBe(
      "not_found",
    );
  });

  it("marks live runs and interactions interrupted after restart", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "webui-state-"));
    const path = join(temporaryDirectory, "state.sqlite");
    store = new SqliteStateStore(path);
    store.createRun("run-1", {
      message: "Wait",
      requestId: "run-1",
    });
    store.createInteraction({
      id: "interaction-1",
      runId: "run-1",
      kind: "question",
      input: {},
      status: "pending",
    });
    store.close();

    store = new SqliteStateStore(path);

    expect(store.getRun("run-1")?.status).toBe("interrupted");
    expect(store.getRunEvents("run-1").at(-1)?.event).toEqual({
      type: "error",
      error: "Run interrupted by server restart",
    });
    expect(store.getInteraction("interaction-1")?.status).toBe("interrupted");
  });
});
