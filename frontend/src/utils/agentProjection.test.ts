import { describe, expect, it } from "vitest";
import type { AgentLifecycleEvent } from "../types";
import {
  createEmptyAgentProjection,
  reduceAgentEvent,
  selectAgentRuns,
  stopActiveAgents,
} from "./agentProjection";

function reduce(events: AgentLifecycleEvent[]) {
  return events.reduce(reduceAgentEvent, createEmptyAgentProjection());
}

describe("agentProjection", () => {
  it("shows registered roles and merges queued, running, and completed events", () => {
    const state = reduce([
      {
        agentRunId: "definition:fde-evaluator",
        agentType: "fde-evaluator",
        status: "registered",
      },
      {
        agentRunId: "tool:tool-1",
        agentType: "fde-evaluator",
        status: "queued",
        toolUseId: "tool-1",
        description: "Score a case",
      },
      {
        agentRunId: "task:task-1",
        agentType: "fde-evaluator",
        status: "running",
        taskId: "task-1",
        toolUseId: "tool-1",
        lastTool: "Read",
      },
      {
        agentRunId: "task:task-1",
        agentType: "subagent",
        status: "completed",
        taskId: "task-1",
        summary: "Passed",
        usage: { totalTokens: 42, durationMs: 600 },
      },
    ]);

    expect(selectAgentRuns(state)).toEqual([
      expect.objectContaining({
        id: "tool:tool-1",
        agentType: "fde-evaluator",
        status: "completed",
        taskId: "task-1",
        description: "Score a case",
        summary: "Passed",
        lastTool: "Read",
        usage: { totalTokens: 42, durationMs: 600 },
      }),
    ]);
  });

  it("does not reactivate terminal runs and stops unfinished runs", () => {
    const completed = reduce([
      {
        agentRunId: "task:1",
        agentType: "fde-business-agent",
        status: "completed",
      },
      {
        agentRunId: "task:1",
        agentType: "fde-business-agent",
        status: "running",
        summary: "late message",
      },
      {
        agentRunId: "task:2",
        agentType: "fde-customer-simulator",
        status: "running",
      },
    ]);

    const stopped = stopActiveAgents(completed, "stopped");
    expect(stopped.byId["task:1"].status).toBe("completed");
    expect(stopped.byId["task:2"].status).toBe("stopped");
  });

  it("does not expose hidden scenario output in the merchant UI", () => {
    const state = reduce([
      {
        agentRunId: "task:hidden",
        agentType: "fde-scenario-designer",
        status: "completed",
        summary: "hidden goal and expected answer",
      },
    ]);

    expect(state.byId["task:hidden"].summary).toBeUndefined();
    expect(state.byId["task:hidden"].outputProtected).toBe(true);
  });
});
