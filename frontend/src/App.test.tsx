import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProjectSelector } from "./components/ProjectSelector";
import { ChatPage } from "./components/ChatPage";
import { SettingsProvider } from "./contexts/SettingsContext";

// Mock fetch globally
global.fetch = vi.fn();

describe("App Routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock projects API response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders project selection page at root path", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ProjectSelector />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Select a Project")).toBeInTheDocument();
      expect(screen.getByText("Start a new project")).toBeInTheDocument();
      expect(
        screen.getByText("No projects yet. Create one above to start working."),
      ).toBeInTheDocument();
    });
  });

  it("creates a project and opens its workspace", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                project: {
                  path: "/home/sandbox/new-project",
                  encodedName: "-home-sandbox-new-project",
                },
              }),
              {
                status: 201,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ projects: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ProjectSelector />} />
          <Route
            path="/projects/*"
            element={<div>New project workspace</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Project directory"), {
      target: { value: "new-project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(
      await screen.findByText("New project workspace"),
    ).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall![1].body)).toEqual({ path: "new-project" });
  });

  it("renders chat page when navigating to projects path", async () => {
    await act(async () => {
      render(
        <SettingsProvider>
          <MemoryRouter initialEntries={["/projects/test-path"]}>
            <Routes>
              <Route path="/projects/*" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </SettingsProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Claude Code Web UI")).toBeInTheDocument();
      expect(screen.getByText("/test-path")).toBeInTheDocument();
    });
  });

  it("answers a streamed AskUserQuestion through the interaction endpoint", async () => {
    let chatController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return Promise.resolve(
          new Response(JSON.stringify({ projects: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/chat") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            chatController = controller;
            const event = JSON.stringify({
              type: "ask_user_question",
              interactionId: "interaction-1",
              questions: [
                {
                  question: "Which format?",
                  header: "Format",
                  options: [
                    { label: "Short", description: "Summary" },
                    { label: "Long", description: "Details" },
                  ],
                  multiSelect: false,
                },
              ],
            });
            controller.enqueue(new TextEncoder().encode(event.slice(0, 40)));
            controller.enqueue(
              new TextEncoder().encode(`${event.slice(40)}\n`),
            );
          },
        });
        return Promise.resolve(new Response(stream));
      }
      if (url === "/api/interactions/interaction-1/respond") {
        chatController?.enqueue(
          new TextEncoder().encode(`${JSON.stringify({ type: "done" })}\n`),
        );
        chatController?.close();
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "Ask me a question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Claude needs your input"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Short"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => {
      const responseCall = fetchMock.mock.calls.find(
        ([url]) => String(url) === "/api/interactions/interaction-1/respond",
      );
      expect(responseCall).toBeDefined();
      expect(JSON.parse(responseCall![1].body)).toEqual({
        answers: { "Which format?": "Short" },
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Claude needs your input"),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders a complete simulation lifecycle triggered from the main chat", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    let chatBody: Record<string, unknown> | undefined;
    const scenario = {
      id: "negotiation",
      title: "讨价还价",
      stage: "成交",
      description: "成交前争取权益",
      persona: "关注总价的客户",
      objective: "守住边界",
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
      summary: "边界稳定",
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

    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects") {
          return Promise.resolve(
            new Response(JSON.stringify({ projects: [] }), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url === "/api/sessions?directory=%2Ftest-path") {
          return Promise.resolve(
            new Response(JSON.stringify({ sessions: [] }), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url === "/api/chat") {
          chatBody = JSON.parse(String(init?.body));
          const events = [
            {
              type: "simulation_event",
              event: { kind: "design_started", runAfterDesign: true },
            },
            {
              type: "simulation_event",
              event: { kind: "scenarios_generated", scenarios: [scenario] },
            },
            {
              type: "simulation_event",
              event: { kind: "run_started", scenarioIds: [scenario.id] },
            },
            {
              type: "simulation_event",
              event: { kind: "simulation_completed", result },
            },
            { type: "done" },
          ];
          return Promise.resolve(
            new Response(
              `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
            ),
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /模拟测试/ }));
    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "重新生成模拟测试场景，并开始测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("讨价还价")).toBeInTheDocument();
    expect(await screen.findByText("1 / 1 已模拟")).toBeInTheDocument();
    expect(chatBody).toMatchObject({
      message: "重新生成模拟测试场景，并开始测试",
      workingDirectory: "/test-path",
    });
    expect(chatBody).not.toHaveProperty("simulation");
  });

  it("fails closed when a simulation stream ends after only a start event", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return Promise.resolve(
          new Response(JSON.stringify({ projects: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/sessions?directory=%2Ftest-path") {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/chat") {
        return Promise.resolve(
          new Response(
            `${JSON.stringify({
              type: "simulation_event",
              event: { kind: "design_started", runAfterDesign: true },
            })}\n${JSON.stringify({ type: "done" })}\n`,
          ),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /模拟测试/ }));
    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "重新生成模拟测试场景，并开始测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText(
        "Agent 已结束，但没有返回有效的结构化结果，请重试。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("正在设计测试场景")).not.toBeInTheDocument();
  });

  it("restores simulation scenarios and results from persisted session history", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const scenario = {
      id: "history-negotiation",
      title: "历史讨价还价",
      stage: "成交",
      description: "从 PG 会话记录恢复",
      persona: "关注价格的客户",
      objective: "守住价格边界",
      cases: [
        {
          id: "history-discount",
          title: "历史折扣题",
          customerGoal: "争取折扣",
          openingMessage: "还能便宜吗？",
          expectedBehaviors: ["确认诉求"],
          passCriteria: ["不越权承诺"],
        },
      ],
    };
    const result = {
      scenarioId: scenario.id,
      summary: "历史结果已恢复",
      cases: [
        {
          caseId: "history-discount",
          verdict: "passed",
          score: 92,
          transcript: [
            { role: "customer", content: "还能便宜吗？" },
            { role: "sales", content: "我先确认当前可用权益。" },
          ],
          evaluation: "没有越权",
          strengths: ["边界清楚"],
          issues: [],
        },
      ],
    };
    const timestamp = "2026-08-17T02:00:00.000Z";

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return Promise.resolve(
          new Response(JSON.stringify({ projects: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/sessions?directory=%2Ftest-path") {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (
        url === "/api/sessions/history-session/messages?directory=%2Ftest-path"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: "history-session",
              messages: [
                {
                  type: "assistant",
                  timestamp,
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "tool_use",
                        id: "structured-history",
                        name: "StructuredOutput",
                        input: { scenarios: [scenario], results: [result] },
                      },
                    ],
                  },
                  parent_tool_use_id: null,
                  session_id: "history-session",
                  uuid: "assistant-history",
                },
                {
                  type: "user",
                  timestamp,
                  message: {
                    role: "user",
                    content: [
                      {
                        type: "tool_result",
                        tool_use_id: "structured-history",
                        content: "Structured output provided successfully",
                        is_error: false,
                      },
                    ],
                  },
                  parent_tool_use_id: null,
                  session_id: "history-session",
                  uuid: "user-history",
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <SettingsProvider>
        <MemoryRouter
          initialEntries={["/projects/test-path?sessionId=history-session"]}
        >
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(await screen.findByRole("button", {
      name: /模拟测试/,
    }));
    expect(await screen.findByText("历史讨价还价")).toBeInTheDocument();
    expect(await screen.findByText("1 / 1 已模拟")).toBeInTheDocument();
  });

  it("reconnects to a run when the original stream ends early", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    let runId = "";
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects") {
          return Promise.resolve(
            new Response(JSON.stringify({ projects: [] }), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url === "/api/chat") {
          runId = JSON.parse(String(init?.body)).requestId;
          return Promise.resolve(
            new Response(
              `${JSON.stringify({
                type: "heartbeat",
                runId,
                sequence: 1,
              })}\n`,
            ),
          );
        }
        if (url === `/api/runs/${runId}/events?after=1`) {
          return Promise.resolve(
            new Response(
              `${JSON.stringify({
                type: "done",
                runId,
                sequence: 2,
              })}\n`,
            ),
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "Keep running" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url) === `/api/runs/${runId}/events?after=1`,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Error: Failed to get response"),
      ).not.toBeInTheDocument(),
    );
  });

  it("resumes queued tool permissions without starting another chat request", async () => {
    let chatController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return Promise.resolve(
          new Response(JSON.stringify({ projects: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/chat") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            chatController = controller;
            controller.enqueue(
              new TextEncoder().encode(
                `${JSON.stringify({
                  type: "tool_permission",
                  interactionId: "permission-1",
                  toolName: "Bash",
                  input: { command: "npm test" },
                  toolUseId: "tool-1",
                  title: "Claude wants to run npm test",
                  description: "Runs the project test suite",
                  canRemember: true,
                })}\n`,
              ),
            );
          },
        });
        return Promise.resolve(new Response(stream));
      }
      if (url === "/api/interactions/permission-1/respond") {
        chatController?.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              type: "tool_permission",
              interactionId: "plan-1",
              toolName: "ExitPlanMode",
              input: {},
              toolUseId: "tool-2",
              canRemember: false,
            })}\n`,
          ),
        );
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/interactions/plan-1/respond") {
        chatController?.enqueue(
          new TextEncoder().encode(`${JSON.stringify({ type: "done" })}\n`),
        );
        chatController?.close();
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "Run the tests" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Claude wants to run npm test"),
    ).toBeInTheDocument();
    expect(screen.getByText("Runs the project test suite")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => {
      const responseCall = fetchMock.mock.calls.find(
        ([url]) => String(url) === "/api/interactions/permission-1/respond",
      );
      expect(responseCall).toBeDefined();
      expect(JSON.parse(responseCall![1].body)).toEqual({
        permission: "allow",
      });
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Yes, and auto-accept edits",
      }),
    );
    await waitFor(() => {
      const responseCall = fetchMock.mock.calls.find(
        ([url]) => String(url) === "/api/interactions/plan-1/respond",
      );
      expect(responseCall).toBeDefined();
      expect(JSON.parse(responseCall![1].body)).toEqual({
        permission: "allow",
        mode: "acceptEdits",
      });
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/chat"),
    ).toHaveLength(1);
  });

  it("lists project conversations, resumes one, and starts a fresh conversation", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const chatBodies: Array<Record<string, unknown>> = [];

    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                projects: [{ path: "/test-path", encodedName: "-test-path" }],
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url === "/api/sessions?directory=%2Ftest-path") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sessions: [
                  {
                    sessionId: "session-123",
                    summary: "Continue cloud work",
                    lastModified: new Date(
                      "2026-07-27T08:05:00.000Z",
                    ).getTime(),
                  },
                ],
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (
          url === "/api/sessions/session-123/messages?directory=%2Ftest-path"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sessionId: "session-123",
                messages: [],
                metadata: {
                  startTime: "2026-07-27T08:00:00.000Z",
                  endTime: "2026-07-27T08:05:00.000Z",
                  messageCount: 0,
                },
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url === "/api/chat") {
          chatBodies.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            new Response(`${JSON.stringify({ type: "done" })}\n`),
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle conversation list" }),
    );
    fireEvent.click(await screen.findByText("Continue cloud work"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url) ===
            "/api/sessions/session-123/messages?directory=%2Ftest-path",
        ),
      ).toBe(true),
    );

    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "Continue this session" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(chatBodies[0]).toMatchObject({ sessionId: "session-123" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle conversation list" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "New conversation" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Type message..."), {
      target: { value: "Start fresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(chatBodies).toHaveLength(2));
    expect(chatBodies[1]).not.toHaveProperty("sessionId");
  });

  it("replays and reconnects an active run after a browser refresh", async () => {
    const activeRunKey = "claude-code-webui-active-run:/test-path";
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) =>
      key === activeRunKey ? JSON.stringify({ runId: "run-refresh" }) : null,
    );
    const removeItem = vi.spyOn(window.localStorage, "removeItem");
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return Promise.resolve(
          new Response(JSON.stringify({ projects: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/sessions?directory=%2Ftest-path") {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/api/sessions/session-refresh/messages?")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ sessionId: "session-refresh", messages: [] }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/runs/run-refresh") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "run-refresh",
              request: {
                message: "Build a dashboard",
                requestId: "run-refresh",
                workingDirectory: "/test-path",
              },
              sessionId: "session-refresh",
              status: "running",
              createdAt: "2026-07-27T08:00:00.000Z",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/runs/run-refresh/events?after=0") {
        const events = [
          {
            type: "claude_json",
            runId: "run-refresh",
            sequence: 1,
            data: {
              type: "system",
              subtype: "init",
              apiKeySource: "user",
              cwd: "/test-path",
              session_id: "session-refresh",
              uuid: "system-refresh",
              tools: [],
              mcp_servers: [],
              model: "claude-sonnet",
              permissionMode: "default",
              slash_commands: [],
              output_style: "default",
            },
          },
          {
            type: "claude_json",
            runId: "run-refresh",
            sequence: 2,
            data: {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "Recovered output" }],
              },
              parent_tool_use_id: null,
              session_id: "session-refresh",
              uuid: "assistant-refresh",
            },
          },
          {
            type: "done",
            runId: "run-refresh",
            sequence: 3,
          },
        ];
        return Promise.resolve(
          new Response(
            `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
          ),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={["/projects/test-path"]}>
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    expect(await screen.findByText("Build a dashboard")).toBeInTheDocument();
    expect(await screen.findByText("Recovered output")).toBeInTheDocument();
    await waitFor(() => expect(removeItem).toHaveBeenCalledWith(activeRunKey));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith("/api/sessions/session-refresh/messages?"),
        ),
      ).toBe(true),
    );
  });

  it("replays a simulation run after refresh without submitting the prompt again", async () => {
    const activeRunKey = "claude-code-webui-active-run:/test-path";
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) =>
      key === activeRunKey ? JSON.stringify({ runId: "run-simulation" }) : null,
    );
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const scenario = {
      id: "refresh-scenario",
      title: "刷新后仍在的场景",
      stage: "售前咨询",
      description: "验证活动 Run 的事件重放",
      persona: "首次咨询的客户",
      objective: "回答客户问题",
      cases: [
        {
          id: "refresh-case",
          title: "刷新恢复题",
          customerGoal: "确认产品是否合适",
          openingMessage: "这个适合我吗？",
          expectedBehaviors: ["先确认需求"],
          passCriteria: ["不虚构承诺"],
        },
      ],
    };
    const result = {
      scenarioId: scenario.id,
      summary: "刷新后结果完整",
      cases: [
        {
          caseId: "refresh-case",
          verdict: "passed",
          score: 90,
          transcript: [
            { role: "customer", content: "这个适合我吗？" },
            { role: "sales", content: "我先了解一下您的具体需求。" },
          ],
          evaluation: "先澄清再回答",
          strengths: ["没有乱承诺"],
          issues: [],
        },
      ],
    };

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions?directory=%2Ftest-path") {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/api/sessions/session-simulation/messages?")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: "session-simulation",
              messages: [],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/runs/run-simulation") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "run-simulation",
              request: {
                message: "重新生成模拟测试场景，并开始测试",
                requestId: "run-simulation",
                workingDirectory: "/test-path",
                simulation: {
                  action: "orchestrate",
                  startsWith: "design",
                  runAfterDesign: true,
                },
              },
              sessionId: "session-simulation",
              status: "running",
              createdAt: "2026-08-17T02:00:00.000Z",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/runs/run-simulation/events?after=0") {
        const events = [
          {
            type: "simulation_event",
            runId: "run-simulation",
            sequence: 1,
            event: { kind: "design_started", runAfterDesign: true },
          },
          {
            type: "simulation_event",
            runId: "run-simulation",
            sequence: 2,
            event: { kind: "scenarios_generated", scenarios: [scenario] },
          },
          {
            type: "simulation_event",
            runId: "run-simulation",
            sequence: 3,
            event: { kind: "run_started", scenarioIds: [scenario.id] },
          },
          {
            type: "simulation_event",
            runId: "run-simulation",
            sequence: 4,
            event: { kind: "simulation_completed", result },
          },
          { type: "done", runId: "run-simulation", sequence: 5 },
        ];
        return Promise.resolve(
          new Response(
            `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
          ),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <SettingsProvider>
        <MemoryRouter
          initialEntries={[
            "/projects/test-path?sessionId=session-simulation",
          ]}
        >
          <Routes>
            <Route path="/projects/*" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>,
    );

    fireEvent.click(await screen.findByRole("button", {
      name: /模拟测试/,
    }));
    expect(await screen.findByText("刷新后仍在的场景")).toBeInTheDocument();
    expect(await screen.findByText("1 / 1 已模拟")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === "/api/chat" && init?.method === "POST",
      ),
    ).toBe(false);
  });
});
