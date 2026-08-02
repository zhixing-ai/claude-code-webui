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

export interface RunStateStore {
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
}
