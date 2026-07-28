import { useEffect, useCallback, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type {
  ChatRequest,
  ChatMessage,
  SDKMessage,
  ProjectInfo,
  PermissionMode,
  AskUserQuestionStreamResponse,
  ToolPermissionStreamResponse,
  InteractionResponse,
} from "../types";
import { useClaudeStreaming } from "../hooks/useClaudeStreaming";
import { useChatState } from "../hooks/chat/useChatState";
import { usePermissions } from "../hooks/chat/usePermissions";
import { usePermissionMode } from "../hooks/chat/usePermissionMode";
import { useAbortController } from "../hooks/chat/useAbortController";
import { useAutoHistoryLoader } from "../hooks/useHistoryLoader";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { HistoryButton } from "./chat/HistoryButton";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import { HistoryView } from "./HistoryView";
import {
  getChatUrl,
  getInteractionResponseUrl,
  getProjectsUrl,
  getRunEventsUrl,
  getRunUrl,
} from "../config/api";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";
import { extractToolInfo, generateToolPatterns } from "../utils/toolUtils";
import type { StreamingContext } from "../hooks/streaming/useMessageProcessor";
import { TaskSidebar } from "./chat/TaskSidebar";
import {
  createEmptyTaskProjection,
  reduceTaskMessage,
  replayTaskMessages,
  selectTasks,
} from "../utils/taskProjection";
import {
  getStorageItem,
  removeStorageItem,
  setStorageItem,
} from "../utils/storage";

interface StoredRunResponse {
  id: string;
  request: ChatRequest;
  sessionId?: string;
  status: "running" | "completed" | "failed" | "aborted" | "interrupted";
  createdAt: string;
}

interface RunStreamResult {
  sessionId: string | null;
  terminal: boolean;
}

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConversationListOpen, setIsConversationListOpen] = useState(false);
  const [conversationListVersion, setConversationListVersion] = useState(0);
  const restoreAttempt = useRef<string | null>(null);
  const [askUserQuestion, setAskUserQuestion] =
    useState<AskUserQuestionStreamResponse | null>(null);
  const [toolPermissions, setToolPermissions] = useState<
    ToolPermissionStreamResponse[]
  >([]);
  const toolPermission = toolPermissions[0] ?? null;
  const [taskProjection, setTaskProjection] = useState(
    createEmptyTaskProjection,
  );

  // Extract and normalize working directory from URL
  const workingDirectory = (() => {
    const rawPath = location.pathname.replace("/projects", "");
    if (!rawPath) return undefined;

    // URL decode the path
    const decodedPath = decodeURIComponent(rawPath);

    // Normalize Windows paths (remove leading slash from /C:/... format)
    return normalizeWindowsPath(decodedPath);
  })();

  // Get the selected session from query parameters
  const sessionId = searchParams.get("sessionId");

  const { processStreamLine } = useClaudeStreaming();
  const { abortRequest } = useAbortController();

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();

  // Get encoded name for current working directory
  const getEncodedName = useCallback(() => {
    if (!workingDirectory || !projects.length) {
      return null;
    }

    const project = projects.find((p) => p.path === workingDirectory);

    // Normalize paths for comparison (handle Windows path issues)
    const normalizedWorking = normalizeWindowsPath(workingDirectory);
    const normalizedProject = projects.find(
      (p) => normalizeWindowsPath(p.path) === normalizedWorking,
    );

    // Use normalized result if exact match fails
    const finalProject = project || normalizedProject;

    return finalProject?.encodedName || null;
  }, [workingDirectory, projects]);

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    sdkMessages: historySdkMessages,
    loading: historyLoading,
    error: historyError,
    sessionId: loadedSessionId,
  } = useAutoHistoryLoader(
    getEncodedName() || undefined,
    sessionId || undefined,
  );

  useEffect(() => {
    setTaskProjection(replayTaskMessages(historySdkMessages));
  }, [historySdkMessages]);

  const handleSdkMessage = useCallback((message: SDKMessage) => {
    setTaskProjection((current) => reduceTaskMessage(current, message));
  }, []);

  // Initialize chat state with loaded history
  const {
    messages,
    input,
    isLoading,
    currentSessionId,
    currentRequestId,
    hasShownInitMessage,
    currentAssistantMessage,
    setInput,
    setMessages,
    setCurrentSessionId,
    setCurrentRequestId,
    setHasShownInitMessage,
    setHasReceivedInit,
    setCurrentAssistantMessage,
    addMessage,
    updateLastMessage,
    clearInput,
    generateRequestId,
    resetRequestState,
    startRequest,
  } = useChatState({
    initialMessages: historyMessages,
    initialSessionId: loadedSessionId || undefined,
  });

  const {
    allowedTools,
    permissionRequest,
    showPermissionRequest,
    closePermissionRequest,
    isPermissionMode,
    planModeRequest,
    showPlanModeRequest,
    closePlanModeRequest,
    updatePermissionMode,
  } = usePermissions({
    onPermissionModeChange: setPermissionMode,
  });

  const handleToolPermission = useCallback(
    (event: ToolPermissionStreamResponse) => {
      setToolPermissions((current) => [...current, event]);
    },
    [],
  );

  useEffect(() => {
    if (!toolPermission) return;
    if (toolPermission.toolName === "ExitPlanMode") {
      showPlanModeRequest("");
    } else {
      const { toolName, commands } = extractToolInfo(
        toolPermission.toolName,
        toolPermission.input,
      );
      showPermissionRequest(
        toolName,
        generateToolPatterns(toolName, commands),
        toolPermission.toolUseId,
      );
    }
  }, [showPermissionRequest, showPlanModeRequest, toolPermission]);

  const consumeRunResponse = useCallback(
    async (
      runId: string,
      initialResponse: Response,
      initialSessionId: string | null,
    ): Promise<RunStreamResult> => {
      let response = initialResponse;
      let resolvedSessionId = initialSessionId;
      let localAssistantMessage = currentAssistantMessage;
      let localHasReceivedInit = false;
      let localHasShownInitMessage = hasShownInitMessage;
      let lastSequence = 0;
      let terminal = false;

      const streamingContext: StreamingContext = {
        get currentAssistantMessage() {
          return localAssistantMessage;
        },
        setCurrentAssistantMessage: (message) => {
          localAssistantMessage = message;
          setCurrentAssistantMessage(message);
        },
        addMessage,
        updateLastMessage,
        onSessionId: (nextSessionId) => {
          resolvedSessionId = nextSessionId;
          setCurrentSessionId(nextSessionId);
        },
        shouldShowInitMessage: () => !localHasShownInitMessage,
        onInitMessageShown: () => {
          localHasShownInitMessage = true;
          setHasShownInitMessage(true);
        },
        get hasReceivedInit() {
          return localHasReceivedInit;
        },
        setHasReceivedInit: (received: boolean) => {
          localHasReceivedInit = received;
          setHasReceivedInit(received);
        },
        onAskUserQuestion: setAskUserQuestion,
        onToolPermission: handleToolPermission,
        onSdkMessage: handleSdkMessage,
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        const envelope = JSON.parse(line) as {
          type?: string;
          sequence?: number;
        };
        if (typeof envelope.sequence === "number") {
          lastSequence = Math.max(lastSequence, envelope.sequence);
        }
        terminal =
          envelope.type === "done" ||
          envelope.type === "error" ||
          envelope.type === "aborted";
        processStreamLine(line, streamingContext);
      };

      for (let reconnects = 0; !terminal; reconnects += 1) {
        try {
          await consumeStream(response, processLine);
        } catch (error) {
          if (reconnects >= 3) throw error;
        }
        if (terminal) break;
        if (reconnects >= 3) {
          throw new Error("Run stream ended before completion");
        }
        response = await fetch(getRunEventsUrl(runId, lastSequence));
        if (!response.ok) {
          throw new Error(`Could not reconnect to run: ${response.status}`);
        }
      }

      return { sessionId: resolvedSessionId, terminal };
    },
    [
      addMessage,
      currentAssistantMessage,
      handleSdkMessage,
      handleToolPermission,
      hasShownInitMessage,
      processStreamLine,
      setCurrentAssistantMessage,
      setCurrentSessionId,
      setHasReceivedInit,
      setHasShownInitMessage,
      updateLastMessage,
    ],
  );

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
      overridePermissionMode?: PermissionMode,
    ) => {
      const content = messageContent || input.trim();
      if (!content || isLoading) return;

      const requestId = generateRequestId();
      const activeRunKey = getActiveRunStorageKey(workingDirectory);
      let runAccepted = false;
      let streamResult: RunStreamResult | undefined;
      setStorageItem(activeRunKey, { runId: requestId });

      // Only add user message to chat if not hidden
      if (!hideUserMessage) {
        const userMessage: ChatMessage = {
          type: "chat",
          role: "user",
          content: content,
          timestamp: Date.now(),
        };
        addMessage(userMessage);
      }

      if (!messageContent) clearInput();
      startRequest();

      try {
        const response = await fetch(getChatUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            requestId,
            ...(currentSessionId ? { sessionId: currentSessionId } : {}),
            allowedTools: tools || allowedTools,
            ...(workingDirectory ? { workingDirectory } : {}),
            permissionMode: overridePermissionMode || permissionMode,
          } as ChatRequest),
        });

        if (!response.ok)
          throw new Error(`Chat request failed: ${response.status}`);
        runAccepted = true;
        streamResult = await consumeRunResponse(
          requestId,
          response,
          currentSessionId,
        );
      } catch (error) {
        console.error("Failed to send message:", error);
        addMessage({
          type: "chat",
          role: "assistant",
          content: "Error: Failed to get response",
          timestamp: Date.now(),
        });
      } finally {
        setConversationListVersion((version) => version + 1);
        if (!runAccepted || streamResult?.terminal) {
          removeStorageItem(activeRunKey);
        }
        if (!sessionId && streamResult?.sessionId) {
          const params = new URLSearchParams();
          params.set("sessionId", streamResult.sessionId);
          navigate({ search: params.toString() }, { replace: true });
        }
        setAskUserQuestion(null);
        setToolPermissions([]);
        closePermissionRequest();
        closePlanModeRequest();
        resetRequestState();
      }
    },
    [
      input,
      isLoading,
      currentSessionId,
      sessionId,
      allowedTools,
      workingDirectory,
      permissionMode,
      generateRequestId,
      clearInput,
      startRequest,
      addMessage,
      resetRequestState,
      closePermissionRequest,
      closePlanModeRequest,
      consumeRunResponse,
      navigate,
    ],
  );

  useEffect(() => {
    if (!workingDirectory) return;
    if (sessionId && loadedSessionId !== sessionId && !historyError) {
      return;
    }

    const activeRunKey = getActiveRunStorageKey(workingDirectory);
    if (restoreAttempt.current === activeRunKey) return;
    restoreAttempt.current = activeRunKey;

    const stored = getStorageItem<{ runId?: string } | null>(
      activeRunKey,
      null,
    );
    if (!stored?.runId) return;

    const restoreRun = async () => {
      let runResponse: Response;
      try {
        runResponse = await fetch(getRunUrl(stored.runId!));
      } catch (error) {
        console.error("Failed to inspect active run:", error);
        restoreAttempt.current = null;
        return;
      }

      if (runResponse.status === 404) {
        removeStorageItem(activeRunKey);
        return;
      }
      if (!runResponse.ok) {
        restoreAttempt.current = null;
        return;
      }

      const run = (await runResponse.json()) as StoredRunResponse;
      if (
        !run.id ||
        typeof run.request?.message !== "string" ||
        (run.request.workingDirectory &&
          normalizeWindowsPath(run.request.workingDirectory) !==
            normalizeWindowsPath(workingDirectory))
      ) {
        removeStorageItem(activeRunKey);
        return;
      }

      const startedAt = new Date(run.createdAt).getTime();
      setMessages([
        ...historyMessages.filter(
          (message) =>
            !Number.isFinite(startedAt) || message.timestamp < startedAt,
        ),
        {
          type: "chat",
          role: "user",
          content: run.request.message,
          timestamp: Number.isFinite(startedAt) ? startedAt : Date.now(),
        },
      ]);
      setTaskProjection(
        replayTaskMessages(
          historySdkMessages.filter(
            (message) =>
              !Number.isFinite(startedAt) ||
              new Date(message.timestamp).getTime() < startedAt,
          ),
        ),
      );
      setCurrentSessionId(run.sessionId || run.request.sessionId || null);
      setCurrentRequestId(run.id);
      setHasShownInitMessage(false);
      setHasReceivedInit(false);
      startRequest();

      try {
        const eventsResponse = await fetch(getRunEventsUrl(run.id));
        if (!eventsResponse.ok) {
          throw new Error(
            `Could not restore run events: ${eventsResponse.status}`,
          );
        }
        const result = await consumeRunResponse(
          run.id,
          eventsResponse,
          run.sessionId || run.request.sessionId || null,
        );
        if (result.terminal) removeStorageItem(activeRunKey);
        if (!sessionId && result.sessionId) {
          const params = new URLSearchParams();
          params.set("sessionId", result.sessionId);
          navigate({ search: params.toString() }, { replace: true });
        }
      } catch (error) {
        console.error("Failed to restore active run:", error);
        addMessage({
          type: "chat",
          role: "assistant",
          content:
            "The active response could not be reconnected. Refresh to retry.",
          timestamp: Date.now(),
        });
        restoreAttempt.current = null;
      } finally {
        setConversationListVersion((version) => version + 1);
        setAskUserQuestion(null);
        setToolPermissions([]);
        closePermissionRequest();
        closePlanModeRequest();
        resetRequestState();
      }
    };

    void restoreRun();
  }, [
    addMessage,
    closePermissionRequest,
    closePlanModeRequest,
    consumeRunResponse,
    historyError,
    historyMessages,
    historySdkMessages,
    loadedSessionId,
    navigate,
    resetRequestState,
    sessionId,
    setCurrentRequestId,
    setCurrentSessionId,
    setHasReceivedInit,
    setHasShownInitMessage,
    setMessages,
    startRequest,
    workingDirectory,
  ]);

  const handleAbort = useCallback(() => {
    setAskUserQuestion(null);
    setToolPermissions([]);
    closePermissionRequest();
    closePlanModeRequest();
    abortRequest(currentRequestId, isLoading, resetRequestState);
  }, [
    abortRequest,
    closePermissionRequest,
    closePlanModeRequest,
    currentRequestId,
    isLoading,
    resetRequestState,
  ]);

  const respondToQuestion = useCallback(
    async (body: InteractionResponse) => {
      if (!askUserQuestion) {
        throw new Error("Question is no longer active");
      }

      const response = await fetch(
        getInteractionResponseUrl(askUserQuestion.interactionId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Could not submit question response");
      }

      setAskUserQuestion(null);
    },
    [askUserQuestion],
  );

  const respondToToolPermission = useCallback(
    async (body: InteractionResponse) => {
      if (!toolPermission) return false;

      try {
        const response = await fetch(
          getInteractionResponseUrl(toolPermission.interactionId),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            payload?.error || "Could not submit permission response",
          );
        }
        setToolPermissions((current) => current.slice(1));
        return true;
      } catch (error) {
        console.error("Failed to submit permission response:", error);
        return false;
      }
    },
    [toolPermission],
  );

  // Permission request handlers
  const handlePermissionAllow = useCallback(async () => {
    if (!permissionRequest) return;
    if (
      await respondToToolPermission({
        permission: "allow",
      })
    ) {
      closePermissionRequest();
    }
  }, [permissionRequest, respondToToolPermission, closePermissionRequest]);

  const handlePermissionAllowPermanent = useCallback(async () => {
    if (!permissionRequest) return;
    if (
      await respondToToolPermission({
        permission: "allow",
        remember: true,
      })
    ) {
      closePermissionRequest();
    }
  }, [permissionRequest, respondToToolPermission, closePermissionRequest]);

  const handlePermissionDeny = useCallback(async () => {
    if (
      await respondToToolPermission({
        permission: "deny",
      })
    ) {
      closePermissionRequest();
    }
  }, [closePermissionRequest, respondToToolPermission]);

  // Plan mode request handlers
  const handlePlanAcceptWithEdits = useCallback(async () => {
    if (
      await respondToToolPermission({
        permission: "allow",
        mode: "acceptEdits",
      })
    ) {
      updatePermissionMode("acceptEdits");
      closePlanModeRequest();
    }
  }, [respondToToolPermission, updatePermissionMode, closePlanModeRequest]);

  const handlePlanAcceptDefault = useCallback(async () => {
    if (
      await respondToToolPermission({
        permission: "allow",
        mode: "default",
      })
    ) {
      updatePermissionMode("default");
      closePlanModeRequest();
    }
  }, [respondToToolPermission, updatePermissionMode, closePlanModeRequest]);

  const handlePlanKeepPlanning = useCallback(async () => {
    if (
      await respondToToolPermission({
        permission: "deny",
      })
    ) {
      updatePermissionMode("plan");
      closePlanModeRequest();
    }
  }, [closePlanModeRequest, respondToToolPermission, updatePermissionMode]);

  // Create permission data for inline permission interface
  const permissionData = permissionRequest
    ? {
        patterns: permissionRequest.patterns,
        title: toolPermission?.title || toolPermission?.displayName,
        description:
          toolPermission?.description ||
          toolPermission?.decisionReason ||
          (toolPermission?.blockedPath
            ? `Access requires permission for ${toolPermission.blockedPath}`
            : undefined),
        canRemember: toolPermission?.canRemember,
        onAllow: handlePermissionAllow,
        onAllowPermanent: handlePermissionAllowPermanent,
        onDeny: handlePermissionDeny,
      }
    : undefined;

  // Create plan permission data for plan mode interface
  const planPermissionData = planModeRequest
    ? {
        onAcceptWithEdits: handlePlanAcceptWithEdits,
        onAcceptDefault: handlePlanAcceptDefault,
        onKeepPlanning: handlePlanKeepPlanning,
      }
    : undefined;

  const handleConversationListClick = useCallback(() => {
    setIsConversationListOpen((open) => !open);
  }, []);

  const handleNewConversation = useCallback(() => {
    if (isLoading) return;
    removeStorageItem(getActiveRunStorageKey(workingDirectory));
    navigate({ search: "" });
    setMessages([]);
    setInput("");
    setCurrentSessionId(null);
    setHasShownInitMessage(false);
    setHasReceivedInit(false);
    setCurrentAssistantMessage(null);
    setAskUserQuestion(null);
    setToolPermissions([]);
    setTaskProjection(createEmptyTaskProjection());
    closePermissionRequest();
    closePlanModeRequest();
    setIsConversationListOpen(false);
  }, [
    closePermissionRequest,
    closePlanModeRequest,
    isLoading,
    navigate,
    setCurrentAssistantMessage,
    setCurrentSessionId,
    setHasReceivedInit,
    setHasShownInitMessage,
    setInput,
    setMessages,
    workingDirectory,
  ]);

  const handleConversationSelect = useCallback(
    (nextSessionId: string) => {
      if (isLoading || nextSessionId === currentSessionId) {
        setIsConversationListOpen(false);
        return;
      }
      const params = new URLSearchParams();
      params.set("sessionId", nextSessionId);
      navigate({ search: params.toString() });
      setIsConversationListOpen(false);
    },
    [currentSessionId, isLoading, navigate],
  );

  const handleSettingsClick = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  // Load projects to get encodedName mapping
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await fetch(getProjectsUrl());
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
        }
      } catch (error) {
        console.error("Failed to load projects:", error);
      }
    };
    loadProjects();
  }, []);

  const handleBackToProjects = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleBackToProjectChat = useCallback(() => {
    handleNewConversation();
  }, [handleNewConversation]);

  // Handle global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEYBOARD_SHORTCUTS.ABORT && isLoading && currentRequestId) {
        e.preventDefault();
        handleAbort();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isLoading, currentRequestId, handleAbort]);

  const tasks = selectTasks(taskProjection);
  const hasTasks = tasks.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="mx-auto flex h-screen max-w-[110rem] flex-col p-3 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-8 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <nav aria-label="Breadcrumb">
                <div className="flex items-center">
                  <button
                    onClick={handleBackToProjects}
                    className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded-md px-1 -mx-1"
                    aria-label="Back to project selection"
                  >
                    Claude Code Web UI
                  </button>
                  {sessionId && (
                    <>
                      <span
                        className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight mx-3 select-none"
                        aria-hidden="true"
                      >
                        {" "}
                        ›{" "}
                      </span>
                      <h1
                        className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight"
                        aria-current="page"
                      >
                        Conversation
                      </h1>
                    </>
                  )}
                </div>
              </nav>
              {workingDirectory && (
                <div className="flex items-center text-sm font-mono mt-1">
                  <button
                    onClick={handleBackToProjectChat}
                    className="text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded px-1 -mx-1 cursor-pointer"
                    aria-label={`Return to new chat in ${workingDirectory}`}
                  >
                    {workingDirectory}
                  </button>
                  {sessionId && (
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                      Session: {sessionId.substring(0, 8)}...
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="xl:hidden">
              <HistoryButton
                onClick={handleConversationListClick}
                expanded={isConversationListOpen}
              />
            </div>
            <SettingsButton onClick={handleSettingsClick} />
          </div>
        </div>

        {/* Main Content */}
        <div className="relative flex min-h-0 flex-1 gap-5">
          {isConversationListOpen && (
            <button
              type="button"
              className="fixed inset-0 z-40 bg-slate-950/45 xl:hidden"
              onClick={() => setIsConversationListOpen(false)}
              aria-label="Close conversation list"
            />
          )}
          <aside
            id="conversation-list"
            className={`z-50 w-[min(22rem,calc(100vw-2rem))] shrink-0 ${
              isConversationListOpen
                ? "fixed inset-y-3 left-3 sm:inset-y-6 sm:left-6"
                : "hidden"
            } xl:static xl:block xl:w-72`}
          >
            <HistoryView
              workingDirectory={workingDirectory}
              currentSessionId={currentSessionId}
              disabled={isLoading}
              refreshToken={conversationListVersion}
              onSelect={handleConversationSelect}
              onNew={handleNewConversation}
              onClose={() => setIsConversationListOpen(false)}
            />
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {historyLoading ? (
              /* Loading conversation history */
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"></div>
                  <p className="text-slate-600 dark:text-slate-400">
                    Loading conversation history...
                  </p>
                </div>
              </div>
            ) : historyError ? (
              /* Error loading conversation history */
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-md text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
                    <svg
                      className="h-8 w-8 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <h2 className="mb-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
                    Error Loading Conversation
                  </h2>
                  <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                    {historyError}
                  </p>
                  <button
                    onClick={handleNewConversation}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                  >
                    Start New Conversation
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:gap-5 ${
                  hasTasks
                    ? "lg:grid-cols-[18rem_minmax(0,1fr)]"
                    : "lg:grid-cols-1"
                }`}
              >
                <TaskSidebar tasks={tasks} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {/* Chat Messages */}
                  <ChatMessages messages={messages} isLoading={isLoading} />

                  {/* Input */}
                  <ChatInput
                    input={input}
                    isLoading={isLoading}
                    currentRequestId={currentRequestId}
                    onInputChange={setInput}
                    onSubmit={() => sendMessage()}
                    onAbort={handleAbort}
                    permissionMode={permissionMode}
                    onPermissionModeChange={setPermissionMode}
                    showPermissions={isPermissionMode}
                    permissionData={permissionData}
                    planPermissionData={planPermissionData}
                    askUserQuestionData={
                      askUserQuestion
                        ? {
                            questions: askUserQuestion.questions,
                            onSubmit: (answers) =>
                              respondToQuestion({ answers }),
                            onCancel: () =>
                              respondToQuestion({ cancelled: true }),
                          }
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Settings Modal */}
        <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
      </div>
    </div>
  );
}

async function consumeStream(
  response: Response,
  onLine: (line: string) => void,
) {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }

  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
}

function getActiveRunStorageKey(workingDirectory?: string): string {
  return `claude-code-webui-active-run:${workingDirectory || "default"}`;
}
