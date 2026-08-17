import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Context } from "hono";
import { handleChatRequest } from "./chat";
import type { ChatRequest } from "../../shared/types";
import { getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";
import { PendingInteractions } from "./interactions";
import { MemoryRunStore } from "../state/memory";

// Define minimal mock types for Claude Code SDK to maintain type safety in tests
type MockClaudeCode = {
  createSdkMcpServer: ReturnType<typeof vi.fn>;
  getSessionMessages: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  InMemorySessionStore: new () => object;
  tool: ReturnType<typeof vi.fn>;
};

vi.mock("@anthropic-ai/claude-agent-sdk", (): MockClaudeCode => ({
  createSdkMcpServer: vi.fn((options) => ({
    type: "sdk",
    name: options.name,
    instance: {},
    tools: options.tools,
  })),
  getSessionMessages: vi.fn(),
  query: vi.fn(),
  InMemorySessionStore: class {},
  tool: vi.fn((name, description, inputSchema, handler) => ({
    name,
    description,
    inputSchema,
    handler,
  })),
}));

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: {
    chat: {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  },
}));

const mockQuery = vi.mocked(query);
const mockGetSessionMessages = vi.mocked(getSessionMessages);

describe("Chat Handler - Permission Mode Tests", () => {
  let mockContext: Context;
  let requestAbortControllers: Map<string, AbortController>;
  let interactions: PendingInteractions;

  beforeEach(() => {
    requestAbortControllers = new Map();
    interactions = new PendingInteractions();

    // Create mock context
    mockContext = {
      req: {
        json: vi.fn(),
      },
      var: {
        config: {
          cliPath: "/path/to/claude-cli",
        },
      },
    } as any;

    vi.clearAllMocks();
  });

  afterEach(() => {
    requestAbortControllers.clear();
  });

  describe("Permission Mode Parameter Handling", () => {
    it("uses the Agent SDK bundled Claude Code binary by default", async () => {
      const chatRequest: ChatRequest = {
        message: "Test bundled binary",
        requestId: "test-bundled-binary",
      };
      delete (mockContext as any).var.config.cliPath;
      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Test bundled binary",
        options: expect.not.objectContaining({
          pathToClaudeCodeExecutable: expect.anything(),
        }),
      });
    });

    it("should pass permissionMode 'plan' to Claude SDK", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-123",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      // Mock SDK to return simple message and complete
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Test message",
        options: expect.objectContaining({
          permissionMode: "plan",
          abortController: expect.any(AbortController),
          executable: "node",
          executableArgs: [],
          pathToClaudeCodeExecutable: "/path/to/claude-cli",
        }),
      });

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    });

    it("enables partial messages and forwards stream events verbatim", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-partial",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      const partial = {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hel" },
        },
        session_id: "test-session",
        parent_tool_use_id: null,
      };

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield partial as any;
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Hello" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      // Without this option the SDK only yields settled content blocks, so
      // subscribers have nothing to render progressively.
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Test message",
        options: expect.objectContaining({
          includePartialMessages: true,
        }),
      });

      // Deltas must reach subscribers unfiltered, in the same `claude_json`
      // envelope as settled messages, and ahead of them.
      const body = await new Response(response.body).text();
      const lines = body
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const claudeLines = lines.filter((line) => line.type === "claude_json");
      expect(claudeLines[0]?.data).toEqual(partial);
      expect(claudeLines[1]?.data?.type).toBe("assistant");
    });

    it("should pass permissionMode 'acceptEdits' to Claude SDK", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-456",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Test message",
        options: expect.objectContaining({
          permissionMode: "acceptEdits",
        }),
      });
    });

    it("should pass permissionMode 'default' to Claude SDK", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-789",
        permissionMode: "default",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Test message",
        options: expect.objectContaining({
          permissionMode: "default",
        }),
      });
    });

    it("should not include permissionMode in options when undefined", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-undefined",
        // permissionMode is undefined
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      const queryCall = mockQuery.mock.calls[0][0];
      expect(queryCall.options).not.toHaveProperty("permissionMode");
    });

    it("should handle permissionMode alongside other parameters", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message with all params",
        requestId: "test-all-params",
        sessionId: "session-123",
        allowedTools: ["Bash", "Edit"],
        workingDirectory: "/project/path",
        additionalDirectories: ["/system"],
        systemPrompt: "Use the tenant sales Skill for every reply.",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Test message with all params",
        options: expect.objectContaining({
          permissionMode: "plan",
          resume: "session-123",
          allowedTools: ["Bash", "Edit"],
          cwd: "/project/path",
          additionalDirectories: ["/system"],
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: "Use the tenant sales Skill for every reply.",
          },
          abortController: expect.any(AbortController),
          executable: "node",
          executableArgs: [],
          pathToClaudeCodeExecutable: "/path/to/claude-cli",
        }),
      });
      const options = mockQuery.mock.calls[0]?.[0].options;
      expect(options?.sessionStore).toBeDefined();
      expect(options?.sessionStoreFlush).toBe("eager");
      expect(options?.loadTimeoutMs).toBe(90_000);
    });

    it("uses a caller-provided UUID for a new session", async () => {
      const request: ChatRequest = {
        message: "Start",
        requestId: "new-session-run",
        newSessionId: "33333333-3333-4333-8333-333333333333",
      };
      mockContext.req.json = vi.fn().mockResolvedValue(request);
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: request.newSessionId,
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      const options = mockQuery.mock.calls[0]?.[0].options;
      expect(options?.sessionId).toBe(request.newSessionId);
      expect(options).not.toHaveProperty("resume");
    });
  });

  describe("Message Processing with Permission Mode", () => {
    it("should process slash commands with permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "/help",
        requestId: "test-slash",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Help response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      // Slash commands are SDK input and must keep their leading slash.
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "/help",
        options: expect.objectContaining({
          permissionMode: "plan",
        }),
      });
    });

    it("rewinds, compacts, and retries an oversized session without changing its ID", async () => {
      const sessionId = "33333333-3333-4333-8333-333333333333";
      const resumeSessionAt = "44444444-4444-4444-8444-444444444444";
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Continue the builder work",
        requestId: "context-limit-run",
        sessionId,
      });
      mockGetSessionMessages.mockResolvedValue([
        {
          type: "assistant",
          uuid: resumeSessionAt,
          session_id: sessionId,
          message: {
            content: [{ type: "text", text: "Previous response" }],
          },
          parent_tool_use_id: null,
          parent_agent_id: null,
        },
      ]);
      mockQuery
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              errors: [
                "API Error: 400 Invalid request: Your request exceeded model token limit 262144",
              ],
              session_id: sessionId,
            } as any;
          },
        } as any)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "system",
              subtype: "compact_boundary",
              session_id: sessionId,
            } as any;
          },
        } as any)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "Recovered response" }],
              },
              session_id: sessionId,
              parent_tool_use_id: null,
            } as any;
          },
        } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const body = await new Response(response.body).text();

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[1]?.[0]).toEqual({
        prompt: "/compact",
        options: expect.objectContaining({
          resume: sessionId,
          sessionId: undefined,
          resumeSessionAt,
        }),
      });
      expect(mockQuery.mock.calls[2]?.[0]).toEqual({
        prompt: "Continue the builder work",
        options: expect.objectContaining({
          resume: sessionId,
          sessionId: undefined,
          resumeSessionAt: undefined,
        }),
      });
      expect(body).toContain("Recovered response");
      expect(body).not.toContain("exceeded model token limit");
      expect(body).not.toContain('"type":"error"');
      expect(body).toContain('"type":"done"');
    });

    it("reports the SDK compaction error and does not retry the prompt", async () => {
      const sessionId = "33333333-3333-4333-8333-333333333333";
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Continue the builder work",
        requestId: "failed-compaction-run",
        sessionId,
      });
      mockGetSessionMessages.mockResolvedValue([
        {
          type: "assistant",
          uuid: "44444444-4444-4444-8444-444444444444",
          session_id: sessionId,
          message: { content: [{ type: "text", text: "Previous response" }] },
          parent_tool_use_id: null,
          parent_agent_id: null,
        },
      ]);
      mockQuery
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              errors: ["Prompt is too long"],
              session_id: sessionId,
            } as any;
          },
        } as any)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "system",
              subtype: "status",
              status: null,
              compact_result: "failed",
              compact_error: "Enable 1M context and retry",
              session_id: sessionId,
            } as any;
          },
        } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const body = await new Response(response.body).text();

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(body).toContain("Enable 1M context and retry");
      expect(body).not.toContain('"type":"done"');
    });

    it("rewinds farther when the first compaction attempt is still too long", async () => {
      const sessionId = "33333333-3333-4333-8333-333333333333";
      const olderAnchor = "44444444-4444-4444-8444-444444444444";
      const recentAnchor = "55555555-5555-4555-8555-555555555555";
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Continue the builder work",
        requestId: "progressive-compaction-run",
        sessionId,
      });
      mockGetSessionMessages.mockResolvedValue(
        [olderAnchor, recentAnchor].map((uuid) => ({
          type: "assistant" as const,
          uuid,
          session_id: sessionId,
          message: { content: [{ type: "text", text: "Previous response" }] },
          parent_tool_use_id: null,
          parent_agent_id: null,
        })),
      );
      mockQuery
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              errors: ["Prompt is too long"],
              session_id: sessionId,
            } as any;
          },
        } as any)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              errors: ["Error during compaction: Conversation too long"],
              session_id: sessionId,
            } as any;
          },
        } as any)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "system",
              subtype: "compact_boundary",
              session_id: sessionId,
            } as any;
          },
        } as any)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "assistant",
              message: { content: [{ type: "text", text: "Recovered" }] },
              session_id: sessionId,
              parent_tool_use_id: null,
            } as any;
          },
        } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const body = await new Response(response.body).text();

      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery.mock.calls[1]?.[0].options?.resumeSessionAt).toBe(
        recentAnchor,
      );
      expect(mockQuery.mock.calls[2]?.[0].options?.resumeSessionAt).toBe(
        olderAnchor,
      );
      expect(body).toContain("Recovered");
      expect(body).toContain('"type":"done"');
    });

    it("does not replay a prompt after the run has produced output", async () => {
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Continue the builder work",
        requestId: "partially-completed-run",
        sessionId: "33333333-3333-4333-8333-333333333333",
      });
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Work started" }] },
            session_id: "33333333-3333-4333-8333-333333333333",
            parent_tool_use_id: null,
          } as any;
          throw new Error("Prompt is too long");
        },
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const body = await new Response(response.body).text();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(body).toContain("automatic retry was skipped");
      expect(body).not.toContain('"type":"done"');
    });

    it("should handle regular messages with permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "Regular message",
        requestId: "test-regular",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Regular response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Regular message",
        options: expect.objectContaining({
          permissionMode: "acceptEdits",
        }),
      });
    });
  });

  describe("Stream Response Generation", () => {
    it("should yield SDK messages with permissionMode context", async () => {
      const chatRequest: ChatRequest = {
        message: "Test streaming",
        requestId: "test-stream",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      const mockMessages = [
        {
          type: "system",
          subtype: "init",
          cwd: "/test",
          tools: [],
          session_id: "test",
          apiKeySource: "env",
          mcp_servers: {},
          model: "test",
          is_resuming: false,
        } as any,
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Streaming response" }] },
          session_id: "test",
          parent_tool_use_id: null,
        } as any,
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 10, output_tokens: 5 },
          session_id: "test",
        } as any,
      ];

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const message of mockMessages) {
            yield message;
          }
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let allChunks = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks += decoder.decode(value);
      }

      const lines = allChunks.trim().split("\n");
      expect(lines).toHaveLength(4); // 3 SDK messages + 1 done message

      // Parse each line to verify structure
      const parsedLines = lines.map((line) => JSON.parse(line));

      expect(parsedLines[0]).toMatchObject({
        type: "claude_json",
        data: mockMessages[0],
      });

      expect(parsedLines[1]).toMatchObject({
        type: "claude_json",
        data: mockMessages[1],
      });

      expect(parsedLines[2]).toMatchObject({
        type: "claude_json",
        data: mockMessages[2],
      });

      expect(parsedLines[3]).toMatchObject({
        type: "done",
      });
    });
  });

  describe("Error Handling with Permission Mode", () => {
    it("should handle SDK errors when using permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "Error test",
        requestId: "test-error",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error("SDK execution failed");
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let allChunks = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks += decoder.decode(value);
      }

      const lines = allChunks.trim().split("\n");
      expect(lines).toHaveLength(1);

      const errorResponse = JSON.parse(lines[0]);
      expect(errorResponse).toMatchObject({
        type: "error",
        error: "SDK execution failed",
      });
    });

    // TODO: Re-enable when AbortError is properly exported from Claude SDK
    it.skip("should handle abort errors when using permissionMode", async () => {
      // Test currently skipped because AbortError is not exported from Claude SDK
      // When AbortError becomes available, update this test accordingly
      const chatRequest: ChatRequest = {
        message: "Abort test",
        requestId: "test-abort",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error("Operation aborted");
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let allChunks = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks += decoder.decode(value);
      }

      const lines = allChunks.trim().split("\n");
      expect(lines).toHaveLength(1);

      const errorResponse = JSON.parse(lines[0]);
      expect(errorResponse).toEqual({
        type: "error",
        error: "Operation aborted",
      });
    });
  });

  describe("Abort Controller Management with Permission Mode", () => {
    it("should manage abort controller correctly with permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "Controller test",
        requestId: "test-controller",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      expect(requestAbortControllers.size).toBe(0);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      // Read the response to ensure the generator completes
      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // Controller should be cleaned up after completion
      expect(requestAbortControllers.size).toBe(0);
    });

    it("should store and retrieve abort controller during execution", async () => {
      const chatRequest: ChatRequest = {
        message: "Controller tracking",
        requestId: "test-tracking",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      let capturedController: AbortController | null = null;

      mockQuery.mockImplementation(
        (args: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              capturedController = args.options.abortController;
              expect(requestAbortControllers.has("test-tracking")).toBe(true);
              yield {
                type: "assistant",
                message: { content: [{ type: "text", text: "Response" }] },
                session_id: "test-session",
                parent_tool_use_id: null,
              } as any;
            },
            interrupt: vi.fn(),
            next: vi.fn(),
            return: vi.fn(),
            throw: vi.fn(),
          }) as any,
      );

      await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );

      expect(capturedController).toBeInstanceOf(AbortController);
    });
  });

  describe("AskUserQuestion interactions", () => {
    const questions = [
      {
        question: "Which format?",
        header: "Format",
        options: [
          { label: "Short", description: "Summary" },
          { label: "Long", description: "Details" },
        ],
        multiSelect: false,
      },
    ];

    it("emits a question and resumes the same stream with submitted answers", async () => {
      let permissionResult: unknown;
      mockQuery.mockImplementation(
        ({ options }: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              permissionResult = await options.canUseTool(
                "AskUserQuestion",
                { questions },
                {
                  signal: options.abortController.signal,
                  toolUseID: "tool-1",
                  requestId: "control-1",
                },
              );
              yield {
                type: "result",
                subtype: "success",
                session_id: "session-1",
              } as any;
            },
          }) as any,
      );
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Ask me",
        requestId: "request-1",
        runMode: "builder",
        permissionMode: "default",
      });

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const reader = response.body!.getReader();
      const firstRead = await reader.read();
      const first = JSON.parse(
        new TextDecoder().decode(firstRead.value).trim(),
      );

      expect(first).toMatchObject({
        type: "ask_user_question",
        questions: [{ question: "Which format?" }],
      });
      expect(
        interactions.respond(first.interactionId, {
          answers: { "Which format?": "Short" },
        }),
      ).toBe("ok");

      while (!(await reader.read()).done) {
        // Drain the original stream after the callback resumes.
      }
      expect(permissionResult).toEqual({
        behavior: "allow",
        updatedInput: {
          questions,
          answers: { "Which format?": "Short" },
        },
      });
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: "Ask me",
        options: expect.objectContaining({
          permissionMode: "default",
          canUseTool: expect.any(Function),
          hooks: expect.objectContaining({
            PreToolUse: expect.any(Array),
          }),
        }),
      });
      const hook =
        mockQuery.mock.calls[0]?.[0].options?.hooks?.PreToolUse?.[0]
          ?.hooks?.[0];
      await expect(
        hook?.(
          {
            hook_event_name: "PreToolUse",
            tool_name: "AskUserQuestion",
            tool_input: { questions },
            tool_use_id: "tool-1",
          } as any,
          "tool-1",
          {} as any,
        ),
      ).resolves.toEqual({});
    });

    it("emits a tool permission and resumes the same stream after approval", async () => {
      let permissionResult: unknown;
      const suggestions = [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "pwd" }],
          behavior: "allow",
          destination: "session",
        },
      ];
      mockQuery.mockImplementation(
        ({ options }: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              permissionResult = await options.canUseTool(
                "Bash",
                { command: "pwd" },
                {
                  signal: options.abortController.signal,
                  toolUseID: "tool-1",
                  requestId: "control-1",
                  suggestions,
                  title: "Claude wants to run pwd",
                  displayName: "Run command",
                  description: "Runs pwd in the project directory",
                },
              );
              yield {
                type: "result",
                subtype: "success",
                session_id: "session-1",
              } as any;
            },
          }) as any,
      );
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Run pwd",
        requestId: "request-1",
      });

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const reader = response.body!.getReader();
      const firstRead = await reader.read();
      const first = JSON.parse(
        new TextDecoder().decode(firstRead.value).trim(),
      );

      expect(first).toMatchObject({
        type: "tool_permission",
        toolName: "Bash",
        input: { command: "pwd" },
        toolUseId: "tool-1",
        title: "Claude wants to run pwd",
        displayName: "Run command",
        description: "Runs pwd in the project directory",
        canRemember: true,
      });
      expect(
        interactions.respond(first.interactionId, {
          permission: "allow",
          remember: true,
        }),
      ).toBe("ok");

      while (!(await reader.read()).done) {
        // Drain the original stream after the callback resumes.
      }
      expect(permissionResult).toEqual({
        behavior: "allow",
        updatedInput: { command: "pwd" },
        updatedPermissions: suggestions,
      });
    });

    it("auto-allows ordinary tools in managed product runs before permission callbacks", async () => {
      let permissionResult: unknown;
      mockQuery.mockImplementation(
        ({ options }: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              permissionResult = await options.hooks.PreToolUse[0].hooks[0](
                {
                  hook_event_name: "PreToolUse",
                  tool_name: "Edit",
                  tool_input: { file_path: "SKILL.md" },
                  tool_use_id: "tool-1",
                },
                "tool-1",
                { signal: options.abortController.signal },
              );
              yield {
                type: "result",
                subtype: "success",
                session_id: "session-1",
              } as any;
            },
          }) as any,
      );
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Edit the skill",
        requestId: "request-1",
        runMode: "builder",
        permissionMode: "bypassPermissions",
        allowedTools: ["AskUserQuestion", "AskUserQuestion(*)", "Read"],
      });

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      await response.text();

      expect(permissionResult).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason:
            "SalesAI product runs auto-approve ordinary tools",
        },
      });
      expect(mockQuery.mock.calls[0]?.[0].options).toMatchObject({
        permissionMode: "default",
        allowedTools: ["Read"],
      });
      expect(
        mockQuery.mock.calls[0]?.[0].options?.allowDangerouslySkipPermissions,
      ).toBeUndefined();

      const options = mockQuery.mock.calls[0]?.[0].options;
      if (!options?.canUseTool || !options.abortController) {
        throw new Error("Expected managed run permission callbacks");
      }
      const hook = options?.hooks?.PreToolUse?.[0]?.hooks?.[0];
      for (const toolName of [
        "Agent",
        "Task",
        "TaskOutput",
        "StructuredOutput",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Skill",
        "Glob",
        "Grep",
      ]) {
        await expect(
          hook?.(
            {
              hook_event_name: "PreToolUse",
              tool_name: toolName,
              tool_input: { value: toolName },
              tool_use_id: `tool-${toolName}`,
            } as any,
            `tool-${toolName}`,
            {} as any,
          ),
        ).resolves.toMatchObject({
          hookSpecificOutput: { permissionDecision: "allow" },
        });
        await expect(
          options?.canUseTool(
            toolName,
            { value: toolName },
            {
              signal: options.abortController.signal,
              toolUseID: `tool-${toolName}`,
              requestId: `request-${toolName}`,
            },
          ),
        ).resolves.toEqual({
          behavior: "allow",
          updatedInput: { value: toolName },
        });
      }

      await expect(
        hook?.(
          {
            hook_event_name: "PreToolUse",
            tool_name: "AskUserQuestion",
            tool_input: { questions: [] },
            tool_use_id: "tool-ask",
          } as any,
          "tool-ask",
          {} as any,
        ),
      ).resolves.toEqual({});
    });

    it("denies invalid AskUserQuestion input", async () => {
      let permissionResult: unknown;
      mockQuery.mockImplementation(
        ({ options }: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              permissionResult = await options.canUseTool(
                "AskUserQuestion",
                { questions: [] },
                {
                  signal: options.abortController.signal,
                  toolUseID: "tool-1",
                  requestId: "control-1",
                },
              );
            },
          }) as any,
      );
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Ask me",
        requestId: "request-1",
      });

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      await response.text();

      expect(permissionResult).toEqual({
        behavior: "deny",
        message: "Invalid AskUserQuestion input",
      });
    });

    it("keeps a pending question alive when the browser disconnects", async () => {
      mockQuery.mockImplementation(
        ({ options }: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              await options.canUseTool(
                "AskUserQuestion",
                { questions },
                {
                  signal: options.abortController.signal,
                  toolUseID: "tool-1",
                  requestId: "control-1",
                },
              );
            },
          }) as any,
      );
      mockContext.req.json = vi.fn().mockResolvedValue({
        message: "Ask me",
        requestId: "request-1",
      });

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
        interactions,
      );
      const reader = response.body!.getReader();
      const firstRead = await reader.read();
      const first = JSON.parse(
        new TextDecoder().decode(firstRead.value).trim(),
      );
      expect(first.type).toBe("ask_user_question");

      await reader.cancel();

      expect(
        interactions.respond(first.interactionId, { cancelled: true }),
      ).toBe("ok");
    });
  });
});

