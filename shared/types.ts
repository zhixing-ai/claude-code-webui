export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionStreamResponse {
  type: "ask_user_question";
  interactionId: string;
  questions: AskUserQuestionItem[];
}

export interface ToolPermissionStreamResponse {
  type: "tool_permission";
  interactionId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  canRemember: boolean;
  title?: string;
  displayName?: string;
  description?: string;
  blockedPath?: string;
  decisionReason?: string;
}

export type AgentRunStatus =
  | "registered"
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "stopped";

export interface AgentLifecycleEvent {
  agentRunId: string;
  agentType: string;
  status: AgentRunStatus;
  taskId?: string;
  toolUseId?: string;
  description?: string;
  summary?: string;
  lastTool?: string;
  usage?: {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
  };
}

export interface AgentEventStreamResponse {
  type: "agent_event";
  event: AgentLifecycleEvent;
}

export interface SimulationCase {
  id: string;
  title: string;
  customerGoal: string;
  openingMessage: string;
  expectedBehaviors: string[];
  passCriteria: string[];
}

export interface SimulationScenario {
  id: string;
  title: string;
  stage: string;
  description: string;
  persona: string;
  objective: string;
  cases: SimulationCase[];
}

export type SimulationCommand =
  | {
      action: "orchestrate";
      startsWith: "design" | "run";
      runAfterDesign: boolean;
    }
  | { action: "design" }
  | { action: "run"; scenario: SimulationScenario }
  | { action: "run_all"; scenarios: SimulationScenario[] };

export type RunMode = "builder" | "sandbox_test";

export type SimulationVerdict = "passed" | "partial" | "failed";

export interface SimulationTurn {
  role: "customer" | "sales";
  content: string;
}

export interface SimulationCaseResult {
  caseId: string;
  verdict: SimulationVerdict;
  score: number;
  transcript: SimulationTurn[];
  evaluation: string;
  strengths: string[];
  issues: string[];
}

export interface SimulationRunResult {
  scenarioId: string;
  summary: string;
  cases: SimulationCaseResult[];
}

export type SimulationLifecycleEvent =
  | { kind: "design_started"; runAfterDesign?: boolean }
  | { kind: "scenarios_generated"; scenarios: SimulationScenario[] }
  | { kind: "run_started"; scenarioIds: string[] }
  | { kind: "simulation_completed"; result: SimulationRunResult }
  | { kind: "simulation_batch_completed"; results: SimulationRunResult[] }
  | { kind: "simulation_failed"; error: string };

export interface SimulationEventStreamResponse {
  type: "simulation_event";
  event: SimulationLifecycleEvent;
}

export type InteractionResponse =
  | { answers: Record<string, string> }
  | { cancelled: true }
  | {
      permission: "allow";
      remember?: boolean;
      mode?: "default" | "acceptEdits";
    }
  | { permission: "deny" };

export type StreamResponse =
  | { type: "claude_json"; data: unknown }
  | AgentEventStreamResponse
  | SimulationEventStreamResponse
  | AskUserQuestionStreamResponse
  | ToolPermissionStreamResponse
  | { type: "heartbeat"; runId: string }
  | { type: "error"; error?: string }
  | { type: "done" }
  | { type: "aborted" };

export type SequencedStreamResponse = StreamResponse & {
  runId: string;
  sequence: number;
};

export interface CreateRunRequest {
  message: string;
  newSessionId?: string;
  sessionId?: string;
  requestId?: string;
  allowedTools?: string[];
  workingDirectory?: string;
  additionalDirectories?: string[];
  systemPrompt?: string;
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  runMode?: RunMode;
  simulation?: SimulationCommand;
}

export interface CreateRunResponse {
  runId: string;
}

export interface ChatRequest {
  message: string;
  newSessionId?: string;
  sessionId?: string;
  requestId: string;
  allowedTools?: string[];
  workingDirectory?: string;
  additionalDirectories?: string[];
  systemPrompt?: string;
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  runMode?: RunMode;
  simulation?: SimulationCommand;
}

export interface AbortRequest {
  requestId: string;
}

export interface ProjectInfo {
  path: string;
  encodedName: string;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

export interface CreateProjectRequest {
  path: string;
}

export interface CreateProjectResponse {
  project: ProjectInfo;
}

export interface SessionSummary {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
  cwd?: string;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

// Conversation history types
export interface ConversationSummary {
  sessionId: string;
  startTime: string;
  lastTime: string;
  messageCount: number;
  lastMessagePreview: string;
}

export interface HistoryListResponse {
  conversations: ConversationSummary[];
}

// Conversation history types
// Note: messages are typed as unknown[] to avoid frontend/backend dependency issues
// Frontend should cast to TimestampedSDKMessage[] (defined in frontend/src/types.ts)
export interface ConversationHistory {
  sessionId: string;
  messages: unknown[]; // TimestampedSDKMessage[] in practice, but avoiding frontend type dependency
  metadata: {
    startTime: string;
    endTime: string;
    messageCount: number;
  };
}
