import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    });
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
});
