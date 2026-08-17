import type {
  SDKMessage,
  SimulationLifecycleEvent,
  SimulationRunResult,
  SimulationScenario,
  TimestampedSDKMessage,
} from "../types";

export const SIMULATION_REPORT_TOOL_NAME =
  "mcp__webui__publish_simulation_state";

export interface SimulationPanelState {
  status: "idle" | "designing" | "ready" | "running" | "error";
  scenarios: SimulationScenario[];
  results: Record<string, SimulationRunResult>;
  runningScenarioIds: string[];
  scenarioErrors: Record<string, string>;
  error?: string;
}

export function createEmptySimulationState(): SimulationPanelState {
  return {
    status: "idle",
    scenarios: [],
    results: {},
    runningScenarioIds: [],
    scenarioErrors: {},
  };
}

export function reduceSimulationEvent(
  state: SimulationPanelState,
  event: SimulationLifecycleEvent,
): SimulationPanelState {
  if (event.kind === "simulation_failed") {
    if (typeof event.error !== "string" || !event.error.trim()) {
      return invalidSimulationEvent(state);
    }
    return {
      ...state,
      status: "error",
      runningScenarioIds: [],
      error: event.error,
    };
  }
  if (event.kind === "design_started") {
    return { ...createEmptySimulationState(), status: "designing" };
  }
  if (event.kind === "scenarios_generated") {
    if (
      !Array.isArray(event.scenarios) ||
      !event.scenarios.every(isSimulationScenario)
    ) {
      return invalidSimulationEvent(state);
    }
    return {
      ...createEmptySimulationState(),
      status: "ready",
      scenarios: event.scenarios,
    };
  }
  if (event.kind === "run_started") {
    if (
      !Array.isArray(event.scenarioIds) ||
      !event.scenarioIds.every((id) => typeof id === "string")
    ) {
      return invalidSimulationEvent(state);
    }
    const started = new Set(event.scenarioIds);
    return {
      ...state,
      status: "running",
      runningScenarioIds: event.scenarioIds,
      results: Object.fromEntries(
        Object.entries(state.results).filter(([id]) => !started.has(id)),
      ),
      scenarioErrors: Object.fromEntries(
        Object.entries(state.scenarioErrors).filter(([id]) => !started.has(id)),
      ),
      error: undefined,
    };
  }

  const completedResults =
    event.kind === "simulation_batch_completed" &&
    Array.isArray(event.results) &&
    event.results.every(isSimulationRunResult)
      ? event.results
      : event.kind === "simulation_completed" &&
          isSimulationRunResult(event.result)
        ? [event.result]
        : undefined;
  if (!completedResults) return invalidSimulationEvent(state);
  const completedIds = new Set(
    completedResults.map((result) => result.scenarioId),
  );
  const runningScenarioIds = state.runningScenarioIds.filter(
    (id) => !completedIds.has(id),
  );
  const scenarioErrors = { ...state.scenarioErrors };
  for (const id of completedIds) delete scenarioErrors[id];
  return {
    ...state,
    status: runningScenarioIds.length > 0 ? "running" : "ready",
    runningScenarioIds,
    scenarioErrors,
    error: undefined,
    results: {
      ...state.results,
      ...Object.fromEntries(
        completedResults.map((result) => [result.scenarioId, result]),
      ),
    },
  };
}

type HistoryMessage = SDKMessage | TimestampedSDKMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSimulationScenario(value: unknown): value is SimulationScenario {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.cases)
  );
}

function isSimulationRunResult(value: unknown): value is SimulationRunResult {
  return (
    isRecord(value) &&
    typeof value.scenarioId === "string" &&
    Array.isArray(value.cases)
  );
}

function invalidSimulationEvent(
  state: SimulationPanelState,
): SimulationPanelState {
  return {
    ...state,
    status: "error",
    runningScenarioIds: [],
    error: "收到无效的模拟测试状态，已停止渲染，请重新执行。",
  };
}

