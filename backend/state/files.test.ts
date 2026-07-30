import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PendingInteractions } from "../handlers/interactions.ts";
import { FileStateStore } from "./files.ts";

describe("FileStateStore", () => {
  let store: FileStateStore | undefined;
  let directory: string | undefined;

  function openStore(): FileStateStore {
    directory ??= mkdtempSync(join(tmpdir(), "webui-state-"));
    store = new FileStateStore(directory);
    return store;
  }

  afterEach(() => {
    store?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("persists completed state and resumes event cursors after restart", async () => {
    const first = openStore();
    first.createRun("run-1", {
      message: "Build it",
      requestId: "run-1",
      workingDirectory: "/workspace",
    });
    const firstSequence = first.appendRunEvent("run-1", { type: "done" });
    first.setRunSession("run-1", "session-1");
    first.finishRun("run-1", "completed");
    first.createInteraction({
      id: "interaction-1",
      runId: "run-1",
      kind: "question",
      input: { questions: [] },
      status: "pending",
    });
    first.finishInteraction("interaction-1", "answered", {
      answers: { Continue: "Yes" },
    });
    first.upsertSession("session-1", "/workspace", "Build it");
    const key = { projectKey: "../workspace", sessionId: "session-1" };
    await first.append(key, [
      {
        type: "user",
        uuid: "message-1",
        message: { role: "user", content: "Build it" },
      },
    ]);
    first.close();

    store = new FileStateStore(directory!);
    const secondSequence = store.appendRunEvent("run-1", {
      type: "done",
    });

    expect(store.getRun("run-1")).toMatchObject({
      sessionId: "session-1",
      status: "completed",
    });
    expect(secondSequence).toBeGreaterThan(firstSequence);
    expect(store.getRunEvents("run-1", firstSequence)).toEqual([
      { sequence: secondSequence, event: { type: "done" } },
    ]);
    expect(store.getInteraction("interaction-1")).toMatchObject({
      status: "answered",
      response: { answers: { Continue: "Yes" } },
    });
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
    const interactions = new PendingInteractions(openStore());
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

  it("interrupts unfinished work exactly once after restart", () => {
    const first = openStore();
    first.createRun("run-live", { message: "Wait", requestId: "run-live" });
    const firstSequence = first.appendRunEvent("run-live", { type: "done" });
    first.createInteraction({
      id: "interaction-live",
      runId: "run-live",
      kind: "question",
      input: {},
      status: "pending",
    });
    first.createRun("run-done", { message: "Done", requestId: "run-done" });
    first.finishRun("run-done", "completed");
    first.createInteraction({
      id: "interaction-done",
      runId: "run-done",
      kind: "question",
      input: {},
      status: "pending",
    });
    first.finishInteraction("interaction-done", "answered");
    first.close();

    store = new FileStateStore(directory!);
    const events = store.getRunEvents("run-live");
    expect(store.getRun("run-live")?.status).toBe("interrupted");
    expect(events.at(-1)).toEqual({
      sequence: expect.any(Number),
      event: {
        type: "error",
        error: "Run interrupted by server restart",
      },
    });
    expect(events.at(-1)!.sequence).toBeGreaterThan(firstSequence);
    expect(store.getInteraction("interaction-live")?.status).toBe(
      "interrupted",
    );
    expect(store.getRun("run-done")?.status).toBe("completed");
    expect(store.getInteraction("interaction-done")?.status).toBe("answered");
    store.close();

    store = new FileStateStore(directory!);
    expect(store.getRunEvents("run-live")).toHaveLength(events.length);
  });

  it("implements transcript deduplication, subpaths, and deletion", async () => {
    const current = openStore();
    const key = { projectKey: "project", sessionId: "session-1" };
    const entry = {
      type: "user" as const,
      uuid: "message-1",
      message: { role: "user" as const, content: "Hello" },
    };
    const withoutUuid = {
      type: "user" as const,
      message: { role: "user" as const, content: "Again" },
    };
    const emptyUuid = { ...entry, uuid: "" };
    current.upsertSession("session-1", "/workspace", "Hello");
    await current.append(key, [
      entry,
      entry,
      emptyUuid,
      emptyUuid,
      withoutUuid,
      withoutUuid,
    ]);
    await current.append({ ...key, subpath: "agent/research" }, [entry]);

    expect(await current.load(key)).toEqual([
      entry,
      emptyUuid,
      withoutUuid,
      withoutUuid,
    ]);
    expect(await current.listSubkeys(key)).toEqual(["agent/research"]);
    expect(await current.listSessions("project")).toEqual([
      { sessionId: "session-1", mtime: expect.any(Number) },
    ]);

    await current.delete(key);
    expect(await current.load(key)).toBeNull();
    expect(
      await current.load({ ...key, subpath: "agent/research" }),
    ).toBeNull();
    expect(current.getManagedSession("session-1")).toBeUndefined();
  });

  it("recovers the valid journal prefix after an incomplete final write", () => {
    const first = openStore();
    first.createRun("run-1", { message: "你好", requestId: "run-1" });
    first.finishRun("run-1", "completed");
    first.close();
    appendFileSync(join(directory!, "state.ndjson"), '{"version":1');

    store = new FileStateStore(directory!);
    expect(store.getRun("run-1")?.status).toBe("completed");
    store.createRun("run-2", { message: "Next", requestId: "run-2" });
    store.finishRun("run-2", "completed");
    store.close();

    store = new FileStateStore(directory!);
    expect(store.getRun("run-2")?.status).toBe("completed");
  });

  it("rejects a second writer for the same state directory", () => {
    const first = openStore();

    expect(() => new FileStateStore(directory!)).toThrow(
      "State directory is already in use",
    );

    first.close();
    store = new FileStateStore(directory!);
    store.createRun("run-1", { message: "Safe", requestId: "run-1" });
    expect(store.getRun("run-1")?.status).toBe("running");
  });

  it("takes over an expired writer lease", () => {
    directory = mkdtempSync(join(tmpdir(), "webui-state-"));
    const leaseDirectory = join(directory, "writer.lock");
    const ownerPath = join(leaseDirectory, "owner.json");
    mkdirSync(leaseDirectory);
    writeFileSync(
      ownerPath,
      JSON.stringify({ token: "stale", host: "old-sandbox", pid: 1 }),
    );
    utimesSync(ownerPath, new Date(0), new Date(0));

    store = new FileStateStore(directory);
    store.createRun("run-1", { message: "Recovered", requestId: "run-1" });

    expect(store.getRun("run-1")?.status).toBe("running");
  });
});
