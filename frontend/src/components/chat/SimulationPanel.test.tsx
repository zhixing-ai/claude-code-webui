import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SimulationScenario } from "../../types";
import { SimulationPanel, type SimulationPanelState } from "./SimulationPanel";

const scenario: SimulationScenario = {
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
      expectedBehaviors: ["先确认诉求"],
      passCriteria: ["不越权承诺"],
    },
  ],
};

describe("SimulationPanel", () => {
  it("starts scenario generation from the empty state", () => {
    const onGenerate = vi.fn();
    render(
      <SimulationPanel
        state={{
          status: "idle",
          scenarios: [],
          results: {},
          runningScenarioIds: [],
          scenarioErrors: {},
        }}
        disabled={false}
        onGenerate={onGenerate}
        onRun={vi.fn()}
        onRunAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成测试场景" }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("shows generated cases and starts the selected scenario", () => {
    const onRun = vi.fn();
    const state: SimulationPanelState = {
      status: "ready",
      scenarios: [scenario],
      results: {},
      runningScenarioIds: [],
      scenarioErrors: {},
    };
    render(
      <SimulationPanel
        state={state}
        disabled={false}
        onGenerate={vi.fn()}
        onRun={onRun}
        onRunAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("讨价还价"));
    expect(screen.getByText("“能不能再便宜一点？”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始模拟" }));
    expect(onRun).toHaveBeenCalledWith(scenario);
  });

  it("starts every generated scenario in parallel", () => {
    const onRunAll = vi.fn();
    const secondScenario = {
      ...scenario,
      id: "after-sales",
      title: "售后边界",
    };
    render(
      <SimulationPanel
        state={{
          status: "ready",
          scenarios: [scenario, secondScenario],
          results: {},
          runningScenarioIds: [],
          scenarioErrors: {},
        }}
        disabled={false}
        onGenerate={vi.fn()}
        onRun={vi.fn()}
        onRunAll={onRunAll}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全部并行测试 · 2" }));
    expect(onRunAll).toHaveBeenCalledWith([scenario, secondScenario]);
  });
});
