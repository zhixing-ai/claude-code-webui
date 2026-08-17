import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  inferSimulationCommand,
  projectSimulationEvent,
  projectSimulationEvents,
  readSimulationLifecycleEvent,
  readSimulationCommand,
  simulationOutputFormat,
  simulationSystemPrompt,
  SimulationLifecycleTracker,
  validateSimulationLifecycleEvent,
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
  it("recognizes simulation commands without treating questions as commands", () => {
    expect(
      inferSimulationCommand(
        "接下来我们直接生成模拟测试的场景，case并开始测试吧。",
      ),
    ).toEqual({
      action: "orchestrate",
      startsWith: "design",
      runAfterDesign: true,
    });
    expect(inferSimulationCommand("重新设计场景并重考")).toEqual({
      action: "orchestrate",
      startsWith: "design",
      runAfterDesign: true,
    });
    expect(inferSimulationCommand("重新测试这些场景")).toEqual({
      action: "orchestrate",
      startsWith: "run",
      runAfterDesign: true,
    });
    expect(inferSimulationCommand("只生成模拟测试场景，不开始测试")).toEqual({
      action: "orchestrate",
      startsWith: "design",
      runAfterDesign: false,
    });
    expect(inferSimulationCommand("为什么模拟测试没有显示？")).toBeUndefined();
    expect(inferSimulationCommand("我不想生成测试场景")).toBeUndefined();
    expect(
      inferSimulationCommand("你确认一下，为什么重新测试没有刷新？"),
    ).toBeUndefined();
  });

  it("validates commands and installs the matching structured output schema", () => {
    expect(readSimulationCommand({ action: "design" })).toEqual({
      action: "design",
    });
    expect(readSimulationCommand({ action: "run", scenario })).toEqual({
      action: "run",
      scenario,
    });
    expect(
      readSimulationCommand({ action: "run_all", scenarios: [scenario] }),
    ).toEqual({
      action: "run_all",
      scenarios: [scenario],
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
    expect(prompt).toContain("fde-suite:fde-customer-simulator");
    expect(prompt).toContain("fde-suite:fde-business-agent");
    expect(prompt).toContain("fde-suite:fde-evaluator");
    expect(prompt).toContain("不得给 expectedBehaviors、passCriteria");
    expect(
      simulationSystemPrompt({ action: "run_all", scenarios: [scenario] }),
    ).toContain("同一条 assistant 消息中同时发出");
  });

  it("requires orchestrated simulation requests to report UI state", () => {
    const prompt = simulationSystemPrompt({
      action: "orchestrate",
      startsWith: "design",
      runAfterDesign: true,
    });
    expect(prompt).toContain("mcp__webui__publish_simulation_state");
    expect(prompt).toContain("禁止完成一个场景后再开始下一个场景");
    expect(prompt).toContain("scenarios_generated");
    expect(prompt).toContain("simulation_completed");
    expect(prompt).toContain("禁止调用 Skill、Bash");
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
    expect(
      projectSimulationEvents({ action: "run_all", scenarios: [scenario] }, {
        type: "result",
        subtype: "success",
        structured_output: { results: [result] },
      } as SDKMessage),
    ).toEqual([
      { kind: "run_started", scenarioIds: [scenario.id] },
      { kind: "simulation_batch_completed", results: [result] },
    ]);

    expect(
      projectSimulationEvents(
        {
          action: "orchestrate",
          startsWith: "design",
          runAfterDesign: true,
        },
        {
          type: "result",
          subtype: "success",
          structured_output: { scenarios: [scenario], results: [result] },
        } as SDKMessage,
      ),
    ).toEqual([
      { kind: "scenarios_generated", scenarios: [scenario] },
      { kind: "run_started", scenarioIds: [scenario.id] },
      { kind: "simulation_batch_completed", results: [result] },
    ]);
  });

  it("validates live reports before they reach the UI", () => {
    expect(
      readSimulationLifecycleEvent({
        kind: "scenarios_generated",
        scenarios: [scenario],
      }),
    ).toEqual({ kind: "scenarios_generated", scenarios: [scenario] });
    expect(
      readSimulationLifecycleEvent({
        kind: "run_started",
        scenarioIds: [scenario.id, scenario.id],
      }),
    ).toBeUndefined();
  });

  it("accepts transcripts of any length", () => {
    const turns = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "customer" : "sales",
      content: `第 ${index + 1} 句`,
    }));
    const result = {
      scenarioId: scenario.id,
      summary: "完成长对话测试",
      cases: [
        {
          caseId: "discount",
          verdict: "passed",
          score: 90,
          transcript: turns,
          evaluation: "边界清楚",
          strengths: [],
          issues: [],
        },
      ],
    };

    expect(
      readSimulationLifecycleEvent({
        kind: "simulation_completed",
        result,
      }),
    ).toEqual({ kind: "simulation_completed", result });
    expect(
      simulationOutputFormat({ action: "run", scenario }),
    ).not.toMatchObject({
      schema: {
        properties: {
          cases: {
            items: {
              properties: { transcript: { maxItems: expect.anything() } },
            },
          },
        },
      },
    });
  });

  it("returns the exact schema path for an invalid live report", () => {
    expect(
      validateSimulationLifecycleEvent({
        kind: "simulation_completed",
        result: {
          scenarioId: scenario.id,
          summary: "完成",
          cases: [
            {
              caseId: "discount",
              verdict: "passed",
              score: 90,
              transcript: [
                { role: "customer", content: "能优惠吗？" },
                { role: "assistant", content: "我先确认权益。" },
              ],
              evaluation: "边界清楚",
              strengths: [],
              issues: [],
            },
          ],
        },
      }),
    ).toEqual({
      ok: false,
      error: "result.cases.0.transcript.1.role: expected customer or sales",
    });
  });

  it("fails closed when a simulation lifecycle stops after its start event", () => {
    const tracker = new SimulationLifecycleTracker({
      action: "orchestrate",
      startsWith: "design",
      runAfterDesign: true,
    });
    tracker.accept({ kind: "design_started", runAfterDesign: true });
    expect(tracker.incompleteReason()).toBe("Agent 未上报生成的模拟测试场景");
  });
});
