import {
  getSessionMessages,
  InMemorySessionStore,
  query,
  type HookCallback,
  type Options,
  type SDKMessage,
  type SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import { posix } from "node:path";
import type {
  AskUserQuestionItem,
  AskUserQuestionOption,
  ChatRequest,
  SequencedStreamResponse,
  StreamResponse,
} from "../../shared/types.ts";
import type { RunStateStore, StoredRunEvent } from "../state/types.ts";
import { MemoryRunStore } from "../state/memory.ts";
import { logger } from "../utils/logger.ts";
import { PendingInteractions } from "./interactions.ts";
import { FDE_MAIN_AGENT, projectAgentEvents } from "../agents.ts";
import {
  createSimulationReporter,
  inferSimulationCommand,
  projectSimulationEvents,
  readSimulationCommand,
  SimulationLifecycleTracker,
  SIMULATION_REPORT_TOOL_NAME,
  simulationOutputFormat,
  simulationSystemPrompt,
} from "../simulation.ts";

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval>;
};

type ActiveRun = {
  request: ChatRequest;
  abortController: AbortController;
  subscribers: Set<Subscriber>;
};

const CONTEXT_LIMIT =
  /prompt is too long|exceeded model token limit|conversation too long/i;
export const SANDBOX_TEST_WORKING_DIRECTORY = "/home/user/workspace/chat";
const SANDBOX_TEST_SKILL = "private-domain-sales";
const MANAGED_AUTO_ALLOWED_TOOLS = [
  "Agent",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "Monitor",
  "NotebookEdit",
  "Read",
  "Skill",
  "StructuredOutput",
  "Task",
  "TaskOutput",
  "TaskStop",
  "WebFetch",
  "WebSearch",
  "Write",
] as const;

function isSandboxTestToolAllowed(toolName: string, input: unknown): boolean {
  if (!isObject(input)) return false;
  if (toolName === "Skill") return input.skill === SANDBOX_TEST_SKILL;
  if (toolName !== "Read" && toolName !== "Glob" && toolName !== "Grep") {
    return false;
  }
  const pathKey = toolName === "Read" ? "file_path" : "path";
  const requestedPath = input[pathKey];
  if (requestedPath === undefined) return toolName !== "Read";
  if (typeof requestedPath !== "string" || !requestedPath) return false;
  const resolved = posix.resolve(SANDBOX_TEST_WORKING_DIRECTORY, requestedPath);
  return (
    resolved === SANDBOX_TEST_WORKING_DIRECTORY ||
    resolved.startsWith(`${SANDBOX_TEST_WORKING_DIRECTORY}/`)
  );
}

function isContextLimitMessage(message: unknown): boolean {
  if (!isObject(message)) return false;
  if (message.type === "result" && message.is_error === true) {
    const errors = Array.isArray(message.errors) ? message.errors : [];
    return [...errors, message.result].some(
      (value) => typeof value === "string" && CONTEXT_LIMIT.test(value),
    );
  }
  if (message.type !== "assistant") return false;
  const payload = isObject(message.message) ? message.message : undefined;
  return (
    Array.isArray(payload?.content) &&
    payload.content.some(
      (item) =>
        isObject(item) &&
        item.type === "text" &&
        typeof item.text === "string" &&
        CONTEXT_LIMIT.test(item.text),
    )
  );
}

function isContextLimitError(error: unknown): boolean {
  return error instanceof Error && CONTEXT_LIMIT.test(error.message);
}

function isCompactionAnchor(message: unknown): boolean {
  if (
    !isObject(message) ||
    message.type !== "assistant" ||
    isContextLimitMessage(message)
  ) {
    return false;
  }
  const payload = isObject(message.message) ? message.message : undefined;
  return !(
    Array.isArray(payload?.content) &&
    payload.content.some((item) => isObject(item) && item.type === "tool_use")
  );
}

