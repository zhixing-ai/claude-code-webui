import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  FDE_MAIN_AGENT,
  projectAgentEvents,
  shortAgentName,
} from "./agents.ts";

function message(value: unknown): SDKMessage {
  return value as SDKMessage;
}

describe("plugin agents", () => {
  it("uses the plugin namespace", () => {
    expect(FDE_MAIN_AGENT).toBe("fde-suite:fde-builder");
    expect(shortAgentName("fde-suite:fde-evaluator")).toBe("fde-evaluator");
  });
});

describe("projectAgentEvents", () => {
  it("projects registration and a complete subagent lifecycle", () => {
    expect(
      projectAgentEvents(
        message({
          type: "system",
          subtype: "init",
          agents: [
            "general-purpose",
            "fde-suite:fde-builder",
            "fde-suite:fde-evaluator",
          ],
        }),
      ),
    ).toEqual([
      {
        agentRunId: "definition:fde-suite:fde-evaluator",
        agentType: "fde-suite:fde-evaluator",
        status: "registered",
      },
    ]);

    expect(
      projectAgentEvents(
        message({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Agent",
                input: {
                  subagent_type: "fde-suite:fde-evaluator",
                  description: "Score case 7",
                  prompt: "hidden rubric",
                },
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        agentRunId: "tool:tool-1",
        agentType: "fde-suite:fde-evaluator",
        status: "queued",
        toolUseId: "tool-1",
        description: "Score case 7",
      },
    ]);

    expect(
      projectAgentEvents(
        message({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "tool-1",
          subagent_type: "fde-suite:fde-evaluator",
          description: "Score case 7",
          prompt: "hidden rubric",
        }),
      ),
    ).toEqual([
      {
        agentRunId: "task:task-1",
        agentType: "fde-suite:fde-evaluator",
        status: "running",
        taskId: "task-1",
        toolUseId: "tool-1",
        description: "Score case 7",
      },
    ]);

    expect(
      projectAgentEvents(
        message({
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          tool_use_id: "tool-1",
          status: "completed",
          summary: "Passed with evidence",
          usage: { total_tokens: 120, tool_uses: 2, duration_ms: 900 },
        }),
      ),
    ).toEqual([
      {
        agentRunId: "task:task-1",
        agentType: "subagent",
        status: "completed",
        taskId: "task-1",
        toolUseId: "tool-1",
        summary: "Passed with evidence",
        usage: { totalTokens: 120, toolUses: 2, durationMs: 900 },
      },
    ]);
  });

  it("forwards subagent text summaries but never thinking blocks", () => {
    expect(
      projectAgentEvents(
        message({
          type: "assistant",
          parent_tool_use_id: "tool-2",
          message: {
            content: [
              { type: "thinking", thinking: "secret reasoning" },
              { type: "text", text: "Safe final summary" },
            ],
          },
        }),
      )[0],
    ).toMatchObject({
      agentRunId: "tool:tool-2",
      summary: "Safe final summary",
    });
  });
});
