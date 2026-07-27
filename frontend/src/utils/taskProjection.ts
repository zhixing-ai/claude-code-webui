import type { SDKMessage, TimestampedSDKMessage } from "../types";

export type ClaudeTaskStatus = "pending" | "in_progress" | "completed";

export interface ClaudeTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: ClaudeTaskStatus;
  owner?: string;
  blockedBy: string[];
  blocks: string[];
}

type TaskToolName = "TaskCreate" | "TaskUpdate" | "TaskGet" | "TaskList";

interface PendingTaskTool {
  name: TaskToolName;
  input: Record<string, unknown>;
}

export interface TaskProjection {
  byId: Record<string, ClaudeTask>;
  order: string[];
  pendingToolUses: Record<string, PendingTaskTool>;
}

type TaskMessage = SDKMessage | TimestampedSDKMessage;

const TASK_TOOL_NAMES = new Set<TaskToolName>([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
]);

export function isClaudeTaskTool(name: string): name is TaskToolName {
  return TASK_TOOL_NAMES.has(name as TaskToolName);
}

export function createEmptyTaskProjection(): TaskProjection {
  return { byId: {}, order: [], pendingToolUses: {} };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function readStrings(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value)) {
      return value
        .filter(
          (item): item is string | number =>
            typeof item === "string" || typeof item === "number",
        )
        .map(String);
    }
  }
  return undefined;
}

function readStatus(
  record: Record<string, unknown> | undefined,
): ClaudeTaskStatus | "deleted" | undefined {
  const value = readString(record, "status");
  return value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "deleted"
    ? value
    : undefined;
}

function mergeUnique(current: string[], additions?: string[]): string[] {
  return additions ? [...new Set([...current, ...additions])] : current;
}

function taskFromRecord(
  record: Record<string, unknown>,
  existing?: ClaudeTask,
): ClaudeTask | undefined {
  const id = readString(record, "id", "taskId", "task_id") ?? existing?.id;
  if (!id) return undefined;
  const status = readStatus(record);

  return {
    id,
    subject:
      readString(record, "subject") ?? existing?.subject ?? `Task #${id}`,
    description: readString(record, "description") ?? existing?.description,
    activeForm:
      readString(record, "activeForm", "active_form") ?? existing?.activeForm,
    status:
      status && status !== "deleted" ? status : (existing?.status ?? "pending"),
    owner: readString(record, "owner") ?? existing?.owner,
    blockedBy:
      readStrings(record, "blockedBy", "blocked_by") ??
      existing?.blockedBy ??
      [],
    blocks: readStrings(record, "blocks") ?? existing?.blocks ?? [],
  };
}

function removePendingToolUse(
  state: TaskProjection,
  toolUseId: string,
): TaskProjection {
  const pendingToolUses = { ...state.pendingToolUses };
  delete pendingToolUses[toolUseId];
  return { ...state, pendingToolUses };
}

function addOrReplaceTask(
  state: TaskProjection,
  task: ClaudeTask,
): TaskProjection {
  return {
    ...state,
    byId: { ...state.byId, [task.id]: task },
    order: state.order.includes(task.id)
      ? state.order
      : [...state.order, task.id],
  };
}

function applyTaskToolResult(
  state: TaskProjection,
  toolUseId: string,
  contentItem: Record<string, unknown>,
  toolUseResult: unknown,
): TaskProjection {
  const pending = state.pendingToolUses[toolUseId];
  if (!pending) return state;

  let next = removePendingToolUse(state, toolUseId);
  const result = asRecord(toolUseResult);
  if (
    contentItem.is_error === true ||
    result?.success === false ||
    typeof result?.error === "string"
  ) {
    return next;
  }

  if (pending.name === "TaskCreate") {
    const created = asRecord(result?.task);
    const id = readString(created, "id");
    if (!created || !id) return next;

    const task = taskFromRecord(
      { ...pending.input, ...created, id, status: "pending" },
      next.byId[id],
    );
    return task ? addOrReplaceTask(next, task) : next;
  }

  if (pending.name === "TaskUpdate") {
    const id =
      readString(result, "taskId", "task_id") ??
      readString(pending.input, "taskId", "task_id", "id");
    if (!id) return next;

    if (readStatus(pending.input) === "deleted") {
      const byId = { ...next.byId };
      delete byId[id];
      return {
        ...next,
        byId,
        order: next.order.filter((taskId) => taskId !== id),
      };
    }

    const current = next.byId[id];
    const task = taskFromRecord({ ...pending.input, id }, current);
    if (!task) return next;

    task.blockedBy = mergeUnique(
      task.blockedBy,
      readStrings(pending.input, "addBlockedBy", "add_blocked_by"),
    );
    task.blocks = mergeUnique(
      task.blocks,
      readStrings(pending.input, "addBlocks", "add_blocks"),
    );
    return addOrReplaceTask(next, task);
  }

  if (pending.name === "TaskGet") {
    const taskRecord = asRecord(result?.task);
    if (!taskRecord) return next;
    const id = readString(taskRecord, "id", "taskId", "task_id");
    const task = taskFromRecord(taskRecord, id ? next.byId[id] : undefined);
    return task ? addOrReplaceTask(next, task) : next;
  }

  const tasks = result?.tasks;
  if (pending.name === "TaskList" && Array.isArray(tasks)) {
    const byId: Record<string, ClaudeTask> = {};
    const order: string[] = [];

    for (const value of tasks) {
      const taskRecord = asRecord(value);
      const id = readString(taskRecord, "id", "taskId", "task_id");
      if (!taskRecord || !id || readStatus(taskRecord) === "deleted") continue;
      const task = taskFromRecord(taskRecord, next.byId[id]);
      if (task) {
        byId[id] = task;
        order.push(id);
      }
    }

    next = { ...next, byId, order };
  }

  return next;
}

export function reduceTaskMessage(
  state: TaskProjection,
  message: TaskMessage,
): TaskProjection {
  if (message.type === "assistant" && Array.isArray(message.message?.content)) {
    let pendingToolUses = state.pendingToolUses;

    for (const item of message.message.content) {
      if (
        item.type !== "tool_use" ||
        !item.id ||
        !item.name ||
        !isClaudeTaskTool(item.name)
      ) {
        continue;
      }

      if (pendingToolUses === state.pendingToolUses) {
        pendingToolUses = { ...pendingToolUses };
      }
      pendingToolUses[item.id] = {
        name: item.name,
        input: item.input ?? {},
      };
    }

    return pendingToolUses === state.pendingToolUses
      ? state
      : { ...state, pendingToolUses };
  }

  if (message.type === "user" && Array.isArray(message.message?.content)) {
    let next = state;
    const structuredResult =
      message.tool_use_result ??
      (message as TaskMessage & { toolUseResult?: unknown }).toolUseResult;

    for (const item of message.message.content) {
      if (item.type !== "tool_result" || !item.tool_use_id) continue;
      next = applyTaskToolResult(
        next,
        item.tool_use_id,
        item as unknown as Record<string, unknown>,
        structuredResult ?? item.content,
      );
    }
    return next;
  }

  return state;
}

export function replayTaskMessages(messages: TaskMessage[]): TaskProjection {
  return messages.reduce(reduceTaskMessage, createEmptyTaskProjection());
}

export function selectTasks(state: TaskProjection): ClaudeTask[] {
  return state.order.flatMap((id) => (state.byId[id] ? [state.byId[id]] : []));
}
