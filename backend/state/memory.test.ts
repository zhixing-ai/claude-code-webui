import { describe, expect, it } from "vitest";
import { MemoryRunStore } from "./memory.ts";

describe("MemoryRunStore", () => {
  it("replays a live run and its pending interaction in sequence", () => {
    const store = new MemoryRunStore();
    store.createRun("run-1", {
      message: "Build it",
      requestId: "run-1",
      workingDirectory: "/workspace",
    });
    store.appendRunEvent("run-1", { type: "done" });
    store.createInteraction({
      id: "interaction-1",
      runId: "run-1",
      kind: "question",
      input: {},
      status: "pending",
    });

    expect(store.getRunEvents("run-1")).toEqual([
      { sequence: 1, event: { type: "done" } },
    ]);
    expect(store.listPendingInteractions("run-1")).toHaveLength(1);
  });
});
