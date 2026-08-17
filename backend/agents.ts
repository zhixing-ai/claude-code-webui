import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentLifecycleEvent } from "../shared/types.ts";

export const FDE_PLUGIN_NAME = "fde-suite";
export const FDE_MAIN_AGENT = `${FDE_PLUGIN_NAME}:fde-builder`;

const FDE_SUBAGENTS = new Set([
  "fde-scenario-designer",
  "fde-l1-examiner",
  "fde-customer-simulator",
  "fde-business-agent",
  "fde-evaluator",
  "fde-document-auditor",
]);

export function shortAgentName(agentType: string): string {
  return agentType.split(":").at(-1) ?? agentType;
}

function isFdeSubagent(agentType: string): boolean {
  return FDE_SUBAGENTS.has(shortAgentName(agentType));
}

/** Exam-runtime roles; only the simulation channel may dispatch these (console spec S2). */
const EXAM_ONLY_SUBAGENTS = new Set([
  "fde-customer-simulator",
  "fde-business-agent",
  "fde-evaluator",
]);

export function isExamOnlyAgent(agentType: string): boolean {
  return EXAM_ONLY_SUBAGENTS.has(shortAgentName(agentType));
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function readString(
  record: UnknownRecord | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function readUsage(record: UnknownRecord | undefined) {
  if (!record) return undefined;
  return {
    totalTokens:
      typeof record.total_tokens === "number" ? record.total_tokens : undefined,
    toolUses:
      typeof record.tool_uses === "number" ? record.tool_uses : undefined,
    durationMs:
      typeof record.duration_ms === "number" ? record.duration_ms : undefined,
  };
}

function taskStatus(value: unknown): AgentLifecycleEvent["status"] | undefined {
  switch (value) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "paused":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    default:
      return undefined;
  }
}

function toolAgentEvents(message: UnknownRecord): AgentLifecycleEvent[] {
  if (message.type !== "assistant") return [];
  const body = asRecord(message.message);
  const content = body?.content;
  if (!Array.isArray(content)) return [];

  const parentToolUseId = readString(message, "parent_tool_use_id");
  if (parentToolUseId) {
    const text = content
      .flatMap((item) => {
        const block = asRecord(item);
        return block?.type === "text" && typeof block.text === "string"
          ? [block.text]
          : [];
      })
      .join("\n")
      .trim();
    const lastTool = content.reduce<string | undefined>((current, item) => {
      const block = asRecord(item);
      return block?.type === "tool_use"
        ? (readString(block, "name") ?? current)
        : current;
    }, undefined);
    if (!text && !lastTool) return [];
    return [
      {
        agentRunId: `tool:${parentToolUseId}`,
        agentType: "subagent",
        status: "running",
        toolUseId: parentToolUseId,
        ...(text ? { summary: text.slice(0, 800) } : {}),
        ...(lastTool ? { lastTool } : {}),
      },
    ];
  }

  return content.flatMap((item) => {
    const block = asRecord(item);
    if (
      block?.type !== "tool_use" ||
      (block.name !== "Agent" && block.name !== "Task")
    ) {
      return [];
    }
    const id = readString(block, "id");
    const input = asRecord(block.input);
    if (!id) return [];
    return [
      {
        agentRunId: `tool:${id}`,
        agentType:
          readString(input, "subagent_type", "agent_type") ?? "subagent",
        status: "queued" as const,
        toolUseId: id,
        description:
          readString(input, "description") ?? "Preparing delegated work",
      },
    ];
  });
}

/** Converts SDK-specific messages into the stable, prompt-safe UI contract. */
export function projectAgentEvents(message: SDKMessage): AgentLifecycleEvent[] {
  const record = asRecord(message);
  if (!record) return [];

  const fromTools = toolAgentEvents(record);
  if (fromTools.length) return fromTools;

  if (record.type === "tool_progress") {
    const taskId = readString(record, "task_id");
    const parentToolUseId = readString(record, "parent_tool_use_id");
    const toolUseId = parentToolUseId ?? readString(record, "tool_use_id");
    return [
      {
        agentRunId: taskId
          ? `task:${taskId}`
          : `tool:${toolUseId ?? "unknown"}`,
        agentType: readString(record, "subagent_type") ?? "subagent",
        status: "running",
        ...(taskId ? { taskId } : {}),
        ...(toolUseId ? { toolUseId } : {}),
        lastTool: readString(record, "tool_name"),
        usage: {
          durationMs:
            typeof record.elapsed_time_seconds === "number"
              ? record.elapsed_time_seconds * 1000
              : undefined,
        },
      },
    ];
  }

  if (record.type !== "system") return [];

  if (record.subtype === "init" && Array.isArray(record.agents)) {
    return record.agents.flatMap((agentType) =>
      typeof agentType === "string" && isFdeSubagent(agentType)
        ? [
            {
              agentRunId: `definition:${agentType}`,
              agentType,
              status: "registered" as const,
            },
          ]
        : [],
    );
  }

  const taskId = readString(record, "task_id");
  if (!taskId) return [];
  const toolUseId = readString(record, "tool_use_id");
  const agentType = readString(record, "subagent_type") ?? "subagent";

  if (record.subtype === "task_started") {
    return [
      {
        agentRunId: `task:${taskId}`,
        agentType,
        status: "running",
        taskId,
        ...(toolUseId ? { toolUseId } : {}),
        description: readString(record, "description"),
      },
    ];
  }

  if (record.subtype === "task_progress") {
    return [
      {
        agentRunId: `task:${taskId}`,
        agentType,
        status: "running",
        taskId,
        ...(toolUseId ? { toolUseId } : {}),
        description: readString(record, "description"),
        summary: readString(record, "summary"),
        lastTool: readString(record, "last_tool_name"),
        usage: readUsage(asRecord(record.usage)),
      },
    ];
  }

  if (record.subtype === "task_notification") {
    return [
      {
        agentRunId: `task:${taskId}`,
        agentType,
        status: taskStatus(record.status) ?? "completed",
        taskId,
        ...(toolUseId ? { toolUseId } : {}),
        summary: readString(record, "summary"),
        usage: readUsage(asRecord(record.usage)),
      },
    ];
  }

  if (record.subtype === "task_updated") {
    const patch = asRecord(record.patch);
    const status = taskStatus(patch?.status);
    if (!status) return [];
    return [
      {
        agentRunId: `task:${taskId}`,
        agentType,
        status,
        taskId,
        description: readString(patch, "description"),
        summary: readString(patch, "error"),
      },
    ];
  }

  return [];
}
