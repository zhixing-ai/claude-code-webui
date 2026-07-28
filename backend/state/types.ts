import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ChatRequest,
  InteractionResponse,
  StreamResponse,
} from "../../shared/types.ts";

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "interrupted";

export interface StoredRun {
  id: string;
  request: ChatRequest;
  sessionId?: string;
  status: RunStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRunEvent {
  sequence: number;
  event: StreamResponse;
}

export type InteractionStatus = "pending" | "answered" | "interrupted";

export interface StoredInteraction {
  id: string;
  runId: string;
  kind: "question" | "permission";
  input: unknown;
  response?: InteractionResponse;
  status: InteractionStatus;
}

export interface StoredSession {
  sessionId: string;
  cwd?: string;
  summary: string;
  createdAt: number;
  lastModified: number;
}

export interface AppStateStore extends SessionStore {
  createRun(runId: string, request: ChatRequest): void;
  finishRun(runId: string, status: RunStatus, error?: string): void;
  setRunSession(runId: string, sessionId: string): void;
  getRun(runId: string): StoredRun | undefined;
  appendRunEvent(runId: string, event: StreamResponse): number;
  getRunEvents(runId: string, after?: number): StoredRunEvent[];

  createInteraction(interaction: StoredInteraction): void;
  finishInteraction(
    interactionId: string,
    status: Exclude<InteractionStatus, "pending">,
    response?: InteractionResponse,
  ): void;
  getInteraction(interactionId: string): StoredInteraction | undefined;
  listPendingInteractions(runId: string): StoredInteraction[];

  upsertSession(
    sessionId: string,
    cwd: string | undefined,
    summary: string,
  ): void;
  listManagedSessions(): StoredSession[];
  getManagedSession(sessionId: string): StoredSession | undefined;

  close(): void;
}

export type TranscriptAppend = (
  key: SessionKey,
  entries: SessionStoreEntry[],
) => Promise<void>;
