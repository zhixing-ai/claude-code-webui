import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import type {
  AskUserQuestionItem,
  AskUserQuestionOption,
  ChatRequest,
  StreamResponse,
} from "../../shared/types.ts";
import { logger } from "../utils/logger.ts";
import type { PendingInteractions } from "./interactions.ts";

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

/**
 * Handles POST /api/chat requests with streaming NDJSON responses.
 */
export async function handleChatRequest(
  c: Context,
  requestAbortControllers: Map<string, AbortController>,
  interactions: PendingInteractions,
) {
  const chatRequest: ChatRequest = await c.req.json();
  const { cliPath } = c.var.config;
  const encoder = new TextEncoder();
  let closed = false;
  let requestAbortController: AbortController | undefined;

  logger.chat.debug(
    "Received chat request {*}",
    chatRequest as unknown as Record<string, unknown>,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: StreamResponse) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(chunk)}\n`),
          );
        } catch {
          closed = true;
          requestAbortController?.abort();
        }
      };

      requestAbortController = new AbortController();
      requestAbortControllers.set(
        chatRequest.requestId,
        requestAbortController,
      );

      const processedMessage = chatRequest.message.startsWith("/")
        ? chatRequest.message.substring(1)
        : chatRequest.message;

      try {
        for await (const sdkMessage of query({
          prompt: processedMessage,
          options: {
            abortController: requestAbortController,
            executable: "node",
            executableArgs: [],
            pathToClaudeCodeExecutable: cliPath,
            ...(chatRequest.sessionId
              ? { resume: chatRequest.sessionId }
              : {}),
            ...(chatRequest.allowedTools
              ? { allowedTools: chatRequest.allowedTools }
              : {}),
            ...(chatRequest.workingDirectory
              ? { cwd: chatRequest.workingDirectory }
              : {}),
            ...(chatRequest.permissionMode
              ? { permissionMode: chatRequest.permissionMode }
              : {}),
            canUseTool: async (toolName, input) => {
              if (toolName !== "AskUserQuestion") {
                return {
                  behavior: "deny",
                  message: `Interactive approval is not supported for ${toolName}`,
                };
              }

              const questions = readQuestions(input);
              if (!questions) {
                return {
                  behavior: "deny",
                  message: "Invalid AskUserQuestion input",
                };
              }

              const pending = interactions.create(
                chatRequest.requestId,
                questions,
                requestAbortController!.signal,
              );
              send({
                type: "ask_user_question",
                interactionId: pending.interactionId,
                questions,
              });
              return pending.response;
            },
          },
        })) {
          logger.chat.debug("Claude SDK Message: {sdkMessage}", {
            sdkMessage,
          });
          send({ type: "claude_json", data: sdkMessage });
        }

        send({ type: "done" });
      } catch (error) {
        logger.chat.error("Claude Code execution failed: {error}", { error });
        send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        interactions.cancelRequest(chatRequest.requestId, "Request ended");
        requestAbortControllers.delete(chatRequest.requestId);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      requestAbortController?.abort();
      interactions.cancelRequest(chatRequest.requestId, "Request aborted");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