function readReportedEvent(
  value: unknown,
): SimulationLifecycleEvent | undefined {
  if (!isRecord(value)) return;
  const record = value;
  if (record.kind === "design_started") {
    return {
      kind: "design_started",
      ...(typeof record.runAfterDesign === "boolean"
        ? { runAfterDesign: record.runAfterDesign }
        : {}),
    };
  }
  if (
    record.kind === "scenarios_generated" &&
    Array.isArray(record.scenarios) &&
    record.scenarios.every(isSimulationScenario)
  ) {
    return {
      kind: "scenarios_generated",
      scenarios: record.scenarios as SimulationScenario[],
    };
  }
  if (
    record.kind === "run_started" &&
    Array.isArray(record.scenarioIds) &&
    record.scenarioIds.every((id) => typeof id === "string")
  ) {
    return { kind: "run_started", scenarioIds: record.scenarioIds };
  }
  if (
    record.kind === "simulation_completed" &&
    isSimulationRunResult(record.result)
  ) {
    return {
      kind: "simulation_completed",
      result: record.result,
    };
  }
  if (
    record.kind === "simulation_batch_completed" &&
    Array.isArray(record.results) &&
    record.results.every(isSimulationRunResult)
  ) {
    return {
      kind: "simulation_batch_completed",
      results: record.results,
    };
  }
  if (record.kind === "simulation_failed" && typeof record.error === "string") {
    return { kind: "simulation_failed", error: record.error };
  }
}

function readStructuredOutputEvents(
  value: unknown,
): SimulationLifecycleEvent[] {
  if (!isRecord(value)) return [];
  const output = value;
  const events: SimulationLifecycleEvent[] = [];
  if (
    Array.isArray(output.scenarios) &&
    output.scenarios.every(isSimulationScenario)
  ) {
    events.push({
      kind: "scenarios_generated",
      scenarios: output.scenarios,
    });
  }
  if (
    Array.isArray(output.results) &&
    output.results.every(isSimulationRunResult)
  ) {
    const results = output.results;
    events.push({
      kind: "run_started",
      scenarioIds: results.map((result) => result.scenarioId),
    });
    events.push({ kind: "simulation_batch_completed", results });
  } else if (isSimulationRunResult(output)) {
    const result = output;
    events.push({ kind: "run_started", scenarioIds: [result.scenarioId] });
    events.push({ kind: "simulation_completed", result });
  }
  return events;
}

export function replaySimulationMessages(
  messages: HistoryMessage[],
): SimulationPanelState {
  let state = createEmptySimulationState();
  const pending = new Map<string, SimulationLifecycleEvent[]>();

  for (const message of messages) {
    if (
      message.type === "assistant" &&
      Array.isArray(message.message?.content)
    ) {
      for (const item of message.message.content) {
        if (item.type === "tool_use" && item.id) {
          if (item.name === SIMULATION_REPORT_TOOL_NAME) {
            const event = readReportedEvent(item.input);
            if (event) pending.set(item.id, [event]);
          } else if (item.name === "StructuredOutput") {
            const events = readStructuredOutputEvents(item.input);
            if (events.length) pending.set(item.id, events);
          }
        }
      }
      continue;
    }
    if (message.type !== "user" || !Array.isArray(message.message?.content)) {
      continue;
    }
    for (const item of message.message.content) {
      if (item.type !== "tool_result" || !item.tool_use_id) continue;
      const events = pending.get(item.tool_use_id);
      pending.delete(item.tool_use_id);
      if (events && item.is_error !== true) {
        for (const event of events) {
          state = reduceSimulationEvent(state, event);
        }
      }
    }
  }

  return state.status === "designing" || state.status === "running"
    ? {
        ...state,
        status: "error",
        runningScenarioIds: [],
        error: "上一次模拟测试未返回完整结构化结果，请重新执行。",
      }
    : state;
}