function selectCompactionAnchors(messages: unknown[]): string[] {
  const anchors = messages.flatMap((message) => {
    if (!isCompactionAnchor(message) || !isObject(message)) return [];
    return typeof message.uuid === "string" && message.uuid
      ? [message.uuid]
      : [];
  });
  const selected: string[] = [];
  for (let offset = 1; offset <= anchors.length; offset *= 2) {
    selected.push(anchors[anchors.length - offset]);
  }
  if (anchors[0] && selected.at(-1) !== anchors[0]) selected.push(anchors[0]);
  return selected;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOption(value: unknown): AskUserQuestionOption | null {
  if (
    !isObject(value) ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    (value.preview !== undefined && typeof value.preview !== "string")
  ) {
    return null;
  }

  return {
    label: value.label,
    description: value.description,
    ...(value.preview === undefined ? {} : { preview: value.preview }),
  };
}

function readQuestions(
  input: Record<string, unknown>,
): AskUserQuestionItem[] | null {
  if (
    !Array.isArray(input.questions) ||
    input.questions.length < 1 ||
    input.questions.length > 4
  ) {
    return null;
  }

  const questions: AskUserQuestionItem[] = [];
  for (const value of input.questions) {
    if (
      !isObject(value) ||
      typeof value.question !== "string" ||
      !value.question.trim() ||
      typeof value.header !== "string" ||
      !value.header.trim() ||
      typeof value.multiSelect !== "boolean" ||
      !Array.isArray(value.options) ||
      value.options.length < 2 ||
      value.options.length > 4
    ) {
      return null;
    }

    const options = value.options.map(readOption);
    if (options.some((option) => option === null)) return null;

    questions.push({
      question: value.question,
      header: value.header,
      multiSelect: value.multiSelect,
      options: options as AskUserQuestionOption[],
    });
  }

  return questions;
}

export class ChatRunManager {
  private readonly active = new Map<string, ActiveRun>();
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly cliPath: string | undefined,
    private readonly interactions: PendingInteractions,
    private readonly requestAbortControllers: Map<string, AbortController>,
    private readonly runStore: RunStateStore,
    private readonly sessionStore: SessionStore,
    private readonly fdeSuitePluginDir?: string,
  ) {}

  hasRun(runId: string): boolean {
    return this.active.has(runId) || Boolean(this.runStore.getRun(runId));
  }

  start(request: ChatRequest): string {
    if (this.hasRun(request.requestId)) {
      throw new Error("Run already exists");
    }

    const inferredSimulation =
      request.simulation ??
      (this.fdeSuitePluginDir && request.runMode !== "sandbox_test"
        ? inferSimulationCommand(request.message)
        : undefined);
    const normalizedRequest = inferredSimulation
      ? { ...request, simulation: inferredSimulation }
      : request;
    const run: ActiveRun = {
      request: normalizedRequest,
      abortController: new AbortController(),
      subscribers: new Set(),
    };
    this.active.set(request.requestId, run);
    this.requestAbortControllers.set(request.requestId, run.abortController);
    this.runStore.createRun(request.requestId, normalizedRequest);
    void this.execute(run);
    return request.requestId;
  }

  createEventStream(runId: string, after = 0): ReadableStream<Uint8Array> {
    let currentSubscriber: Subscriber | undefined;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const storedRun = this.runStore.getRun(runId);
        const activeRun = this.active.get(runId);
        const events = this.runStore.getRunEvents(runId, after);

        for (const event of events) {
          controller.enqueue(this.encode(runId, event));
        }

        if (!activeRun || (storedRun && storedRun.status !== "running")) {
          controller.close();
          return;
        }

        const subscriber: Subscriber = {
          controller,
          heartbeat: setInterval(() => {
            try {
              controller.enqueue(
                this.encoder.encode(
                  `${JSON.stringify({ type: "heartbeat", runId })}\n`,
                ),
              );
            } catch {
              this.removeSubscriber(activeRun, subscriber);
            }
          }, 15_000),
        };
        currentSubscriber = subscriber;
        activeRun.subscribers.add(subscriber);
      },
      cancel: () => {
        const activeRun = this.active.get(runId);
        if (activeRun && currentSubscriber) {
          this.removeSubscriber(activeRun, currentSubscriber);
        }
      },
    });
  }

  private async execute(run: ActiveRun): Promise<void> {
    const { request, abortController } = run;
    let status: "completed" | "failed" | "aborted" = "completed";
    let errorMessage: string | undefined;

    logger.chat.debug(
      "Starting chat run {*}",
      request as unknown as Record<string, unknown>,
    );

    const simulation = request.simulation;
    const sandboxTest = request.runMode === "sandbox_test";
    const simulationTracker = simulation
      ? new SimulationLifecycleTracker(simulation)
      : undefined;

    const emitSimulation = (
      event: Parameters<SimulationLifecycleTracker["accept"]>[0],
    ) => {
      const rejection = simulationTracker?.accept(event);
      if (!rejection) {
        this.emit(request.requestId, { type: "simulation_event", event });
      }
      return rejection;
    };

    if (
      simulation?.action === "design" ||
      (simulation?.action === "orchestrate" &&
        simulation.startsWith === "design")
    ) {
      emitSimulation({
        kind: "design_started",
        ...(simulation.action === "orchestrate"
          ? { runAfterDesign: simulation.runAfterDesign }
          : {}),
      });
    }

    const appendedSystemPrompt = [
      request.systemPrompt,
      simulation ? simulationSystemPrompt(simulation) : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");

    const simulationReporter =
      simulation && this.fdeSuitePluginDir && request.runMode !== "sandbox_test"
        ? createSimulationReporter((event) => {
            return emitSimulation(event);
          })
        : undefined;
    const managedProductRun = request.runMode === "builder" || sandboxTest;
    const requestedAllowedTools = managedProductRun
      ? [
          ...new Set([
            ...MANAGED_AUTO_ALLOWED_TOOLS,
            ...(request.allowedTools ?? []),
          ]),
        ].filter((tool) => !tool.startsWith("AskUserQuestion"))
      : request.allowedTools;
    const allowedTools = simulationReporter
      ? [
          ...new Set([
            ...(requestedAllowedTools ?? []),
            SIMULATION_REPORT_TOOL_NAME,
          ]),
        ]
      : requestedAllowedTools;

    // `bypassPermissions` cannot express SalesAI's policy: the Agent SDK skips
    // canUseTool entirely in that mode, including for AskUserQuestion. Keep the
    // SDK in default mode, pre-authorize ordinary tools for background agents,
    // and keep the PreToolUse fallback. AskUserQuestion deliberately falls
    // through to canUseTool below.
    const managedPermissionMode = managedProductRun
      ? "default"
      : request.permissionMode;
    const autoApproveOrdinaryTools: HookCallback = async (input) => {
      if (
        input.hook_event_name !== "PreToolUse" ||
        input.tool_name === "AskUserQuestion"
      ) {
        return {};
      }
      if (
        sandboxTest &&
        !isSandboxTestToolAllowed(input.tool_name, input.tool_input)
      ) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "Sandbox test tools are confined to the isolated chat workspace and tenant Skill",
          },
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason:
            "SalesAI product runs auto-approve ordinary tools",
        },
      };
    };

    const options: Options = {
      abortController,
      executable: "node",
      executableArgs: [],
      ...(this.cliPath ? { pathToClaudeCodeExecutable: this.cliPath } : {}),
      includePartialMessages: true,
      forwardSubagentText: true,
      agentProgressSummaries: true,
      ...(this.fdeSuitePluginDir && !sandboxTest
        ? {
            plugins: [{ type: "local" as const, path: this.fdeSuitePluginDir }],
            agent: FDE_MAIN_AGENT,
          }
        : {}),
      ...(sandboxTest
        ? {
            cwd: SANDBOX_TEST_WORKING_DIRECTORY,
            settingSources: ["project" as const],
            skills: [SANDBOX_TEST_SKILL],
            tools: ["Skill", "Read", "Glob", "Grep"],
          }
        : request.workingDirectory
          ? { cwd: request.workingDirectory }
          : {}),
      ...(simulationReporter
        ? { mcpServers: { webui: simulationReporter } }
        : {}),
      ...(simulation
        ? {
            tools: [
              "Task",
              "Agent",
              "TaskOutput",
              "TaskStop",
              "StructuredOutput",
              "AskUserQuestion",
              "Read",
              "Glob",
              "Grep",
            ],
            outputFormat: simulationOutputFormat(simulation),
          }
        : {}),
      ...(request.newSessionId ? { sessionId: request.newSessionId } : {}),
      ...(request.sessionId ? { resume: request.sessionId } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      ...(!sandboxTest && request.additionalDirectories
        ? { additionalDirectories: request.additionalDirectories }
        : {}),
      ...(appendedSystemPrompt
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: appendedSystemPrompt,
            },
          }
        : {}),
      ...(managedPermissionMode
        ? { permissionMode: managedPermissionMode }
        : {}),
      ...(managedProductRun
        ? {
            hooks: {
              PreToolUse: [{ hooks: [autoApproveOrdinaryTools] }],
            },
          }
        : {}),
      sessionStore: this.sessionStore,
      sessionStoreFlush: "eager",
      loadTimeoutMs: 90_000,
      canUseTool: async (toolName, input, permissionOptions) => {
        if (toolName === "AskUserQuestion") {
          const questions = readQuestions(input);
          if (!questions) {
            return {
              behavior: "deny",
              message: "Invalid AskUserQuestion input",
            };
          }

          const pending = this.interactions.create(
            request.requestId,
            questions,
            permissionOptions.signal,
          );
          this.emit(request.requestId, {
            type: "ask_user_question",
            interactionId: pending.interactionId,
            questions,
          });
          return pending.response;
        }

        if (managedProductRun) {
          return { behavior: "allow", updatedInput: input };
        }

        const pending = this.interactions.createPermission(
          request.requestId,
          toolName,
          input,
          permissionOptions.suggestions,
          permissionOptions.signal,
        );
        this.emit(request.requestId, {
          type: "tool_permission",
          interactionId: pending.interactionId,
          toolName,
          input,
          toolUseId: permissionOptions.toolUseID,
          canRemember: Boolean(permissionOptions.suggestions?.length),
          ...(permissionOptions.title
            ? { title: permissionOptions.title }
            : {}),
          ...(permissionOptions.displayName
            ? { displayName: permissionOptions.displayName }
            : {}),
          ...(permissionOptions.description
            ? { description: permissionOptions.description }
            : {}),
          ...(permissionOptions.blockedPath
            ? { blockedPath: permissionOptions.blockedPath }
            : {}),
          ...(permissionOptions.decisionReason
            ? { decisionReason: permissionOptions.decisionReason }
            : {}),
        });
        return pending.response;
      },
    };

    const forward = (sdkMessage: SDKMessage) => {
      logger.chat.debug("Claude SDK Message: {sdkMessage}", { sdkMessage });
      const sessionId = readSessionId(sdkMessage);
      if (
        request.newSessionId &&
        sessionId &&
        sessionId !== request.newSessionId
      ) {
        throw new Error("Claude returned a different session ID");
      }
      if (sessionId) {
        this.runStore.setRunSession(request.requestId, sessionId);
      }
      this.emit(request.requestId, {
        type: "claude_json",
        data: sdkMessage,
      });
      for (const event of projectAgentEvents(sdkMessage)) {
        this.emit(request.requestId, { type: "agent_event", event });
      }
      if (simulation) {
        for (const event of projectSimulationEvents(simulation, sdkMessage)) {
          const rejection = emitSimulation(event);
          if (rejection) throw new Error(rejection);
        }
      }
    };

    const executeQuery = async (
      prompt: string,
      queryOptions: Options,
      suppressContextLimit = false,
    ) => {
      let contextLimit = false;
      let progressed = false;
      try {
        for await (const sdkMessage of query({
          prompt,
          options: queryOptions,
        })) {
          if (suppressContextLimit && isContextLimitMessage(sdkMessage)) {
            contextLimit = true;
            continue;
          }
          progressed ||= sdkMessage.type !== "system";
          forward(sdkMessage);
        }
        if (suppressContextLimit && contextLimit) {
          throw new Error("Prompt is too long");
        }
      } catch (error) {
        if (
          suppressContextLimit &&
          (contextLimit || isContextLimitError(error))
        ) {
          if (progressed) {
            throw new Error(
              "Session context limit reached after work started; automatic retry was skipped",
            );
          }
          throw new Error("Builder session context limit reached", {
            cause: error,
          });
        }
        throw error;
      }
    };

    try {
      try {
        await executeQuery(request.message, options, true);
      } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        const sessionId = request.sessionId ?? request.newSessionId;
        if (
          request.message === "/compact" ||
          !sessionId ||
          (!isContextLimitError(error) && !isContextLimitError(cause))
        ) {
          throw cause ?? error;
        }

        logger.chat.info("Compacting oversized session {sessionId}", {
          sessionId,
        });
        const messages = await getSessionMessages(sessionId, {
          ...(request.workingDirectory
            ? { dir: request.workingDirectory }
            : {}),
          sessionStore: this.sessionStore,
        });
        const anchors = selectCompactionAnchors(messages);
        if (!anchors.length) throw cause ?? error;

        let compactedOptions: Options | undefined;
        let compactionError: string | undefined;
        for (const resumeSessionAt of anchors) {
          const recoveryOptions: Options = {
            ...options,
            sessionId: undefined,
            resume: sessionId,
            resumeSessionAt,
          };
          let compacted = false;
          let stillTooLong = false;
          try {
            for await (const sdkMessage of query({
              prompt: "/compact",
              options: recoveryOptions,
            })) {
              compacted ||=
                sdkMessage.type === "system" &&
                sdkMessage.subtype === "compact_boundary";
              if (
                sdkMessage.type === "system" &&
                sdkMessage.subtype === "status" &&
                sdkMessage.compact_result === "failed"
              ) {
                compactionError = sdkMessage.compact_error;
              }
              stillTooLong ||= isContextLimitMessage(sdkMessage);
            }
          } catch (compactError) {
            if (!isContextLimitError(compactError)) throw compactError;
            stillTooLong = true;
          }
          if (compacted) {
            compactedOptions = recoveryOptions;
            break;
          }
          if (!stillTooLong) break;
        }
        if (!compactedOptions) {
          throw new Error(
            compactionError ??
              "Claude Code did not complete session compaction",
          );
        }
        await executeQuery(
          request.message,
          {
            ...compactedOptions,
            resumeSessionAt: undefined,
          },
          true,
        );
      }

      if (!abortController.signal.aborted) {
        const incomplete = simulationTracker?.incompleteReason();
        if (incomplete) {
          emitSimulation({ kind: "simulation_failed", error: incomplete });
          throw new Error(incomplete);
        }
      }

      if (abortController.signal.aborted) {
        status = "aborted";
        this.emit(request.requestId, { type: "aborted" });
      } else {
        this.emit(request.requestId, { type: "done" });
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      if (abortController.signal.aborted) {
        status = "aborted";
        this.emit(request.requestId, { type: "aborted" });
      } else {
        status = "failed";
        logger.chat.error("Claude Code execution failed: {error}", { error });
        this.emit(request.requestId, {
          type: "error",
          error: errorMessage,
        });
      }
    } finally {
      this.interactions.cancelRequest(request.requestId, "Request ended");
      this.requestAbortControllers.delete(request.requestId);
      this.runStore.finishRun(request.requestId, status, errorMessage);
      this.finishSubscribers(run);
      this.active.delete(request.requestId);
    }
  }

  private emit(runId: string, event: StreamResponse): void {
    const run = this.active.get(runId);
    if (!run) return;
    const sequence = this.runStore.appendRunEvent(runId, event);
    const storedEvent = { sequence, event };

    for (const subscriber of run.subscribers) {
      try {
        subscriber.controller.enqueue(this.encode(runId, storedEvent));
      } catch {
        this.removeSubscriber(run, subscriber);
      }
    }
  }

  private encode(runId: string, event: StoredRunEvent): Uint8Array {
    const payload: SequencedStreamResponse = {
      ...event.event,
      runId,
      sequence: event.sequence,
    };
    return this.encoder.encode(`${JSON.stringify(payload)}\n`);
  }

  private removeSubscriber(run: ActiveRun, subscriber: Subscriber): void {
    clearInterval(subscriber.heartbeat);
    run.subscribers.delete(subscriber);
  }

  private finishSubscribers(run: ActiveRun): void {
    for (const subscriber of run.subscribers) {
      clearInterval(subscriber.heartbeat);
      try {
        subscriber.controller.close();
      } catch {
        // The client already disconnected.
      }
    }
    run.subscribers.clear();
  }
}

