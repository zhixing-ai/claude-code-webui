import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";

const IDENTIFIER = /^tenant_[a-z0-9_]+$/;

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    code.startsWith("08") ||
    [
      "57P01",
      "57P02",
      "57P03",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETRESET",
      "ENETUNREACH",
      "EPIPE",
      "ERR_STREAM_DESTROYED",
      "ETIMEDOUT",
    ].includes(code) ||
    /connection terminated|server closed the connection|query read timeout/i.test(
      error.message,
    )
  );
}

export class PostgresSessionStore implements SessionStore {
  private readonly table: string;

  constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    if (!IDENTIFIER.test(schema)) {
      throw new Error(`Invalid session store schema: ${schema}`);
    }
    this.table = `"${schema}"."claude_session_entries"`;
  }

  async assertReady(): Promise<void> {
    await this.pool.query(`SELECT 1 FROM ${this.table} LIMIT 0`);
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (!entries.length) return;
    const values: unknown[] = [
      key.projectKey,
      key.sessionId,
      key.subpath ?? null,
    ];
    const rows = entries.map((entry, index) => {
      values.push(JSON.stringify(entry));
      return `($1, $2, $3, $${index + 4}::jsonb)`;
    });
    await this.pool.query(
      `INSERT INTO ${this.table}
        (project_key, session_id, subpath, entry)
       VALUES ${rows.join(", ")}
       ON CONFLICT DO NOTHING`,
      values,
    );
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    // `subpath IS NOT DISTINCT FROM $2` is not an indexable qual: the planner
    // can only use session_id from claude_session_entries_session_idx, so a main
    // transcript load also reads every subagent row of that session and sorts
    // afterwards. Both branches below are index conditions on
    // (session_id, subpath, id) and already yield rows in id order.
    const subpath = key.subpath ?? null;
    const condition = subpath === null ? "subpath IS NULL" : "subpath = $2";
    const values =
      subpath === null ? [key.sessionId] : [key.sessionId, subpath];
    const query = () =>
      this.pool.query<{ entry: SessionStoreEntry }>(
        `SELECT entry
         FROM ${this.table}
         WHERE session_id = $1
           AND ${condition}
         ORDER BY id`,
        values,
      );
    let result;
    try {
      result = await query();
    } catch (error) {
      if (!isRetryableConnectionError(error)) throw error;
      result = await query();
    }
    return result.rows.length ? result.rows.map(({ entry }) => entry) : null;
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    const result = await this.pool.query<{
      session_id: string;
      mtime: Date;
    }>(
      `SELECT session_id, MAX(created_at) AS mtime
       FROM ${this.table}
       WHERE project_key = $1 AND subpath IS NULL
       GROUP BY session_id
       ORDER BY mtime DESC`,
      [projectKey],
    );
    return result.rows.map(({ session_id, mtime }) => ({
      sessionId: session_id,
      mtime: mtime.getTime(),
    }));
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath === undefined) {
      await this.pool.query(
        `DELETE FROM ${this.table}
         WHERE project_key = $1 AND session_id = $2`,
        [key.projectKey, key.sessionId],
      );
      return;
    }
    await this.pool.query(
      `DELETE FROM ${this.table}
       WHERE project_key = $1 AND session_id = $2 AND subpath = $3`,
      [key.projectKey, key.sessionId, key.subpath],
    );
  }

  async listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const result = await this.pool.query<{ subpath: string }>(
      `SELECT DISTINCT subpath
       FROM ${this.table}
       WHERE session_id = $1
         AND subpath IS NOT NULL`,
      [key.sessionId],
    );
    return result.rows.map(({ subpath }) => subpath);
  }
}
