// The frontend consumes Claude's JSON protocol over HTTP. Keep this boundary
// intentionally smaller than the SDK's internal types so SDK additions do not
// break the web build.
export interface SDKContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface SDKMessageBody<TContent> {
  content: TContent;
  [key: string]: unknown;
}

export interface SDKSystemMessage {
  type: "system";
  subtype: string;
  apiKeySource: string;
  cwd: string;
  session_id: string;
  uuid: string;
  tools: string[];
  mcp_servers: { name: string; status: string }[];
  model: string;
  permissionMode: string;
  slash_commands: string[];
  output_style: string;
}

export interface SDKAssistantMessage {
  type: "assistant";
  message: SDKMessageBody<SDKContentBlock[]>;
  parent_tool_use_id: string | null;
  session_id?: string;
  uuid?: string;
}

export interface SDKUserMessage {
  type: "user";
  message: SDKMessageBody<string | SDKContentBlock[]>;
  parent_tool_use_id: string | null;
  session_id?: string;
  uuid?: string;
}

export interface SDKResultMessage {
  type: "result";
  subtype: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  session_id?: string;
  uuid?: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
  };
  permission_denials: unknown[];
}

export type SDKMessage =
  | SDKSystemMessage
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKResultMessage;

// Chat message for user/assistant interactions (not part of SDKMessage)
export interface ChatMessage {
  type: "chat";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// Error message for streaming errors
export type ErrorMessage = {
  type: "error";
  subtype: "stream_error";
  message: string;
  timestamp: number;
};

// Abort message for aborted operations
export type AbortMessage = {
  type: "system";
  subtype: "abort";
  message: string;
  timestamp: number;
};

// Hooks message for hook execution notifications
export type HooksMessage = {
  type: "system";
  content: string;
  level?: string;
  toolUseID?: string;
};

// System message extending SDK types with timestamp
export type SystemMessage = (
  | SDKSystemMessage
  | SDKResultMessage
  | ErrorMessage
  | AbortMessage
  | HooksMessage
) & {
  timestamp: number;
};

// Tool message for tool usage display
export type ToolMessage = {
  type: "tool";
  content: string;
  timestamp: number;
};

// Tool result message for tool result display
export type ToolResultMessage = {
  type: "tool_result";
  toolName: string;
  content: string;
  summary: string;
  timestamp: number;
  toolUseResult?: unknown; // Contains structured data like structuredPatch, stdout, stderr etc.
};

// Plan approval dialog state
export interface PlanApprovalDialog {
  isOpen: boolean;
  plan: string;
  toolUseId: string;
}

// Plan message type for UI display
export interface PlanMessage {
  type: "plan";
  plan: string;
  toolUseId: string;
  timestamp: number;
}

// Thinking message for Claude's reasoning process
export interface ThinkingMessage {
  type: "thinking";
  content: string;
  timestamp: number;
}

// Todo item structure for TodoWrite tool results
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// Todo message for TodoWrite tool result display
export interface TodoMessage {
  type: "todo";
  todos: TodoItem[];
  timestamp: number;
}

// Thinking content item from Claude SDK
export interface ThinkingContentItem {
  type: "thinking";
  thinking: string;
}

// TimestampedSDKMessage types for conversation history API
// These extend Claude SDK types with timestamp information
type WithTimestamp<T> = T & { timestamp: string };

export type TimestampedSDKUserMessage = WithTimestamp<SDKUserMessage>;
export type TimestampedSDKAssistantMessage = WithTimestamp<SDKAssistantMessage>;
export type TimestampedSDKSystemMessage = WithTimestamp<SDKSystemMessage>;
export type TimestampedSDKResultMessage = WithTimestamp<SDKResultMessage>;

export type TimestampedSDKMessage =
  | TimestampedSDKUserMessage
  | TimestampedSDKAssistantMessage
  | TimestampedSDKSystemMessage
  | TimestampedSDKResultMessage;

export type AllMessage =
  | ChatMessage
  | SystemMessage
  | ToolMessage
  | ToolResultMessage
  | PlanMessage
  | ThinkingMessage
  | TodoMessage;

// Type guard functions
export function isChatMessage(message: AllMessage): message is ChatMessage {
  return message.type === "chat";
}

export function isSystemMessage(message: AllMessage): message is SystemMessage {
  return (
    message.type === "system" ||
    message.type === "result" ||
    message.type === "error"
  );
}

export function isToolMessage(message: AllMessage): message is ToolMessage {
  return message.type === "tool";
}

export function isToolResultMessage(
  message: AllMessage,
): message is ToolResultMessage {
  return message.type === "tool_result";
}

export function isPlanMessage(message: AllMessage): message is PlanMessage {
  return message.type === "plan";
}

export function isThinkingMessage(
  message: AllMessage,
): message is ThinkingMessage {
  return message.type === "thinking";
}

export function isTodoMessage(message: AllMessage): message is TodoMessage {
  return message.type === "todo";
}

// Permission mode types (UI-focused subset of SDK PermissionMode)
export type PermissionMode = "default" | "plan" | "acceptEdits";

// Chat state extensions for permission mode
export interface ChatStatePermissions {
  permissionMode: PermissionMode;
  planApprovalDialog: PlanApprovalDialog | null;
  setPermissionMode: (mode: PermissionMode) => void;
  showPlanApprovalDialog: (plan: string, toolUseId: string) => void;
  closePlanApprovalDialog: () => void;
  approvePlan: () => void;
  rejectPlan: () => void;
}

// Permission mode preference type
export interface PermissionModePreference {
  mode: PermissionMode;
  timestamp: number;
}

// Plan approval error types (simplified, realistic)
export interface PlanApprovalError {
  type: "user_rejected" | "network_error";
  message: string;
  canRetry: boolean;
}

export type PlanApprovalResult =
  | { success: true; sessionId: string }
  | { success: false; error: PlanApprovalError };

// Re-export shared types
export type {
  StreamResponse,
  ChatRequest,
  ProjectsResponse,
  ProjectInfo,
  AskUserQuestionItem,
  AskUserQuestionStreamResponse,
  InteractionResponse,
} from "../../shared/types";
