import {
  InMemorySessionStore,
  query,
  type SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
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

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval>;
};

type ActiveRun = {
  request: ChatRequest;
  abortController: AbortController;
  subscribers: Set<Subscriber>;
};

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
    private readonly cliPath: string,
    private readonly interactions: PendingInteractions,
    private readonly requestAbortControllers: Map<string, AbortController>,
    private readonly runStore: RunStateStore,
    private readonly sessionStore: SessionStore,
  ) {}

  hasRun(runId: string): boolean {
    return this.active.has(runId) || Boolean(this.runStore.getRun(runId));
  }

  start(request: ChatRequest): string {
    if (this.hasRun(request.requestId)) {
      throw new Error("Run already exists");
    }

    const run: ActiveRun = {
      request,
      abortController: new AbortController(),
      subscribers: new Set(),
    };
    this.active.set(request.requestId, run);
    this.requestAbortControllers.set(request.requestId, run.abortController);
    this.runStore.createRun(request.requestId, request);
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
    const processedMessage = request.message.startsWith("/")
      ? request.message.substring(1)
      : request.message;
    let status: "completed" | "failed" | "aborted" = "completed";
    let errorMessage: string | undefined;

    logger.chat.debug(
      "Starting chat run {*}",
      request as unknown as Record<string, unknown>,
    );

    try {
      for await (const sdkMessage of query({
        prompt: processedMessage,
        options: {
          abortController,
          executable: "node",
          executableArgs: [],
          pathToClaudeCodeExecutable: this.cliPath,
          includePartialMessages: true,
          ...(request.newSessionId ? { sessionId: request.newSessionId } : {}),
          ...(request.sessionId ? { resume: request.sessionId } : {}),
          ...(request.allowedTools
            ? { allowedTools: request.allowedTools }
            : {}),
          ...(request.workingDirectory
            ? { cwd: request.workingDirectory }
            : {}),
          ...(request.additionalDirectories
            ? { additionalDirectories: request.additionalDirectories }
            : {}),
          ...(request.systemPrompt
            ? {
                systemPrompt: {
                  type: "preset" as const,
                  preset: "claude_code" as const,
                  append: request.systemPrompt,
                },
              }
            : {}),
          ...(request.permissionMode
            ? { permissionMode: request.permissionMode }
            : {}),
          ...(request.permissionMode === "bypassPermissions"
            ? { allowDangerouslySkipPermissions: true }
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
        },
      })) {
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
    (value.systemPrompt !== undefined &&
      (typeof value.systemPrompt !== "string" || !value.systemPrompt.trim()))
  ) {
    return null;
  }
  return value as unknown as ChatRequest;
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
