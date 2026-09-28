import { open } from "node:fs/promises";
import type { HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const ROLES: Record<string, string> = {
  "fde-suite:fde-business-agent": "销售角色",
  "fde-suite:fde-evaluator": "评估角色",
};
function failure(agentType: string): string {
  return `模拟未完成：${ROLES[agentType]}已结束，但没有最终回答（可能耗尽工具轮数）。本次不应判分。`;
}

/** Inspect the final assistant turn, not an earlier 'I will read...' preamble. */
export async function hasFinalBusinessAnswer(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const start = Math.max(0, size - 1024 * 1024);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start) lines.shift();
    let id: string | undefined;
    let text = false;
    let tool = false;
    let end = false;
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.type !== "assistant") continue;
      const message = entry.message;
      if (!message?.id) return false;
      id ??= message.id;
      if (message.id !== id) break;
      tool ||= message.stop_reason === "tool_use";
      end ||= message.stop_reason === "end_turn";
      for (const block of message.content ?? []) {
        tool ||= block.type === "tool_use";
        text ||= block.type === "text" && Boolean(block.text?.trim());
      }
    }
    return text && end && !tool;
  } finally {
    await file.close();
  }
}

export class BusinessAgentCompletionGuard {
  error?: string;
  private readonly launches = new Map<
    string,
    { agentType: string; name?: string }
  >();
  private readonly agents = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly stoppedAnswers = new Map<string, boolean>();
  register(input: HookInput): void {
    if (input.hook_event_name !== "PreToolUse") return;
    const args = input.tool_input as {
      subagent_type?: string;
      name?: string;
      to?: string;
    };
    if (
      ["Agent", "Task"].includes(input.tool_name) &&
      args?.subagent_type &&
      Object.hasOwn(ROLES, args.subagent_type)
    ) {
      this.launches.set(input.tool_use_id, {
        agentType: args.subagent_type,
        name: args.name,
      });
    } else if (
      input.tool_name === "SendMessage" &&
      typeof args?.to === "string"
    ) {
      const id = this.names.get(args.to) ?? args.to;
      const agentType = this.agents.get(id);
      if (agentType) {
        // A completed first round is not evidence for the resumed round.
        this.stoppedAnswers.delete(id);
        this.launches.set(input.tool_use_id, { agentType });
      }
    }
  }

  async stopped(input: HookInput): Promise<void> {
    if (
      input.hook_event_name !== "SubagentStop" ||
      !Object.hasOwn(ROLES, input.agent_type)
    )
      return;
    this.agents.set(input.agent_id, input.agent_type);
    // The SDK may emit stop/notification before flushing final text to JSONL.
    // Use its native final-message field; reserve transcript inspection for
    // budget exhaustion, where SubagentStop is not emitted.
    if (typeof input.last_assistant_message === "string") {
      const complete = Boolean(input.last_assistant_message.trim());
      this.stoppedAnswers.set(input.agent_id, complete);
      if (!complete) this.error = failure(input.agent_type);
      return;
    }
    await this.check(input.agent_transcript_path, input.agent_type);
  }
  async notified(message: SDKMessage): Promise<void> {
    if (message.type !== "system") return;
    if (message.subtype === "task_started") {
      const launch = message.tool_use_id
        ? this.launches.get(message.tool_use_id)
        : undefined;
      if (launch) {
        this.agents.set(message.task_id, launch.agentType);
        if (launch.name) this.names.set(launch.name, message.task_id);
      }
      return;
    }
    if (
      message.subtype !== "task_notification" ||
      message.status !== "completed"
    )
      return;
    const launch = message.tool_use_id
      ? this.launches.get(message.tool_use_id)
      : undefined;
    if (launch && message.tool_use_id) {
      this.launches.delete(message.tool_use_id);
      this.agents.set(message.task_id, launch.agentType);
      if (launch.name) this.names.set(launch.name, message.task_id);
      if (this.stoppedAnswers.has(message.task_id)) {
        this.stoppedAnswers.delete(message.task_id);
        return;
      }
      await this.check(message.output_file, launch.agentType);
    }
  }

  private async check(path: string, agentType: string): Promise<void> {
    try {
      if (!(await hasFinalBusinessAnswer(path)))
        this.error = failure(agentType);
    } catch {
      this.error = `模拟未完成：无法核验${ROLES[agentType]}的最终回答，本次不应判分。`;
    }
  }
}
