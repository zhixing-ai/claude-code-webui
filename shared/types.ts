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
  sessionId?: string;
  requestId?: string;
  allowedTools?: string[];
  workingDirectory?: string;
  permissionMode?: "default" | "plan" | "acceptEdits";
}

export interface CreateRunResponse {
  runId: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  requestId: string;
  allowedTools?: string[];
  workingDirectory?: string;
  permissionMode?: "default" | "plan" | "acceptEdits";
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
