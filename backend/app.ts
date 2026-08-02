/**
 * Runtime-agnostic Hono application
 *
 * This module creates the Hono application with all routes and middleware,
 * but doesn't include runtime-specific code like CLI parsing or server startup.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  InMemorySessionStore,
  type SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import type { Runtime } from "./runtime/types.ts";
import {
  type ConfigContext,
  createConfigMiddleware,
} from "./middleware/config.ts";
import {
  handleCreateProjectRequest,
  handleProjectsRequest,
} from "./handlers/projects.ts";
import { handleHistoriesRequest } from "./handlers/histories.ts";
import { handleConversationRequest } from "./handlers/conversations.ts";
import { ChatRunManager, handleChatRequest } from "./handlers/chat.ts";
import { handleAbortRequest } from "./handlers/abort.ts";
import {
  handleInteractionResponse,
  PendingInteractions,
} from "./handlers/interactions.ts";
import { logger } from "./utils/logger.ts";
import { readBinaryFile } from "./utils/fs.ts";
import type { RunStateStore } from "./state/types.ts";
import { MemoryRunStore } from "./state/memory.ts";
import {
  handleCreateRunRequest,
  handleInteractionRequest,
  handleRunEventsRequest,
  handleRunInteractionsRequest,
  handleRunRequest,
} from "./handlers/runs.ts";
import {
  handleResumeSessionRequest,
  handleSessionMessagesRequest,
  handleSessionsRequest,
} from "./handlers/sessions.ts";

export interface AppConfig {
  debugMode: boolean;
  staticPath: string;
  cliPath: string; // Actual CLI script path detected by validateClaudeCli
  runStore?: RunStateStore;
  sessionStore?: SessionStore;
}

export function createApp(
  runtime: Runtime,
  config: AppConfig,
): Hono<ConfigContext> {
  const app = new Hono<ConfigContext>();
  const runStore = config.runStore ?? new MemoryRunStore();
  const sessionStore = config.sessionStore ?? new InMemorySessionStore();

  // Store AbortControllers for each request (shared with chat handler)
  const requestAbortControllers = new Map<string, AbortController>();
  const interactions = new PendingInteractions(runStore);
  const runs = new ChatRunManager(
    config.cliPath,
    interactions,
    requestAbortControllers,
    runStore,
    sessionStore,
  );

  // CORS middleware
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  // Configuration middleware - makes app settings available to all handlers
  app.use(
    "*",
    createConfigMiddleware({
      debugMode: config.debugMode,
      runtime,
      cliPath: config.cliPath,
      runStore,
      sessionStore,
    }),
  );

  // API routes
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/projects", (c) => handleProjectsRequest(c));
  app.post("/api/projects", (c) => handleCreateProjectRequest(c));

  app.get("/api/projects/:encodedProjectName/histories", (c) =>
    handleHistoriesRequest(c),
  );

  app.get("/api/projects/:encodedProjectName/histories/:sessionId", (c) =>
    handleConversationRequest(c),
  );

  app.post("/api/abort/:requestId", (c) =>
    handleAbortRequest(c, requestAbortControllers),
  );
  app.post("/api/runs/:runId/cancel", (c) =>
    handleAbortRequest(c, requestAbortControllers),
  );

  app.post("/api/chat", (c) => handleChatRequest(c, runs));

  app.post("/api/runs", (c) => handleCreateRunRequest(c, runs));
  app.get("/api/runs/:runId", (c) => handleRunRequest(c, runStore));
  app.get("/api/runs/:runId/events", (c) =>
    handleRunEventsRequest(c, runs, runStore),
  );
  app.get("/api/runs/:runId/interactions", (c) =>
    handleRunInteractionsRequest(c, runStore),
  );

  app.get("/api/sessions", (c) => handleSessionsRequest(c, sessionStore));
  app.get("/api/sessions/:sessionId/messages", (c) =>
    handleSessionMessagesRequest(c, sessionStore),
  );
  app.post("/api/sessions/:sessionId/messages", (c) =>
    handleResumeSessionRequest(c, runs),
  );

  app.post("/api/interactions/:interactionId/respond", (c) =>
    handleInteractionResponse(c, interactions),
  );
  app.get("/api/interactions/:interactionId", (c) =>
    handleInteractionRequest(c, runStore),
  );

  // Static file serving with SPA fallback
  // Serve static assets (CSS, JS, images, etc.)
  const serveStatic = runtime.createStaticFileMiddleware({
    root: config.staticPath,
  });
  app.use("/assets/*", serveStatic);

  // SPA fallback - serve index.html for all unmatched routes (except API routes)
  app.get("*", async (c) => {
    const path = c.req.path;

    // Skip API routes
    if (path.startsWith("/api/")) {
      return c.text("Not found", 404);
    }

    try {
      const indexPath = `${config.staticPath}/index.html`;
      const indexFile = await readBinaryFile(indexPath);
      return c.html(new TextDecoder().decode(indexFile));
    } catch (error) {
      logger.app.error("Error serving index.html: {error}", { error });
      return c.text("Internal server error", 500);
    }
  });

  return app;
}
