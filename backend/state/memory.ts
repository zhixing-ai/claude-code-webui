import type {
  ChatRequest,
  InteractionResponse,
  StreamResponse,
} from "../../shared/types.ts";
import type {
  InteractionStatus,
  RunStateStore,
  RunStatus,
  StoredInteraction,
  StoredRun,
  StoredRunEvent,
} from "./types.ts";

const copy = <T>(value: T): T => structuredClone(value);

export class MemoryRunStore implements RunStateStore {
  private readonly runs = new Map<string, StoredRun>();
  private readonly events = new Map<string, StoredRunEvent[]>();
  private readonly interactions = new Map<string, StoredInteraction>();
  private nextSequence = 1;

  createRun(runId: string, request: ChatRequest): void {
    if (this.runs.has(runId)) throw new Error(`Run already exists: ${runId}`);
    const now = new Date().toISOString();
    this.runs.set(runId, {
      id: runId,
      request: copy(request),
      ...(request.sessionId || request.newSessionId
        ? { sessionId: request.sessionId ?? request.newSessionId }
        : {}),
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
  }

  finishRun(runId: string, status: RunStatus, error?: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.set(runId, {
      ...run,
      status,
      ...(error === undefined ? {} : { error }),
      updatedAt: new Date().toISOString(),
    });
  }

  setRunSession(runId: string, sessionId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.set(runId, {
      ...run,
      sessionId,
      updatedAt: new Date().toISOString(),
    });
  }

  getRun(runId: string): StoredRun | undefined {
    const run = this.runs.get(runId);
    return run ? copy(run) : undefined;
  }

  appendRunEvent(runId: string, event: StreamResponse): number {
    const stored = { sequence: this.nextSequence++, event: copy(event) };
    const events = this.events.get(runId) ?? [];
    events.push(stored);
    this.events.set(runId, events);
    return stored.sequence;
  }

  getRunEvents(runId: string, after = 0): StoredRunEvent[] {
    return copy(
      (this.events.get(runId) ?? []).filter(({ sequence }) => sequence > after),
    );
  }

  createInteraction(interaction: StoredInteraction): void {
    if (this.interactions.has(interaction.id)) {
      throw new Error(`Interaction already exists: ${interaction.id}`);
    }
    this.interactions.set(interaction.id, copy(interaction));
  }

  finishInteraction(
    interactionId: string,
    status: Exclude<InteractionStatus, "pending">,
    response?: InteractionResponse,
  ): void {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) return;
    this.interactions.set(interactionId, {
      ...interaction,
      status,
      ...(response === undefined ? {} : { response: copy(response) }),
    });
  }

  getInteraction(interactionId: string): StoredInteraction | undefined {
    const interaction = this.interactions.get(interactionId);
    return interaction ? copy(interaction) : undefined;
  }

  listPendingInteractions(runId: string): StoredInteraction[] {
    return copy(
      [...this.interactions.values()].filter(
        (interaction) =>
          interaction.runId === runId && interaction.status === "pending",
      ),
    );
  }
}
