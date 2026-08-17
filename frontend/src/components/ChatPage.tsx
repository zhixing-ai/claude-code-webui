import { useEffect, useCallback, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { SparklesIcon } from "@heroicons/react/24/outline";
import type {
  ChatRequest,
  ChatMessage,
  SDKMessage,
  ProjectInfo,
  PermissionMode,
  AskUserQuestionStreamResponse,
  ToolPermissionStreamResponse,
  InteractionResponse,
  AgentLifecycleEvent,
  SimulationCase,
  SimulationCaseResult,
  SimulationCommand,
  SimulationLifecycleEvent,
  SimulationScenario,
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
  getRunsUrl,
} from "../config/api";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";
import { extractToolInfo, generateToolPatterns } from "../utils/toolUtils";
import type { StreamingContext } from "../hooks/streaming/useMessageProcessor";
import { TaskSidebar } from "./chat/TaskSidebar";
import type { SimulationPanelState } from "./chat/SimulationPanel";
import {
  createEmptyTaskProjection,
  reduceTaskMessage,
  replayTaskMessages,
  selectTasks,
} from "../utils/taskProjection";
import {
  createEmptyAgentProjection,
  reduceAgentEvent,
  selectAgentRuns,
  stopActiveAgents,
} from "../utils/agentProjection";
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
  simulationEventReceived: boolean;
}