describe("Chat Handler - Simulation workflow", () => {
  it("turns an ordinary simulation request into the restricted workflow", async () => {
    vi.clearAllMocks();
    const scenario = {
      id: "negotiation",
      title: "讨价还价",
      stage: "成交",
      description: "成交前争取权益",
      persona: "关注总价的客户",
      objective: "守住边界并推进成交",
      cases: [
        {
          id: "discount",
          title: "要求折扣",
          customerGoal: "获得折扣",
          openingMessage: "能优惠吗？",
          expectedBehaviors: ["确认诉求"],
          passCriteria: ["不越权"],
        },
      ],
    };
    const result = {
      scenarioId: scenario.id,
      summary: "完成",
      cases: [
        {
          caseId: "discount",
          verdict: "passed",
          score: 90,
          transcript: [
            { role: "customer", content: "能优惠吗？" },
            { role: "sales", content: "我先确认可用权益。" },
          ],
          evaluation: "没有越权",
          strengths: ["边界清楚"],
          issues: [],
        },
      ],
    };
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "builder-session",
        } as any;
        yield {
          type: "result",
          subtype: "success",
          structured_output: { scenarios: [scenario], results: [result] },
          session_id: "builder-session",
        } as any;
      },
    } as any);
    const runStore = new MemoryRunStore();
    const context = {
      req: {
        json: vi.fn().mockResolvedValue({
          message: "接下来我们直接生成模拟测试的场景，case并开始测试吧。",
          requestId: "natural-simulation-run",
        }),
      },
      var: {
        config: { fdeSuitePluginDir: "/opt/fde-suite", runStore },
      },
    } as unknown as Context;

    const response = await handleChatRequest(
      context,
      new Map<string, AbortController>(),
      new PendingInteractions(),
    );
    const body = await response.text();
    const options = mockQuery.mock.calls[0]?.[0].options;

    expect(options?.agent).toBe("fde-suite:fde-builder");
    expect(options?.allowedTools).toContain(
      "mcp__webui__publish_simulation_state",
    );
    expect(options?.tools).toEqual([
      "Task",
      "Agent",
      "TaskOutput",
      "TaskStop",
      "StructuredOutput",
      "AskUserQuestion",
      "Read",
      "Glob",
      "Grep",
    ]);
    expect(options?.tools).not.toContain("Bash");
    expect(options?.tools).not.toContain("Skill");
    expect(options?.outputFormat).toMatchObject({
      type: "json_schema",
      schema: { required: ["scenarios", "results"] },
    });
    expect(options?.systemPrompt).toMatchObject({
      append: expect.stringContaining("fde-suite:fde-scenario-designer"),
    });
    expect(body).toContain('"kind":"design_started"');
    expect(body).toContain('"kind":"scenarios_generated"');
    expect(body).toContain('"kind":"simulation_batch_completed"');
    expect(body).toContain('"type":"done"');
    expect(
      runStore.getRun("natural-simulation-run")?.request.simulation,
    ).toEqual({
      action: "orchestrate",
      startsWith: "design",
      runAfterDesign: true,
    });
  });

  it("fails the run when an inferred workflow reports only that design started", async () => {
    vi.clearAllMocks();
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "incomplete-session",
        } as any;
      },
    } as any);
    const context = {
      req: {
        json: vi.fn().mockResolvedValue({
          message: "生成模拟测试场景并开始测试",
          requestId: "incomplete-simulation-run",
        }),
      },
      var: { config: { fdeSuitePluginDir: "/opt/fde-suite" } },
    } as unknown as Context;

    const response = await handleChatRequest(
      context,
      new Map<string, AbortController>(),
      new PendingInteractions(),
    );
    const body = await response.text();

    expect(body).toContain('"kind":"simulation_failed"');
    expect(body).toContain("Agent 未上报生成的模拟测试场景");
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('"type":"done"');
    expect(mockQuery.mock.calls[0]?.[0].options?.hooks).toBeUndefined();
  });

  it("loads the plugin without the builder agent in sandbox test mode", async () => {
    vi.clearAllMocks();
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sandbox-session",
          plugins: [
            {
              name: "fde-suite",
              path: "/Users/shaobo/Workspace/zhixing/fde-suite",
            },
          ],
        } as any;
      },
    } as any);
    const context = {
      req: {
        json: vi.fn().mockResolvedValue({
          message: "你好",
          requestId: "sandbox-run",
          runMode: "sandbox_test",
          // Product mode is authoritative: even an obsolete or malformed
          // caller preference must not re-enable approval cards.
          permissionMode: "default",
        }),
      },
      var: {
        config: {
          fdeSuitePluginDir: "/Users/shaobo/Workspace/zhixing/fde-suite",
        },
      },
    } as unknown as Context;

    const response = await handleChatRequest(
      context,
      new Map<string, AbortController>(),
      new PendingInteractions(),
    );
    await response.text();

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "你好",
      options: expect.objectContaining({
        plugins: [
          {
            type: "local",
            path: "/Users/shaobo/Workspace/zhixing/fde-suite",
          },
        ],
      }),
    });
    expect(mockQuery.mock.calls[0]?.[0].options?.agent).toBeUndefined();
    expect(mockQuery.mock.calls[0]?.[0].options).toMatchObject({
      permissionMode: "default",
    });
    expect(
      mockQuery.mock.calls[0]?.[0].options?.allowDangerouslySkipPermissions,
    ).toBeUndefined();
    const sandboxHook =
      mockQuery.mock.calls[0]?.[0].options?.hooks?.PreToolUse?.[0]?.hooks?.[0];
    await expect(
      sandboxHook?.(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path: "draft.md", content: "draft" },
          tool_use_id: "tool-write",
        } as any,
        "tool-write",
        {} as any,
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
  });

  it("adds the workflow prompt and emits structured simulation events", async () => {
    vi.clearAllMocks();
    const scenario = {
      id: "negotiation",
      title: "讨价还价",
      stage: "成交",
      description: "成交前争取权益",
      persona: "关注总价的客户",
      objective: "守住边界并推进成交",
      cases: [
        {
          id: "discount",
          title: "要求折扣",
          customerGoal: "获得折扣",
          openingMessage: "能优惠吗？",
          expectedBehaviors: ["确认诉求"],
          passCriteria: ["不越权"],
        },
      ],
    };
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "simulation-session",
          plugins: [
            {
              name: "fde-suite",
              path: "/Users/shaobo/Workspace/zhixing/fde-suite",
            },
          ],
          agents: [
            "fde-suite:fde-builder",
            "fde-suite:fde-scenario-designer",
            "fde-suite:fde-evaluator",
          ],
        } as any;
        yield {
          type: "result",
          subtype: "success",
          structured_output: { scenarios: [scenario] },
          session_id: "simulation-session",
        } as any;
      },
    } as any);
    const context = {
      req: {
        json: vi.fn().mockResolvedValue({
          message: "生成模拟测试场景",
          requestId: "simulation-run",
          runMode: "builder",
          simulation: { action: "design" },
        }),
      },
      var: {
        config: {
          cliPath: "/path/to/claude-cli",
          fdeSuitePluginDir: "/Users/shaobo/Workspace/zhixing/fde-suite",
        },
      },
    } as unknown as Context;

    const response = await handleChatRequest(
      context,
      new Map<string, AbortController>(),
      new PendingInteractions(),
    );
    const body = await new Response(response.body).text();

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "生成模拟测试场景",
      options: expect.objectContaining({
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
        plugins: [
          {
            type: "local",
            path: "/Users/shaobo/Workspace/zhixing/fde-suite",
          },
        ],
        outputFormat: expect.objectContaining({ type: "json_schema" }),
        systemPrompt: expect.objectContaining({
          append: expect.stringContaining("fde-scenario-designer"),
        }),
      }),
    });
    expect(body).toContain('"type":"simulation_event"');
    expect(body).toContain('"kind":"scenarios_generated"');
    const options = mockQuery.mock.calls[0]?.[0].options;
    if (!options) throw new Error("Expected query options");
    expect(options.agent).toBe("fde-suite:fde-builder");
    expect(options.allowedTools).toContain(
      "mcp__webui__publish_simulation_state",
    );
    expect(options.mcpServers).toHaveProperty("webui");
    expect(options).toMatchObject({
      permissionMode: "default",
    });
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    const simulationHook = options.hooks?.PreToolUse?.[0]?.hooks?.[0];
    await expect(
      simulationHook?.(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: { description: "Design scenarios" },
          tool_use_id: "tool-agent",
        } as any,
        "tool-agent",
        {} as any,
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    await expect(
      simulationHook?.(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: "merchant.md" },
          tool_use_id: "tool-read",
        } as any,
        "tool-read",
        {} as any,
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    await expect(
      simulationHook?.(
        {
          hook_event_name: "PreToolUse",
          tool_name: "AskUserQuestion",
          tool_input: { questions: [] },
          tool_use_id: "tool-ask",
        } as any,
        "tool-ask",
        {} as any,
      ),
    ).resolves.toEqual({});
  });
});
