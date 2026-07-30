import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import type {
  SessionKey,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ChatRequest,
  InteractionResponse,
  StreamResponse,
} from "../../shared/types.ts";
import type {
  AppStateStore,
  InteractionStatus,
  RunStatus,
  StoredInteraction,
  StoredRun,
  StoredRunEvent,
  StoredSession,
} from "./types.ts";

const VERSION = 1 as const;
const RESTART_ERROR = "Run interrupted by server restart";
const LEASE_TIMEOUT_MS = 15_000;
const LEASE_HEARTBEAT_MS = 5_000;
const JOURNAL_LOCK_WAIT_MS = 35_000;
const LOCK_RETRY_MS = 25;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

type JournalRecord =
  | { version: 1; type: "run"; value: StoredRun }
  | { version: 1; type: "run_event"; runId: string; value: StoredRunEvent }
  | { version: 1; type: "interaction"; value: StoredInteraction }
  | { version: 1; type: "session"; value: StoredSession }
  | {
      version: 1;
      type: "transcript_append";
      key: SessionKey;
      entries: SessionStoreEntry[];
      mtime: number;
    }
  | {
      version: 1;
      type: "transcript_delete";
      projectKey: string;
      sessionId: string;
    }
  | {
      version: 1;
      type: "restart";
      at: string;
      runs: Array<{ runId: string; sequence: number }>;
      interactionIds: string[];
    };

type TranscriptSession = {
  projectKey: string;
  sessionId: string;
  mtime: number;
};

type LeaseOwner = {
  token: string;
  host: string;
  pid: number;
};

const copy = <T>(value: T): T => structuredClone(value);
const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;
const transcriptKey = (key: SessionKey) =>
  JSON.stringify([key.projectKey, key.sessionId, key.subpath ?? ""]);
const transcriptSessionKey = (projectKey: string, sessionId: string) =>
  JSON.stringify([projectKey, sessionId]);

export class FileStateStore implements AppStateStore {
  private readonly journalPath: string;
  private readonly journalLockDirectory: string;
  private readonly journalLockOwnerPath: string;
  private readonly leaseDirectory: string;
  private readonly leaseOwnerPath: string;
  private readonly leaseOwner: LeaseOwner = {
    token: randomUUID(),
    host: hostname(),
    pid: process.pid,
  };
  private readonly runs = new Map<string, StoredRun>();
  private readonly events = new Map<string, StoredRunEvent[]>();
  private readonly interactions = new Map<string, StoredInteraction>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly transcripts = new Map<string, SessionStoreEntry[]>();
  private readonly transcriptKeys = new Map<string, SessionKey>();
  private readonly transcriptSessions = new Map<string, TranscriptSession>();
  private nextSequence = 1;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private leaseLost = false;
  private readonly onProcessExit = () => this.releaseLease();