function readSessionId(message: unknown): string | undefined {
  if (!isObject(message)) return undefined;
  const value = message.session_id;
  return typeof value === "string" && value ? value : undefined;
}

function readChatRequest(value: unknown): ChatRequest | null {
  if (
    !isObject(value) ||
    typeof value.message !== "string" ||
    !value.message.trim() ||
    typeof value.requestId !== "string" ||
    !value.requestId ||
    (value.runMode !== undefined &&
      value.runMode !== "builder" &&
      value.runMode !== "sandbox_test") ||
    (value.systemPrompt !== undefined &&
      (typeof value.systemPrompt !== "string" || !value.systemPrompt.trim()))
  ) {
    return null;
  }
  const simulation =
    value.simulation === undefined
      ? undefined
      : readSimulationCommand(value.simulation);
  if (value.simulation !== undefined && !simulation) return null;
  if (
    value.runMode === "sandbox_test" &&
    (simulation ||
      value.workingDirectory !== SANDBOX_TEST_WORKING_DIRECTORY ||
      value.additionalDirectories !== undefined)
  ) {
    return null;
  }
  return {
    ...(value as unknown as ChatRequest),
    ...(simulation ? { simulation } : {}),
  };
}

export async function handleChatRequest(
  c: Context,
  runsOrControllers: ChatRunManager | Map<string, AbortController>,
  legacyInteractions?: PendingInteractions,
) {
  const runs =
    runsOrControllers instanceof ChatRunManager
      ? runsOrControllers
      : new ChatRunManager(
          c.var.config.cliPath,
          legacyInteractions ?? new PendingInteractions(),
          runsOrControllers,
          c.var.config.runStore ?? new MemoryRunStore(),
          c.var.config.sessionStore ?? new InMemorySessionStore(),
          c.var.config.fdeSuitePluginDir,
        );
  let request: ChatRequest | null;
  try {
    request = readChatRequest(await c.req.json());
  } catch {
    request = null;
  }
  if (!request) return c.json({ error: "Invalid chat request" }, 400);
  if (runs.hasRun(request.requestId)) {
    return c.json({ error: "Run already exists" }, 409);
  }

  runs.start(request);
  return streamResponse(runs.createEventStream(request.requestId));
}

export function streamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
