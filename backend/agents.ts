import type {
  AgentDefinition,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentLifecycleEvent } from "../shared/types.ts";

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"];

export const PLATFORM_AGENTS: Record<string, AgentDefinition> = {
  "fde-scenario-designer": {
    description:
      "Designs isolated merchant test scenarios from authorized source material. Use when FDE needs hidden exam cases.",
    prompt:
      "你是独立场景设计员。只根据任务提供的授权原始材料设计测试场景，不读取或评价生成后的业务 Skill，不泄露隐藏目标和评分答案。输出明确的人设、开场、目标、停止条件和可判定的行为要求。",
    tools: READ_ONLY_TOOLS,
    model: "inherit",
    maxTurns: 8,
    background: false,
    permissionMode: "default",
  },
  "fde-l1-examiner": {
    description:
      "Instantiates L1 cases and reviews applicability without seeing the L1 answer key or builder intent.",
    prompt:
      "你是独立 L1 组卷员。只按任务提供的配置卡、商家确认表、L1 题面和填值规则实例化题面，并复核适用型、不适用理由、类型判定和 L2 行为分寸题的两头性。不得读取 L1 判卷卷、装配设计意图或装配决策中未授权的区域。",
    tools: READ_ONLY_TOOLS,
    model: "inherit",
    maxTurns: 8,
    background: false,
    permissionMode: "default",
  },
  "fde-customer-simulator": {
    description:
      "Plays one end-user persona in a bounded test conversation without seeing the rubric.",
    prompt:
      "你只扮演任务指定的终端用户。严格遵守人设、已知信息和停止条件；不要充当考官，不解释隐藏目标，不替业务 Agent 作答。每轮只输出用户会自然说出的内容。",
    tools: [],
    model: "inherit",
    maxTurns: 12,
    background: false,
    permissionMode: "dontAsk",
  },
  "fde-business-agent": {
    description:
      "Runs the generated merchant business Skill against a simulated customer case.",
    prompt:
      "你是待测业务 Agent。只使用任务明确提供的商家 Skill、业务资料和允许工具服务终端用户；不得猜测或索取考题、隐藏目标和评分规则。遇到资料不足时按业务规则澄清或升级。",
    tools: READ_ONLY_TOOLS,
    model: "inherit",
    maxTurns: 12,
    background: false,
    permissionMode: "default",
  },
  "fde-evaluator": {
    description:
      "Independently scores a completed customer and business-agent transcript with evidence.",
    prompt:
      "你是独立考官。只依据给定场景、评分规则、对话和工具账本判卷。不得补写对话或替待测 Agent 辩护。每项结论必须引用具体回合证据，并区分硬违规、能力缺口和资料缺口。",
    tools: [],
    model: "inherit",
    maxTurns: 8,
    background: false,
    permissionMode: "dontAsk",
  },
  "fde-document-auditor": {
    description:
      "Audits generated merchant artifacts for contract and cross-file consistency without seeing exam cases.",
    prompt:
      "你是独立文档审计员。检查生成产物是否满足文件合同、引用是否存在、跨文件是否一致。不要读取或推断隐藏考题，也不要进行行为评分。只报告有证据的问题。",
    tools: READ_ONLY_TOOLS,
    model: "inherit",
    maxTurns: 8,
    background: false,
    permissionMode: "default",
  },
};

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
      typeof agentType === "string" && agentType in PLATFORM_AGENTS
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
