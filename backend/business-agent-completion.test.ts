import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BusinessAgentCompletionGuard,
  hasFinalBusinessAnswer,
} from "./business-agent-completion.ts";
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function transcript(entries: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), "agent-completion-test-"));
  paths.push(dir);
  const file = join(dir, "agent.jsonl");
  await writeFile(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return file;
}
const assistant = (
  id: string,
  stop_reason: string | null,
  content: unknown[],
) => ({ type: "assistant", message: { id, stop_reason, content } });
it("does not accept an earlier preamble when the final turn ends with a tool", async () => {
  const file = await transcript([
    assistant("one", "tool_use", [
      { type: "text", text: "I'll read the materials" },
      { type: "tool_use", name: "Read" },
    ]),
    assistant("two", "tool_use", [{ type: "tool_use", name: "Grep" }]),
    {
      type: "user",
      message: { content: [{ type: "tool_result", content: "facts" }] },
    },
  ]);
  expect(await hasFinalBusinessAnswer(file)).toBe(false);
});
it("accepts final text split across transcript frames with the same message id", async () => {
  const file = await transcript([
    assistant("one", "tool_use", [{ type: "tool_use", name: "Read" }]),
    assistant("two", null, [{ type: "text", text: "单项100元" }]),
    assistant("two", "end_turn", []),
  ]);
  expect(await hasFinalBusinessAnswer(file)).toBe(true);
});
it("does not treat thinking-only or empty end_turn as a business answer", async () => {
  expect(
    await hasFinalBusinessAnswer(
      await transcript([assistant("one", "end_turn", [])]),
    ),
  ).toBe(false);
});

it("checks completed background notifications only for registered business agents", async () => {
  const guard = new BusinessAgentCompletionGuard();
  const file = await transcript([
    assistant("last", "tool_use", [{ type: "tool_use", name: "Read" }]),
  ]);
  const event = {
    type: "system",
    subtype: "task_notification",
    status: "completed",
    tool_use_id: "business",
    output_file: file,
  } as any;
  await guard.notified(event);
  expect(guard.error).toBeUndefined();
  guard.register({
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_use_id: "business",
    tool_input: { subagent_type: "fde-suite:fde-business-agent" },
  } as any);
  await guard.notified(event);
  expect(guard.error).toContain("模拟未完成");
});

it("preserves normal business answers and fails closed when a transcript is missing", async () => {
  const guard = new BusinessAgentCompletionGuard();
  const file = await transcript([
    assistant("last", "end_turn", [
      { type: "text", text: "CHAIN_COMPLETE_7391" },
    ]),
  ]);
  await guard.stopped({
    hook_event_name: "SubagentStop",
    agent_type: "fde-suite:fde-business-agent",
    agent_transcript_path: file,
  } as any);
  expect(guard.error).toBeUndefined();
  await guard.stopped({
    hook_event_name: "SubagentStop",
    agent_type: "fde-suite:fde-business-agent",
    agent_transcript_path: join(file, "missing"),
  } as any);
  expect(guard.error).toContain("无法核验");
});

it("uses the SDK final answer before transcript flush and consumes it once", async () => {
  const guard = new BusinessAgentCompletionGuard();
  const file = await transcript([
    assistant("last", null, [{ type: "thinking" }]),
  ]);
  const launch = (id: string) =>
    guard.register({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_use_id: id,
      tool_input: {
        subagent_type: "fde-suite:fde-business-agent",
      },
    } as any);
  launch("first");
  await guard.stopped({
    hook_event_name: "SubagentStop",
    agent_type: "fde-suite:fde-business-agent",
    agent_id: "agent",
    agent_transcript_path: file,
    last_assistant_message: "CHAIN_COMPLETE_7391",
  } as any);
  await guard.notified({
    type: "system",
    subtype: "task_notification",
    status: "completed",
    tool_use_id: "first",
    task_id: "agent",
    output_file: file,
  } as any);
  expect(guard.error).toBeUndefined();
  guard.register({
    hook_event_name: "PreToolUse",
    tool_name: "SendMessage",
    tool_use_id: "resumed",
    tool_input: { to: "agent", message: "Continue" },
  } as any);
  await guard.notified({
    type: "system",
    subtype: "task_notification",
    status: "completed",
    tool_use_id: "resumed",
    task_id: "agent",
    output_file: file,
  } as any);
  expect(guard.error).toContain("模拟未完成");
});

