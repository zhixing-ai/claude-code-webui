import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresSessionStore } from "./postgres.ts";

describe("PostgresSessionStore", () => {
  it("writes opaque entries idempotently and reads them in database order", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ entry: { type: "user", uuid: "entry-1" } }],
      });
    const store = new PostgresSessionStore(
      { query } as unknown as Pool,
      "tenant_demo",
    );

    await store.append({ projectKey: "-workspace", sessionId: "session-1" }, [
      { type: "user", uuid: "entry-1" },
    ]);
    const entries = await store.load({
      projectKey: "-workspace",
      sessionId: "session-1",
    });

    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT DO NOTHING");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "-workspace",
      "session-1",
      null,
      '{"type":"user","uuid":"entry-1"}',
    ]);
    expect(entries).toEqual([{ type: "user", uuid: "entry-1" }]);
    expect(query.mock.calls[1]?.[0]).not.toContain("project_key");
    expect(query.mock.calls[1]?.[0]).toContain("subpath IS NULL");
    expect(query.mock.calls[1]?.[1]).toEqual(["session-1"]);
  });

  it("loads a subagent transcript with an indexable subpath equality", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ entry: { type: "user", uuid: "entry-1" } }],
    });
    const store = new PostgresSessionStore(
      { query } as unknown as Pool,
      "tenant_demo",
    );

    await expect(
      store.load({
        projectKey: "-workspace",
        sessionId: "session-1",
        subpath: "subagents/agent-1",
      }),
    ).resolves.toEqual([{ type: "user", uuid: "entry-1" }]);

    expect(query.mock.calls[0]?.[0]).not.toContain("IS NOT DISTINCT FROM");
    expect(query.mock.calls[0]?.[0]).toContain("subpath = $2");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "session-1",
      "subagents/agent-1",
    ]);
  });

  it("rejects an unsafe tenant schema", () => {
    expect(
      () =>
        new PostgresSessionStore(
          { query: vi.fn() } as unknown as Pool,
          "public; drop schema public",
        ),
    ).toThrow("Invalid session store schema");
  });

  it("retries a load once after a transient connection failure", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      )
      .mockResolvedValueOnce({
        rows: [{ entry: { type: "user", uuid: "entry-1" } }],
      });
    const store = new PostgresSessionStore(
      { query } as unknown as Pool,
      "tenant_demo",
    );

    await expect(
      store.load({ projectKey: "-workspace", sessionId: "session-1" }),
    ).resolves.toEqual([{ type: "user", uuid: "entry-1" }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-connection load failure", async () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "42501",
    });
    const query = vi.fn().mockRejectedValue(error);
    const store = new PostgresSessionStore(
      { query } as unknown as Pool,
      "tenant_demo",
    );

    await expect(
      store.load({ projectKey: "-workspace", sessionId: "session-1" }),
    ).rejects.toBe(error);
    expect(query).toHaveBeenCalledOnce();
  });

  it("lists sessions and subagents and deletes the requested scope", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            session_id: "session-1",
            mtime: new Date("2026-07-30T00:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ subpath: "subagents/agent-1" }] })
      .mockResolvedValue({ rows: [] });
    const store = new PostgresSessionStore(
      { query } as unknown as Pool,
      "tenant_demo",
    );

    await expect(store.listSessions("-workspace")).resolves.toEqual([
      {
        sessionId: "session-1",
        mtime: Date.parse("2026-07-30T00:00:00.000Z"),
      },
    ]);
    await expect(
      store.listSubkeys({
        projectKey: "-workspace",
        sessionId: "session-1",
      }),
    ).resolves.toEqual(["subagents/agent-1"]);
    expect(query.mock.calls[1]?.[1]).toEqual(["session-1"]);
    await store.delete({
      projectKey: "-workspace",
      sessionId: "session-1",
    });
    await store.delete({
      projectKey: "-workspace",
      sessionId: "session-1",
      subpath: "subagents/agent-1",
    });

    expect(query.mock.calls[2]?.[1]).toEqual(["-workspace", "session-1"]);
    expect(query.mock.calls[3]?.[1]).toEqual([
      "-workspace",
      "session-1",
      "subagents/agent-1",
    ]);
  });
});