function createEmptySimulationState(): SimulationPanelState {
  return {
    status: "idle",
    scenarios: [],
    results: {},
    runningScenarioIds: [],
    scenarioErrors: {},
  };
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
  const [agentProjection, setAgentProjection] = useState(
    createEmptyAgentProjection,
  );
  const [simulation, setSimulation] = useState(createEmptySimulationState);

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

  const handleAgentEvent = useCallback((event: AgentLifecycleEvent) => {
    setAgentProjection((current) => reduceAgentEvent(current, event));
  }, []);

  const handleSimulationEvent = useCallback(
    (event: SimulationLifecycleEvent) => {
      if (event.kind === "scenarios_generated") {
        setSimulation({
          status: "ready",
          scenarios: event.scenarios,
          results: {},
          runningScenarioIds: [],
          scenarioErrors: {},
        });
        return;
      }
      setSimulation((current) => {
        const runningScenarioIds = current.runningScenarioIds.filter(
          (id) => id !== event.result.scenarioId,
        );
        const scenarioErrors = { ...current.scenarioErrors };
        delete scenarioErrors[event.result.scenarioId];
        return {
          ...current,
          status: runningScenarioIds.length > 0 ? "running" : "ready",
          runningScenarioIds,
          scenarioErrors,
          error: undefined,
          results: {
            ...current.results,
            [event.result.scenarioId]: event.result,
          },
        };
      });
    },
    [],
  );

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
      simulationCommand?: SimulationCommand,
    ): Promise<RunStreamResult> => {
      let response = initialResponse;
      let resolvedSessionId = initialSessionId;
      let localAssistantMessage = currentAssistantMessage;
      let localHasReceivedInit = false;
      let localHasShownInitMessage = hasShownInitMessage;
      let lastSequence = 0;
      let terminal = false;
      let simulationEventReceived = false;

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
        onAgentEvent: handleAgentEvent,
        onSimulationEvent: handleSimulationEvent,
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
        simulationEventReceived ||= envelope.type === "simulation_event";
        terminal =
          envelope.type === "done" ||
          envelope.type === "error" ||
          envelope.type === "aborted";
        if (envelope.type === "error" || envelope.type === "aborted") {
          setAgentProjection((current) =>
            stopActiveAgents(
              current,
              envelope.type === "error" ? "failed" : "stopped",
            ),
          );
          if (simulationCommand) {
            setSimulation((current) => ({
              ...current,
              status: "error",
              runningScenarioIds: [],
              error:
                envelope.type === "error"
                  ? "模拟测试运行失败，请稍后重试。"
                  : "模拟测试已停止。",
            }));
          }
        }
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

      return {
        sessionId: resolvedSessionId,
        terminal,
        simulationEventReceived,
      };
    },
    [
      addMessage,
      currentAssistantMessage,
      handleSdkMessage,
      handleAgentEvent,
      handleSimulationEvent,
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
      simulationCommand?: SimulationCommand,
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
            ...(simulationCommand ? { simulation: simulationCommand } : {}),
          } as ChatRequest),
        });

        if (!response.ok)
          throw new Error(`Chat request failed: ${response.status}`);
        runAccepted = true;
        streamResult = await consumeRunResponse(
          requestId,
          response,
          currentSessionId,
          simulationCommand,
        );
      } catch (error) {
        console.error("Failed to send message:", error);
        addMessage({
          type: "chat",
          role: "assistant",
          content: "Error: Failed to get response",
          timestamp: Date.now(),
        });
        if (simulationCommand) {
          setSimulation((current) => ({
            ...current,
            status: "error",
            runningScenarioIds: [],
            error: "无法启动模拟测试，请检查服务后重试。",
          }));
        }
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
        if (
          simulationCommand &&
          streamResult?.terminal &&
          !streamResult.simulationEventReceived
        ) {
          setSimulation((current) => ({
            ...current,
            status: "error",
            runningScenarioIds: [],
            error: "Agent 已结束，但没有返回有效的结构化结果，请重试。",
          }));
        }
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

  const handleGenerateScenarios = useCallback(() => {
    if (isLoading) return;
    setSimulation({
      status: "designing",
      scenarios: [],
      results: {},
      runningScenarioIds: [],
      scenarioErrors: {},
    });
    void sendMessage("生成模拟测试场景", undefined, false, undefined, {
      action: "design",
    });
  }, [isLoading, sendMessage]);

  const runSimulationScenario = useCallback(
    async (scenario: SimulationScenario) => {
      // ponytail: parallel run IDs live in this page; persist them when refresh recovery is required.
      setSimulation((current) => ({
        ...current,
        status: "running",
        runningScenarioIds: current.runningScenarioIds.includes(scenario.id)
          ? current.runningScenarioIds
          : [...current.runningScenarioIds, scenario.id],
        results: Object.fromEntries(
          Object.entries(current.results).filter(([id]) => id !== scenario.id),
        ),
        scenarioErrors: Object.fromEntries(
          Object.entries(current.scenarioErrors).filter(
            ([id]) => id !== scenario.id,
          ),
        ),
        error: undefined,
      }));

      try {
        const createResponse = await fetch(getRunsUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `开始模拟：${scenario.title}`,
            newSessionId: crypto.randomUUID(),
            ...(workingDirectory ? { workingDirectory } : {}),
            permissionMode,
            simulation: { action: "run", scenario },
          }),
        });
        if (!createResponse.ok) {
          throw new Error(`Could not start run: ${createResponse.status}`);
        }
        const { runId } = (await createResponse.json()) as { runId?: string };
        if (!runId) throw new Error("Run response did not include an ID");

        let response = await fetch(getRunEventsUrl(runId));
        if (!response.ok) {
          throw new Error(`Could not open run stream: ${response.status}`);
        }
        let lastSequence = 0;
        let terminal = false;
        let resultReceived = false;
        let runError: string | undefined;

        for (let reconnects = 0; !terminal; reconnects += 1) {
          await consumeStream(response, (line) => {
            if (!line.trim()) return;
            const envelope = JSON.parse(line) as {
              type?: string;
              sequence?: number;
              error?: string;
              event?: AgentLifecycleEvent | SimulationLifecycleEvent;
            };
            if (typeof envelope.sequence === "number") {
              lastSequence = Math.max(lastSequence, envelope.sequence);
            }
            if (envelope.type === "agent_event" && envelope.event) {
              handleAgentEvent(envelope.event as AgentLifecycleEvent);
            } else if (envelope.type === "simulation_event" && envelope.event) {
              resultReceived = true;
              handleSimulationEvent(envelope.event as SimulationLifecycleEvent);
            } else if (envelope.type === "error") {
              runError = envelope.error || "模拟运行失败";
            } else if (envelope.type === "aborted") {
              runError = "模拟运行已停止";
            }
            terminal = ["done", "error", "aborted"].includes(
              envelope.type || "",
            );
          });
          if (terminal) break;
          if (reconnects >= 3) {
            throw new Error("Run stream ended before completion");
          }
          response = await fetch(getRunEventsUrl(runId, lastSequence));
          if (!response.ok) {
            throw new Error(`Could not reconnect to run: ${response.status}`);
          }
        }

        if (runError) throw new Error(runError);
        if (!resultReceived) throw new Error("Agent 未返回有效的结构化结果");
      } catch (error) {
        console.error(`Simulation failed for ${scenario.id}:`, error);
        setSimulation((current) => {
          const runningScenarioIds = current.runningScenarioIds.filter(
            (id) => id !== scenario.id,
          );
          return {
            ...current,
            status: runningScenarioIds.length > 0 ? "running" : "ready",
            runningScenarioIds,
            scenarioErrors: {
              ...current.scenarioErrors,
              [scenario.id]: "该场景模拟失败，请单独重试。",
            },
          };
        });
      }
    },
    [handleAgentEvent, handleSimulationEvent, permissionMode, workingDirectory],
  );

  const handleRunScenario = useCallback(
    (scenario: SimulationScenario) => {
      if (isLoading) return;
      void runSimulationScenario(scenario);
    },
    [isLoading, runSimulationScenario],
  );

  const handleRunAllScenarios = useCallback(
    (scenarios: SimulationScenario[]) => {
      if (isLoading) return;
      for (const scenario of scenarios) void runSimulationScenario(scenario);
    },
    [isLoading, runSimulationScenario],
  );

  const handleEscalateCase = useCallback(
    (
      scenario: SimulationScenario,
      testCase: SimulationCase,
      result: SimulationCaseResult,
    ) => {
      if (isLoading) return;
      const transcript = result.transcript
        .map(
          (turn) =>
            `${turn.role === "customer" ? "客户" : "销售"}：${turn.content}`,
        )
        .join("\n");
      const issues = result.issues.length
        ? `\n问题清单：${result.issues.join("；")}`
        : "";
      const message = `【模拟测试回流】场景「${scenario.title}」Case「${testCase.title}」${
        result.verdict === "failed" ? "未通过" : "部分通过"
      }（考官 ${result.score} 分）。\n考官判词：${result.evaluation}${issues}\n对话原文：\n${transcript}\n请按批注流程修复（先查配置、后动内核）；改完告诉我，我会在右侧该场景点「重新模拟」复测。`;
      void sendMessage(message);
    },
    [isLoading, sendMessage],
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
      setAgentProjection(createEmptyAgentProjection());
      if (run.request.simulation?.action === "design") {
        setSimulation({
          status: "designing",
          scenarios: [],
          results: {},
          runningScenarioIds: [],
          scenarioErrors: {},
        });
      } else if (run.request.simulation?.action === "run") {
        setSimulation({
          status: "running",
          scenarios: [run.request.simulation.scenario],
          results: {},
          runningScenarioIds: [run.request.simulation.scenario.id],
          scenarioErrors: {},
        });
      }
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
          run.request.simulation,
        );
        if (
          run.request.simulation &&
          result.terminal &&
          !result.simulationEventReceived
        ) {
          setSimulation((current) => ({
            ...current,
            status: "error",
            runningScenarioIds: [],
            error: "Agent 已结束，但没有返回有效的结构化结果，请重试。",
          }));
        }
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
    setAgentProjection(createEmptyAgentProjection());
    setSimulation(createEmptySimulationState());
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
      setAgentProjection(createEmptyAgentProjection());
      setSimulation(createEmptySimulationState());
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
  const agents = selectAgentRuns(agentProjection);

  return (
    <div className="flex h-dvh min-h-[36rem] flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={handleBackToProjects}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)] transition-[background-color,transform] hover:bg-[var(--accent)]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-95"
            aria-label="Back to project selection"
          >
            <SparklesIcon className="size-4.5" />
          </button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={handleBackToProjects}
                className="truncate text-sm font-semibold hover:text-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Claude Code Web UI
              </button>
              <span className="hidden rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)] sm:inline-flex">
                Builder
              </span>
            </div>
            {workingDirectory && (
              <button
                onClick={handleBackToProjectChat}
                className="block max-w-[55vw] truncate font-mono text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] sm:max-w-[65vw]"
                aria-label={`Return to new chat in ${workingDirectory}`}
                title={workingDirectory}
              >
                {workingDirectory}
                {sessionId ? ` · ${sessionId.substring(0, 8)}` : ""}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="xl:hidden">
            <HistoryButton
              onClick={handleConversationListClick}
              expanded={isConversationListOpen}
            />
          </div>
          <SettingsButton onClick={handleSettingsClick} />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3 p-2 sm:p-3">
        {isConversationListOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/35 xl:hidden"
            onClick={() => setIsConversationListOpen(false)}
            aria-label="Close conversation list"
          />
        )}
        <aside
          id="conversation-list"
          className={`z-50 w-[min(22rem,calc(100vw-1rem))] shrink-0 ${
            isConversationListOpen
              ? "fixed inset-y-2 left-2 sm:inset-y-3 sm:left-3"
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

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] shadow-[0_2px_12px_rgba(15,23,42,0.06)] ring-1 ring-[var(--border-subtle)]">
          {historyLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center text-sm text-[var(--text-secondary)]">
                <div className="mx-auto mb-3 size-5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-primary)] motion-reduce:animate-none" />
                <p className="thinking-shimmer">
                  Loading conversation history...
                </p>
              </div>
            </div>
          ) : historyError ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="max-w-md px-6 text-center">
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/40">
                  <svg
                    className="size-6 text-[var(--danger)]"
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
                <h2 className="mb-2 text-lg font-semibold">
                  Error Loading Conversation
                </h2>
                <p className="mb-4 text-sm text-[var(--text-secondary)]">
                  {historyError}
                </p>
                <button
                  onClick={handleNewConversation}
                  className="rounded-full bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-[var(--surface-panel)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  Start New Conversation
                </button>
              </div>
            </div>
          ) : (
            <>
              <ChatMessages messages={messages} isLoading={isLoading} />
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
                        onSubmit: (answers) => respondToQuestion({ answers }),
                        onCancel: () => respondToQuestion({ cancelled: true }),
                      }
                    : undefined
                }
              />
            </>
          )}
        </main>
        {!historyLoading && !historyError && (
          <TaskSidebar
            tasks={tasks}
            agents={agents}
            isLoading={isLoading}
            simulation={simulation}
            onGenerateScenarios={handleGenerateScenarios}
            onRunScenario={handleRunScenario}
            onRunAllScenarios={handleRunAllScenarios}
            onEscalateCase={handleEscalateCase}
          />
        )}
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
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