it("rejects an evaluator that ends on tools without a final verdict", async () => {
  const guard = new BusinessAgentCompletionGuard();
  const file = await transcript([
    assistant("evaluator-last", "tool_use", [
      { type: "text", text: "Let me check the decision table" },
      { type: "tool_use", name: "Read" },
    ]),
  ]);
  guard.register({
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_use_id: "evaluation",
    tool_input: { subagent_type: "fde-suite:fde-evaluator" },
  } as any);
  await guard.notified({
    type: "system",
    subtype: "task_notification",
    status: "completed",
    tool_use_id: "evaluation",
    task_id: "evaluator",
    output_file: file,
  } as any);
  expect(guard.error).toContain("评估角色");
});

it.each(["fde-suite:fde-business-agent", "fde-suite:fde-evaluator"])(
  "rejects exhausted native SendMessage continuation for %s",
  async (role) => {
    const guard = new BusinessAgentCompletionGuard();
    const file = await transcript([
      assistant("ready", "end_turn", [{ type: "text", text: "READY" }]),
      assistant("read-one", "tool_use", [{ type: "tool_use", name: "Read" }]),
      assistant("read-two", "tool_use", [{ type: "tool_use", name: "Read" }]),
    ]);
    guard.register({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_use_id: "first",
      tool_input: { subagent_type: role, name: "sales" },
    } as any);
    await guard.notified({
      type: "system",
      subtype: "task_started",
      task_id: "same-agent",
      tool_use_id: "first",
    } as any);
    await guard.stopped({
      hook_event_name: "SubagentStop",
      agent_id: "same-agent",
      agent_type: role,
      last_assistant_message: "READY",
    } as any);
    await guard.notified({
      type: "system",
      subtype: "task_notification",
      status: "completed",
      task_id: "same-agent",
      tool_use_id: "first",
      output_file: file,
    } as any);
    expect(guard.error).toBeUndefined();
    guard.register({
      hook_event_name: "PreToolUse",
      tool_name: "SendMessage",
      tool_use_id: "second",
      tool_input: { to: "sales", message: "Read the file chain" },
    } as any);
    await guard.notified({
      type: "system",
      subtype: "task_started",
      task_id: "same-agent",
      tool_use_id: "second",
    } as any);
    await guard.notified({
      type: "system",
      subtype: "task_notification",
      status: "completed",
      task_id: "same-agent",
      tool_use_id: "second",
      output_file: file,
    } as any);
    expect(guard.error).toContain("模拟未完成");
  },
);

it("accepts a fresh final response on native continuation before transcript flush", async () => {
  const guard = new BusinessAgentCompletionGuard();
  const role = "fde-suite:fde-business-agent";
  guard.register({
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_use_id: "first",
    tool_input: { subagent_type: role },
  } as any);
  await guard.stopped({
    hook_event_name: "SubagentStop",
    agent_id: "agent",
    agent_type: role,
    last_assistant_message: "First reply",
  } as any);
  await guard.notified({
    type: "system",
    subtype: "task_notification",
    status: "completed",
    task_id: "agent",
    tool_use_id: "first",
    output_file: "/not-yet-flushed",
  } as any);
  guard.register({
    hook_event_name: "PreToolUse",
    tool_name: "SendMessage",
    tool_use_id: "second",
    tool_input: { to: "agent", message: "Next question" },
  } as any);
  await guard.stopped({
    hook_event_name: "SubagentStop",
    agent_id: "agent",
    agent_type: role,
    last_assistant_message: "Second reply",
  } as any);
  await guard.notified({
    type: "system",
    subtype: "task_notification",
    status: "completed",
    task_id: "agent",
    tool_use_id: "second",
    output_file: "/not-yet-flushed",
  } as any);
  expect(guard.error).toBeUndefined();
});
