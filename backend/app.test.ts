import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Runtime } from "./runtime/types.ts";

const runtime: Runtime = {
  async runCommand() {
    return { success: true, stdout: "", stderr: "", code: 0 };
  },
  async findExecutable() {
    return [];
  },
  serve() {},
  createStaticFileMiddleware() {
    return async (_c, next) => next();
  },
};

describe("GET /api/health", () => {
  it("returns a CORS-enabled readiness response", async () => {
    const response = await createApp(runtime, {
      debugMode: false,
      staticPath: "",
      cliPath: "claude",
    }).request("/api/health", {
      headers: { Origin: "https://app.example.com" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
