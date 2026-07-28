import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

type SqlRow = Record<string, unknown>;

export class SqliteStateStore implements AppStateStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        request_json TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_events_run_sequence
        ON run_events(run_id, sequence);

      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        input_json TEXT NOT NULL,
        response_json TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS interactions_run_status
        ON interactions(run_id, status);

      CREATE TABLE IF NOT EXISTS managed_sessions (
        session_id TEXT PRIMARY KEY,
        cwd TEXT,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_modified INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcript_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subpath TEXT NOT NULL DEFAULT '',
        uuid TEXT,
        entry_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS transcript_entries_session
        ON transcript_entries(project_key, session_id, subpath, id);
      CREATE UNIQUE INDEX IF NOT EXISTS transcript_entries_uuid
        ON transcript_entries(project_key, session_id, subpath, uuid)
        WHERE uuid IS NOT NULL;

      CREATE TABLE IF NOT EXISTS transcript_sessions (
        project_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        PRIMARY KEY(project_key, session_id)
      );
    `);

    const now = new Date().toISOString();
    const interruptedRuns = this.db
      .prepare("SELECT id FROM runs WHERE status = 'running'")
      .all() as SqlRow[];
    const appendInterruptedEvent = this.db.prepare(
      "INSERT INTO run_events (run_id, event_json, created_at) VALUES (?, ?, ?)",
    );
    for (const run of interruptedRuns) {
      appendInterruptedEvent.run(
        String(run.id),
        JSON.stringify({
          type: "error",
          error: "Run interrupted by server restart",
        }),
        now,
      );
    }
    this.db
      .prepare(
        "UPDATE runs SET status = 'interrupted', updated_at = ? WHERE status = 'running'",
      )
      .run(now);
    this.db
      .prepare(
        "UPDATE interactions SET status = 'interrupted', updated_at = ? WHERE status = 'pending'",
      )
      .run(now);
  }

  createRun(runId: string, request: ChatRequest): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs
          (id, request_json, session_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(runId, JSON.stringify(request), request.sessionId ?? null, now, now);
  }

  finishRun(runId: string, status: RunStatus, error?: string): void {
    this.db
      .prepare(
        "UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, error ?? null, new Date().toISOString(), runId);
  }

  setRunSession(runId: string, sessionId: string): void {
    this.db
      .prepare("UPDATE runs SET session_id = ?, updated_at = ? WHERE id = ?")
      .run(sessionId, new Date().toISOString(), runId);
  }

  getRun(runId: string): StoredRun | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    return row ? this.readRun(row as SqlRow) : undefined;
  }

  appendRunEvent(runId: string, event: StreamResponse): number {
    const result = this.db
      .prepare(
        "INSERT INTO run_events (run_id, event_json, created_at) VALUES (?, ?, ?)",
      )
      .run(runId, JSON.stringify(event), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  getRunEvents(runId: string, after = 0): StoredRunEvent[] {
    const rows = this.db
      .prepare(
        `SELECT sequence, event_json
         FROM run_events
         WHERE run_id = ? AND sequence > ?
         ORDER BY sequence`,
      )
      .all(runId, after) as SqlRow[];
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      event: JSON.parse(String(row.event_json)) as StreamResponse,
    }));
  }

  createInteraction(interaction: StoredInteraction): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO interactions
          (id, run_id, kind, input_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        interaction.id,
        interaction.runId,
        interaction.kind,
        JSON.stringify(interaction.input),
        now,
        now,
      );
  }

  finishInteraction(
    interactionId: string,
    status: Exclude<InteractionStatus, "pending">,
    response?: InteractionResponse,
  ): void {
    this.db
      .prepare(
        `UPDATE interactions
         SET status = ?, response_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        response === undefined ? null : JSON.stringify(response),
        new Date().toISOString(),
        interactionId,
      );
  }

  getInteraction(interactionId: string): StoredInteraction | undefined {
    const row = this.db
      .prepare("SELECT * FROM interactions WHERE id = ?")
      .get(interactionId);
    return row ? this.readInteraction(row as SqlRow) : undefined;
  }

  listPendingInteractions(runId: string): StoredInteraction[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM interactions WHERE run_id = ? AND status = 'pending' ORDER BY created_at",
        )
        .all(runId) as SqlRow[]
    ).map((row) => this.readInteraction(row));
  }

  upsertSession(
    sessionId: string,
    cwd: string | undefined,
    summary: string,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO managed_sessions
          (session_id, cwd, summary, created_at, last_modified)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           cwd = COALESCE(excluded.cwd, managed_sessions.cwd),
           summary = CASE
             WHEN managed_sessions.summary = '' THEN excluded.summary
             ELSE managed_sessions.summary
           END,
           last_modified = excluded.last_modified`,
      )
      .run(sessionId, cwd ?? null, summary, now, now);
  }

  listManagedSessions(): StoredSession[] {
    return (
      this.db
        .prepare("SELECT * FROM managed_sessions ORDER BY last_modified DESC")
        .all() as SqlRow[]
    ).map((row) => this.readSession(row));
  }

  getManagedSession(sessionId: string): StoredSession | undefined {
    const row = this.db
      .prepare("SELECT * FROM managed_sessions WHERE session_id = ?")
      .get(sessionId);
    return row ? this.readSession(row as SqlRow) : undefined;
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const subpath = key.subpath ?? "";
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO transcript_entries
        (project_key, session_id, subpath, uuid, entry_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      for (const entry of entries) {
        insert.run(
          key.projectKey,
          key.sessionId,
          subpath,
          entry.uuid ?? null,
          JSON.stringify(entry),
          now,
        );
      }
      this.db
        .prepare(
          `INSERT INTO transcript_sessions (project_key, session_id, mtime)
           VALUES (?, ?, ?)
           ON CONFLICT(project_key, session_id)
           DO UPDATE SET mtime = excluded.mtime`,
        )
        .run(key.projectKey, key.sessionId, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const rows = this.db
      .prepare(
        `SELECT entry_json
         FROM transcript_entries
         WHERE project_key = ? AND session_id = ? AND subpath = ?
         ORDER BY id`,
      )
      .all(key.projectKey, key.sessionId, key.subpath ?? "") as SqlRow[];
    if (!rows.length) return null;
    return rows.map(
      (row) => JSON.parse(String(row.entry_json)) as SessionStoreEntry,
    );
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    return (
      this.db
        .prepare(
          `SELECT session_id, mtime
           FROM transcript_sessions
           WHERE project_key = ?
           ORDER BY mtime DESC`,
        )
        .all(projectKey) as SqlRow[]
    ).map((row) => ({
      sessionId: String(row.session_id),
      mtime: Number(row.mtime),
    }));
  }

  async delete(key: SessionKey): Promise<void> {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "DELETE FROM transcript_entries WHERE project_key = ? AND session_id = ?",
        )
        .run(key.projectKey, key.sessionId);
      this.db
        .prepare(
          "DELETE FROM transcript_sessions WHERE project_key = ? AND session_id = ?",
        )
        .run(key.projectKey, key.sessionId);
      this.db
        .prepare("DELETE FROM managed_sessions WHERE session_id = ?")
        .run(key.sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT subpath
         FROM transcript_entries
         WHERE project_key = ? AND session_id = ? AND subpath <> ''`,
      )
      .all(key.projectKey, key.sessionId) as SqlRow[];
    return rows.map((row) => String(row.subpath));
  }

  close(): void {
    this.db.close();
  }

  private readRun(row: SqlRow): StoredRun {
    return {
      id: String(row.id),
      request: JSON.parse(String(row.request_json)) as ChatRequest,
      ...(row.session_id ? { sessionId: String(row.session_id) } : {}),
      status: String(row.status) as RunStatus,
      ...(row.error ? { error: String(row.error) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private readInteraction(row: SqlRow): StoredInteraction {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      kind: String(row.kind) as StoredInteraction["kind"],
      input: JSON.parse(String(row.input_json)),
      ...(row.response_json
        ? {
            response: JSON.parse(
              String(row.response_json),
            ) as InteractionResponse,
          }
        : {}),
      status: String(row.status) as InteractionStatus,
    };
  }

  private readSession(row: SqlRow): StoredSession {
    return {
      sessionId: String(row.session_id),
      ...(row.cwd ? { cwd: String(row.cwd) } : {}),
      summary: String(row.summary),
      createdAt: Number(row.created_at),
      lastModified: Number(row.last_modified),
    };
  }
}
