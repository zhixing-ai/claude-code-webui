import type { AgentLifecycleEvent, AgentRunStatus } from "../types";

export interface AgentRun {
  id: string;
  agentType: string;
  status: AgentRunStatus;
  taskId?: string;
  toolUseId?: string;
  description?: string;
  summary?: string;
  lastTool?: string;
  usage?: AgentLifecycleEvent["usage"];
  outputProtected?: boolean;
}

export interface AgentProjection {
  definitions: string[];
  byId: Record<string, AgentRun>;
  order: string[];
  taskToRun: Record<string, string>;
  toolUseToRun: Record<string, string>;
}

export function createEmptyAgentProjection(): AgentProjection {
  return {
    definitions: [],
    byId: {},
    order: [],
    taskToRun: {},
    toolUseToRun: {},
  };
}

const TERMINAL = new Set<AgentRunStatus>(["completed", "failed", "stopped"]);
const VISIBLE_OUTPUT_AGENTS = new Set([
  "fde-business-agent",
  "fde-evaluator",
  "fde-document-auditor",
]);

function shortAgentName(agentType: string): string {
  const names = agentType.split(":");
  return names[names.length - 1] ?? agentType;
}

export function reduceAgentEvent(
  state: AgentProjection,
  event: AgentLifecycleEvent,
): AgentProjection {
  if (event.status === "registered") {
    return state.definitions.includes(event.agentType)
      ? state
      : { ...state, definitions: [...state.definitions, event.agentType] };
  }

  const existingId =
    (event.taskId && state.taskToRun[event.taskId]) ||
    (event.toolUseId && state.toolUseToRun[event.toolUseId]) ||
    (state.byId[event.agentRunId] ? event.agentRunId : undefined);
  const id = existingId || event.agentRunId;
  const existing = state.byId[id];
  const status =
    existing && TERMINAL.has(existing.status) && !TERMINAL.has(event.status)
      ? existing.status
      : event.status;
  const agentType =
    event.agentType === "subagent" && existing?.agentType
      ? existing.agentType
      : event.agentType;
  const canShowOutput = VISIBLE_OUTPUT_AGENTS.has(shortAgentName(agentType));
  const run: AgentRun = {
    ...(existing ?? { id }),
    agentType,
    status,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
    ...(event.description ? { description: event.description } : {}),
    ...(event.summary && canShowOutput ? { summary: event.summary } : {}),
    ...(event.summary && !canShowOutput ? { outputProtected: true } : {}),
    ...(event.lastTool ? { lastTool: event.lastTool } : {}),
    ...(event.usage ? { usage: { ...existing?.usage, ...event.usage } } : {}),
  };

  return {
    ...state,
    byId: { ...state.byId, [id]: run },
    order: state.order.includes(id) ? state.order : [...state.order, id],
    taskToRun: event.taskId
      ? { ...state.taskToRun, [event.taskId]: id }
      : state.taskToRun,
    toolUseToRun: event.toolUseId
      ? { ...state.toolUseToRun, [event.toolUseId]: id }
      : state.toolUseToRun,
  };
}

export function stopActiveAgents(
  state: AgentProjection,
  status: "failed" | "stopped",
): AgentProjection {
  let changed = false;
  const byId = Object.fromEntries(
    Object.entries(state.byId).map(([id, run]) => {
      if (TERMINAL.has(run.status)) return [id, run];
      changed = true;
      return [id, { ...run, status }];
    }),
  );
  return changed ? { ...state, byId } : state;
}

export function selectAgentRuns(state: AgentProjection): AgentRun[] {
  const runs = state.order.flatMap((id) =>
    state.byId[id] ? [state.byId[id]] : [],
  );
  const instantiated = new Set(runs.map((run) => run.agentType));
  const idle = state.definitions
    .filter((agentType) => !instantiated.has(agentType))
    .map<AgentRun>((agentType) => ({
      id: `definition:${agentType}`,
      agentType,
      status: "registered",
    }));
  return [...runs, ...idle];
}
