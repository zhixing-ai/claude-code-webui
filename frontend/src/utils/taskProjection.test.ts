import { describe, expect, it } from "vitest";
import type { SDKMessage } from "../types";
import {
  createEmptyTaskProjection,
  reduceTaskMessage,
  replayTaskMessages,
  selectTasks,
} from "./taskProjection";

function message(value: unknown): SDKMessage {
  return value as SDKMessage;
}

describe("taskProjection", () => {
  it("correlates create and update results, including snake_case input", () => {
    const messages = [
      message({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "create-1",
              name: "TaskCreate",
              input: {
                subject: "Build task panel",
                description: "Render live Claude tasks",
                active_form: "Building task panel",
              },
            },
          ],
        },
      }),
      message({
        type: "user",
        tool_use_result: {
          task: { id: "7", subject: "Build task panel" },
        },
        message: {
          content: [{ type: "tool_result", tool_use_id: "create-1" }],
        },
      }),
      message({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "update-1",
              name: "TaskUpdate",
              input: { task_id: "7", status: "in_progress" },
            },
          ],
        },
      }),
      message({
        type: "user",
        tool_use_result: { success: true, taskId: "7" },
        message: {
          content: [{ type: "tool_result", tool_use_id: "update-1" }],
        },
      }),
    ];

    expect(selectTasks(replayTaskMessages(messages))).toEqual([
      expect.objectContaining({
        id: "7",
        subject: "Build task panel",
        description: "Render live Claude tasks",
        activeForm: "Building task panel",
        status: "in_progress",
      }),
    ]);
  });

  it("uses TaskList as a snapshot while preserving known details", () => {
    const state = replayTaskMessages([
      message({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "create-1",
              name: "TaskCreate",
              input: { subject: "First", description: "Keep this detail" },
            },
          ],
        },
      }),
      message({
        type: "user",
        tool_use_result: { task: { id: "1", subject: "First" } },
        message: {
          content: [{ type: "tool_result", tool_use_id: "create-1" }],
        },
      }),
      message({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "list-1",
              name: "TaskList",
              input: {},
            },
          ],
        },
      }),
      message({
        type: "user",
        tool_use_result: {
          tasks: [
            {
              id: "1",
              subject: "First",
              status: "completed",
              blockedBy: [],
            },
            {
              id: "2",
              subject: "Second",
              status: "pending",
              blockedBy: ["1"],
            },
          ],
        },
        message: {
          content: [{ type: "tool_result", tool_use_id: "list-1" }],
        },
      }),
    ]);

    expect(selectTasks(state)).toEqual([
      expect.objectContaining({
        id: "1",
        status: "completed",
        description: "Keep this detail",
      }),
      expect.objectContaining({
        id: "2",
        status: "pending",
        blockedBy: ["1"],
      }),
    ]);
  });

  it("does not commit a failed update", () => {
    const initial = {
      ...createEmptyTaskProjection(),
      byId: {
        "1": {
          id: "1",
          subject: "Stable",
          status: "pending" as const,
          blockedBy: [],
          blocks: [],
        },
      },
      order: ["1"],
    };
    const withPendingUpdate = reduceTaskMessage(
      initial,
      message({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "update-1",
              name: "TaskUpdate",
              input: { taskId: "1", status: "completed" },
            },
          ],
        },
      }),
    );
    const failed = reduceTaskMessage(
      withPendingUpdate,
      message({
        type: "user",
        tool_use_result: { success: false, error: "blocked" },
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "update-1",
              is_error: true,
            },
          ],
        },
      }),
    );

    expect(failed.byId["1"].status).toBe("pending");
    expect(failed.pendingToolUses).toEqual({});
  });
});