  // ponytail: the journal remains uncompacted until measured growth requires it.
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.journalPath = join(directory, "state.ndjson");
    this.journalLockDirectory = join(directory, "journal.lock");
    this.journalLockOwnerPath = join(this.journalLockDirectory, "owner.json");
    this.leaseDirectory = join(directory, "writer.lock");
    this.leaseOwnerPath = join(this.leaseDirectory, "owner.json");
    this.acquireLease();
    try {
      this.withJournalLock(() => this.loadJournal());
      this.interruptUnfinishedWork();
    } catch (error) {
      this.releaseLease();
      throw error;
    }
    this.heartbeat = setInterval(() => this.refreshLease(), LEASE_HEARTBEAT_MS);
    this.heartbeat.unref();
    process.once("exit", this.onProcessExit);
  }

  createRun(runId: string, request: ChatRequest): void {
    if (this.runs.has(runId)) throw new Error(`Run already exists: ${runId}`);
    const now = new Date().toISOString();
    this.commit({
      version: VERSION,
      type: "run",
      value: {
        id: runId,
        request,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        status: "running",
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  finishRun(runId: string, status: RunStatus, error?: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const value: StoredRun = {
      ...run,
      status,
      updatedAt: new Date().toISOString(),
    };
    delete value.error;
    if (error !== undefined) value.error = error;
    this.commit({ version: VERSION, type: "run", value });
  }

  setRunSession(runId: string, sessionId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.commit({
      version: VERSION,
      type: "run",
      value: {
        ...run,
        sessionId,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  getRun(runId: string): StoredRun | undefined {
    const run = this.runs.get(runId);
    return run ? copy(run) : undefined;
  }

  appendRunEvent(runId: string, event: StreamResponse): number {
    const value = { sequence: this.nextSequence, event };
    this.commit({ version: VERSION, type: "run_event", runId, value });
    return value.sequence;
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
    this.commit({
      version: VERSION,
      type: "interaction",
      value: { ...interaction, status: "pending" },
    });
  }

  finishInteraction(
    interactionId: string,
    status: Exclude<InteractionStatus, "pending">,
    response?: InteractionResponse,
  ): void {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) return;
    const value: StoredInteraction = { ...interaction, status };
    delete value.response;
    if (response !== undefined) value.response = response;
    this.commit({ version: VERSION, type: "interaction", value });
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

  upsertSession(
    sessionId: string,
    cwd: string | undefined,
    summary: string,
  ): void {
    const existing = this.sessions.get(sessionId);
    const now = Date.now();
    this.commit({
      version: VERSION,
      type: "session",
      value: existing
        ? {
            ...existing,
            ...(cwd === undefined ? {} : { cwd }),
            summary: existing.summary === "" ? summary : existing.summary,
            lastModified: now,
          }
        : {
            sessionId,
            ...(cwd === undefined ? {} : { cwd }),
            summary,
            createdAt: now,
            lastModified: now,
          },
    });
  }

  listManagedSessions(): StoredSession[] {
    return copy(
      [...this.sessions.values()].sort(
        (left, right) => right.lastModified - left.lastModified,
      ),
    );
  }

  getManagedSession(sessionId: string): StoredSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? copy(session) : undefined;
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const existing = this.transcripts.get(transcriptKey(key)) ?? [];
    const uuids = new Set(
      existing.flatMap((entry) =>
        entry.uuid === undefined ? [] : [entry.uuid],
      ),
    );
    const uniqueEntries = entries.filter((entry) => {
      if (entry.uuid === undefined) return true;
      if (uuids.has(entry.uuid)) return false;
      uuids.add(entry.uuid);
      return true;
    });
    this.commit({
      version: VERSION,
      type: "transcript_append",
      key,
      entries: uniqueEntries,
      mtime: Date.now(),
    });
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const entries = this.transcripts.get(transcriptKey(key));
    return entries?.length ? copy(entries) : null;
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    return [...this.transcriptSessions.values()]
      .filter((session) => session.projectKey === projectKey)
      .sort((left, right) => right.mtime - left.mtime)
      .map(({ sessionId, mtime }) => ({ sessionId, mtime }));
  }

  async delete(key: SessionKey): Promise<void> {
    this.commit({
      version: VERSION,
      type: "transcript_delete",
      projectKey: key.projectKey,
      sessionId: key.sessionId,
    });
  }

  async listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    return [...this.transcriptKeys.values()]
      .filter(
        (candidate) =>
          candidate.projectKey === key.projectKey &&
          candidate.sessionId === key.sessionId &&
          candidate.subpath,
      )
      .map((candidate) => candidate.subpath!);
  }

  close(): void {
    this.releaseLease();
  }

  private commit(record: JournalRecord): void {
    this.withJournalLock(() => {
      this.assertLease();
      const serialized = JSON.stringify(record);
      appendFileSync(this.journalPath, `${serialized}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.apply(JSON.parse(serialized) as JournalRecord);
    });
  }

  private loadJournal(): void {
    if (!existsSync(this.journalPath)) return;
    const source = readFileSync(this.journalPath, "utf8");
    const lines = source.split("\n");
    const hasTrailingNewline = source.endsWith("\n");
    if (hasTrailingNewline) lines.pop();

    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      let record: JournalRecord;
      try {
        record = JSON.parse(line) as JournalRecord;
      } catch (error) {
        if (!hasTrailingNewline && index === lines.length - 1) {
          const validPrefix = source.slice(0, source.lastIndexOf("\n") + 1);
          truncateSync(
            this.journalPath,
            Buffer.byteLength(validPrefix, "utf8"),
          );
          return;
        }
        throw new Error(`Invalid state journal line ${index + 1}`, {
          cause: error,
        });
      }
      this.apply(record);
    }

    if (source && !hasTrailingNewline) appendFileSync(this.journalPath, "\n");
  }

  private apply(record: JournalRecord): void {
    if (record.version !== VERSION) {
      throw new Error(`Unsupported state journal version: ${record.version}`);
    }
    switch (record.type) {
      case "run":
        this.runs.set(record.value.id, record.value);
        return;
      case "run_event": {
        const events = this.events.get(record.runId) ?? [];
        events.push(record.value);
        this.events.set(record.runId, events);
        this.nextSequence = Math.max(
          this.nextSequence,
          record.value.sequence + 1,
        );
        return;
      }
      case "interaction":
        this.interactions.set(record.value.id, record.value);
        return;
      case "session":
        this.sessions.set(record.value.sessionId, record.value);
        return;
      case "transcript_append": {
        const id = transcriptKey(record.key);
        const entries = this.transcripts.get(id) ?? [];
        entries.push(...record.entries);
        this.transcripts.set(id, entries);
        this.transcriptKeys.set(id, record.key);
        this.transcriptSessions.set(
          transcriptSessionKey(record.key.projectKey, record.key.sessionId),
          {
            projectKey: record.key.projectKey,
            sessionId: record.key.sessionId,
            mtime: record.mtime,
          },
        );
        return;
      }
      case "transcript_delete":
        for (const [id, key] of this.transcriptKeys) {
          if (
            key.projectKey === record.projectKey &&
            key.sessionId === record.sessionId
          ) {
            this.transcripts.delete(id);
            this.transcriptKeys.delete(id);
          }
        }
        this.transcriptSessions.delete(
          transcriptSessionKey(record.projectKey, record.sessionId),
        );
        this.sessions.delete(record.sessionId);
        return;
      case "restart":
        for (const { runId, sequence } of record.runs) {
          const run = this.runs.get(runId);
          if (!run) continue;
          this.runs.set(runId, {
            ...run,
            status: "interrupted",
            updatedAt: record.at,
          });
          const events = this.events.get(runId) ?? [];
          events.push({
            sequence,
            event: { type: "error", error: RESTART_ERROR },
          });
          this.events.set(runId, events);
          this.nextSequence = Math.max(this.nextSequence, sequence + 1);
        }
        for (const interactionId of record.interactionIds) {
          const interaction = this.interactions.get(interactionId);
          if (interaction) {
            this.interactions.set(interactionId, {
              ...interaction,
              status: "interrupted",
            });
          }
        }
        return;
      default:
        throw new Error(
          `Unsupported state journal record type: ${String(
            (record as { type?: unknown }).type,
          )}`,
        );
    }
  }

  private interruptUnfinishedWork(): void {
    let sequence = this.nextSequence;
    const runs = [...this.runs.values()]
      .filter((run) => run.status === "running")
      .map((run) => ({ runId: run.id, sequence: sequence++ }));
    const interactionIds = [...this.interactions.values()]
      .filter((interaction) => interaction.status === "pending")
      .map((interaction) => interaction.id);
    if (!runs.length && !interactionIds.length) return;
    this.commit({
      version: VERSION,
      type: "restart",
      at: new Date().toISOString(),
      runs,
      interactionIds,
    });
  }

  private acquireLease(): void {
    this.acquireDirectoryLock(
      this.leaseDirectory,
      this.leaseOwnerPath,
      this.leaseOwner,
      LEASE_TIMEOUT_MS,
      0,
      `State directory is already in use: ${this.leaseDirectory}`,
    );
  }

  private isLockStale(
    directory: string,
    ownerPath: string,
    staleAfter: number,
  ): boolean {
    const owner = this.readOwner(ownerPath);
    let expired: boolean;
    try {
      const path = existsSync(ownerPath) ? ownerPath : directory;
      expired = Date.now() - statSync(path).mtimeMs > staleAfter;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return true;
      throw error;
    }
    if (owner?.host !== this.leaseOwner.host) return expired;
    try {
      process.kill(owner.pid, 0);
      return expired;
    } catch (error) {
      return hasCode(error, "ESRCH") || expired;
    }
  }

  private readOwner(path: string): LeaseOwner | undefined {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        token?: unknown;
        host?: unknown;
        pid?: unknown;
      };
      return typeof value.token === "string" &&
        typeof value.host === "string" &&
        typeof value.pid === "number"
        ? { token: value.token, host: value.host, pid: value.pid }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private assertLease(): void {
    if (
      this.closed ||
      this.leaseLost ||
      this.readOwner(this.leaseOwnerPath)?.token !== this.leaseOwner.token
    ) {
      this.leaseLost = true;
      throw new Error("State directory writer lease was lost");
    }
  }

  private refreshLease(): void {
    try {
      this.assertLease();
      const now = new Date();
      utimesSync(this.leaseOwnerPath, now, now);
    } catch {
      this.leaseLost = true;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private releaseLease(): void {
    if (this.closed) return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    process.off("exit", this.onProcessExit);
    this.closed = true;
    this.releaseDirectoryLock(
      this.leaseDirectory,
      this.leaseOwnerPath,
      this.leaseOwner,
    );
  }

  private withJournalLock<T>(operation: () => T): T {
    const owner = {
      token: randomUUID(),
      host: this.leaseOwner.host,
      pid: this.leaseOwner.pid,
    };
    this.acquireDirectoryLock(
      this.journalLockDirectory,
      this.journalLockOwnerPath,
      owner,
      Number.POSITIVE_INFINITY,
      JOURNAL_LOCK_WAIT_MS,
      "Timed out waiting for the state journal lock",
    );
    try {
      return operation();
    } finally {
      this.releaseDirectoryLock(
        this.journalLockDirectory,
        this.journalLockOwnerPath,
        owner,
      );
    }
  }

  private acquireDirectoryLock(
    directory: string,
    ownerPath: string,
    owner: LeaseOwner,
    staleAfter: number,
    waitFor: number,
    busyMessage: string,
  ): void {
    const deadline = Date.now() + waitFor;
    for (;;) {
      try {
        mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        if (this.isLockStale(directory, ownerPath, staleAfter)) {
          const staleDirectory = `${directory}.stale-${randomUUID()}`;
          try {
            renameSync(directory, staleDirectory);
          } catch (renameError) {
            if (hasCode(renameError, "ENOENT")) continue;
            throw renameError;
          }
          rmSync(staleDirectory, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new Error(busyMessage);
        Atomics.wait(sleepBuffer, 0, 0, LOCK_RETRY_MS);
        continue;
      }

      try {
        writeFileSync(ownerPath, JSON.stringify(owner), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        return;
      } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
    }
  }

  private releaseDirectoryLock(
    directory: string,
    ownerPath: string,
    owner: LeaseOwner,
  ): void {
    if (this.readOwner(ownerPath)?.token !== owner.token) return;
    const releasedDirectory = `${directory}.released-${owner.token}`;
    try {
      renameSync(directory, releasedDirectory);
      rmSync(releasedDirectory, { recursive: true, force: true });
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
}
