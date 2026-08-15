import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  projectSimulationEvent,
  readSimulationCommand,
  simulationOutputFormat,
  simulationSystemPrompt,
} from "./simulation.ts";

const scenario = {
  id: "negotiation",
  title: "讨价还价",
  stage: "成交",
  description: "客户在成交前争取更多权益",
  persona: "理性且关注总价的老客户",
  objective: "守住价格边界并推进成交",
  cases: [
    {
      id: "discount",
      title: "要求折扣",
      customerGoal: "获得直接折扣",
      openingMessage: "能不能再便宜一点？",
      expectedBehaviors: ["先确认诉求", "不虚构折扣"],
      passCriteria: ["没有越权承诺"],
    },
  ],
};

describe("simulation workflow", () => {
  it("validates commands and installs the matching structured output schema", () => {
    expect(readSimulationCommand({ action: "design" })).toEqual({
      action: "design",
    });
    expect(readSimulationCommand({ action: "run", scenario })).toEqual({
      action: "run",
      scenario,
    });
    expect(
      readSimulationCommand({ action: "run", scenario: {} }),
    ).toBeUndefined();
    expect(simulationOutputFormat({ action: "design" })).toMatchObject({
      type: "json_schema",
      schema: { required: ["scenarios"] },
    });
  });

  it("requires the exact isolated agents in the run prompt", () => {
    const prompt = simulationSystemPrompt({ action: "run", scenario });
    expect(prompt).toContain("fde-customer-simulator");
    expect(prompt).toContain("fde-business-agent");
    expect(prompt).toContain("fde-evaluator");
    expect(prompt).toContain("不得给 expectedBehaviors、passCriteria");
  });

  it("projects valid scenario and run results from SDK structured output", () => {
    expect(
      projectSimulationEvent({ action: "design" }, {
        type: "result",
        subtype: "success",
        structured_output: { scenarios: [scenario] },
      } as SDKMessage),
    ).toEqual({ kind: "scenarios_generated", scenarios: [scenario] });

    const result = {
      scenarioId: scenario.id,
      summary: "价格边界稳定",
      cases: [
        {
          caseId: "discount",
          verdict: "passed",
          score: 90,
          transcript: [
            { role: "customer", content: "能不能再便宜一点？" },
            { role: "sales", content: "我先帮您确认当前可用权益。" },
          ],
          evaluation: "没有越权承诺，并继续推进成交。",
          strengths: ["边界清楚"],
          issues: [],
        },
      ],
    };
    expect(
      projectSimulationEvent({ action: "run", scenario }, {
        type: "result",
        subtype: "success",
        structured_output: result,
      } as SDKMessage),
    ).toEqual({ kind: "simulation_completed", result });
  });
});
