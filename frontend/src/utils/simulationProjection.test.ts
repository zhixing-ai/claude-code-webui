import { describe, expect, it } from "vitest";
import type { SDKMessage } from "../types";
import {
  createEmptySimulationState,
  reduceSimulationEvent,
  replaySimulationMessages,
  SIMULATION_REPORT_TOOL_NAME,
} from "./simulationProjection";

const scenario = {
  id: "negotiation",
  title: "讨价还价",
  stage: "成交",
  description: "成交前争取权益",
  persona: "关注总价的客户",
  objective: "守住边界并推进成交",
  cases: [],
};

const result = {
  scenarioId: scenario.id,
  summary: "边界稳定",
  cases: [],
};

function toolCall(id: string, input: Record<string, unknown>): SDKMessage {
  return {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id, name: SIMULATION_REPORT_TOOL_NAME, input },
      ],
    },
  } as SDKMessage;
}

function structuredOutput(
  id: string,
  input: Record<string, unknown>,
): SDKMessage {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: "StructuredOutput", input }],
    },
  } as SDKMessage;
}

function toolResult(id: string, isError = false): SDKMessage {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: isError }],
    },
  } as SDKMessage;
}

describe("simulationProjection", () => {
  it("replays successful reporter calls and ignores rejected ones", () => {
    const state = replaySimulationMessages([
      toolCall("design", { kind: "design_started" }),
      toolResult("design"),
      toolCall("scenarios", {
        kind: "scenarios_generated",
        scenarios: [scenario],
      }),
      toolResult("scenarios"),
      toolCall("run", {
        kind: "run_started",
        scenarioIds: [scenario.id],
      }),
      toolResult("run"),
      toolCall("complete", { kind: "simulation_completed", result }),
      toolResult("complete"),
      toolCall("rejected", { kind: "design_started" }),
      toolResult("rejected", true),
    ]);

    expect(state).toMatchObject({
      status: "ready",
      scenarios: [scenario],
      runningScenarioIds: [],
      results: { [scenario.id]: result },
    });
  });

  it("restores combined scenarios and results from persisted StructuredOutput", () => {
    const state = replaySimulationMessages([
      structuredOutput("combined", {
        scenarios: [scenario],
        results: [result],
      }),
      toolResult("combined"),
    ]);

    expect(state).toMatchObject({
      status: "ready",
      scenarios: [scenario],
      runningScenarioIds: [],
      results: { [scenario.id]: result },
    });
  });

  it("does not leave an incomplete historical workflow spinning forever", () => {
    const state = replaySimulationMessages([
      toolCall("design", { kind: "design_started", runAfterDesign: true }),
      toolResult("design"),
    ]);

    expect(state).toMatchObject({
      status: "error",
      runningScenarioIds: [],
    });
    expect(state.error).toContain("未返回完整结构化结果");
  });

  it("fails closed instead of crashing on an unknown or malformed live event", () => {
    expect(() =>
      reduceSimulationEvent(createEmptySimulationState(), {
        kind: "unexpected_event",
      } as never),
    ).not.toThrow();
    expect(
      reduceSimulationEvent(createEmptySimulationState(), {
        kind: "simulation_completed",
      } as never),
    ).toMatchObject({
      status: "error",
      runningScenarioIds: [],
    });
  });
});
