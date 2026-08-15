import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { PLATFORM_AGENTS, projectAgentEvents } from "./agents.ts";

function message(value: unknown): SDKMessage {
  return value as SDKMessage;
}

describe("platform agents", () => {
  it("registers the isolated FDE roles without write tools", () => {
    expect(Object.keys(PLATFORM_AGENTS)).toEqual([
      "fde-scenario-designer",
      "fde-l1-examiner",
      "fde-customer-simulator",
      "fde-business-agent",
      "fde-evaluator",
      "fde-document-auditor",
    ]);
    for (const agent of Object.values(PLATFORM_AGENTS)) {
      expect(agent.background).toBe(false);
      expect(agent.permissionMode).toBe(
        agent.tools?.length ? "default" : "dontAsk",
      );
      expect(agent.tools).not.toContain("Write");
      expect(agent.tools).not.toContain("Edit");
      expect(agent.tools).not.toContain("Bash");
    }
  });
});

describe("projectAgentEvents", () => {
  it("projects registration and a complete subagent lifecycle", () => {
    expect(
      projectAgentEvents(
        message({
          type: "system",
          subtype: "init",
          agents: ["general-purpose", "fde-evaluator"],
        }),
      ),
    ).toEqual([
      {
        agentRunId: "definition:fde-evaluator",
        agentType: "fde-evaluator",
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
                  subagent_type: "fde-evaluator",
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
        agentType: "fde-evaluator",
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
          subagent_type: "fde-evaluator",
          description: "Score case 7",
          prompt: "hidden rubric",
        }),
      ),
    ).toEqual([
      {
        agentRunId: "task:task-1",
        agentType: "fde-evaluator",
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
