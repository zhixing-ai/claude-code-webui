#!/usr/bin/env node
/**
 * Node.js-specific entry point
 *
 * This module handles Node.js-specific initialization including CLI argument parsing,
 * Claude CLI validation, and server startup using the NodeRuntime.
 */

import { createApp } from "../app.ts";
import { NodeRuntime } from "../runtime/node.ts";
import { parseCliArgs } from "./args.ts";
import { validateClaudeCli } from "./validation.ts";
import { setupLogger, logger } from "../utils/logger.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { exit } from "../utils/os.ts";
import { exists } from "../utils/fs.ts";
import {
  InMemorySessionStore,
  type SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import { Pool } from "pg";
import { MemoryRunStore } from "../state/memory.ts";
import { PostgresSessionStore } from "../state/postgres.ts";

async function main(runtime: NodeRuntime) {
  // Parse CLI arguments
  const args = parseCliArgs();

  // Initialize logging system
  await setupLogger(args.debug);

  if (args.debug) {
    logger.cli.info("🐛 Debug mode enabled");
  }

  // The Agent SDK ships a matching Claude Code binary. Only override it when
  // the operator explicitly supplies a compatible executable.
  const cliPath = args.claudePath
    ? await validateClaudeCli(runtime, args.claudePath)
    : undefined;
  if (!cliPath) {
    logger.cli.info("Using the Claude Code binary bundled with Agent SDK");
  }
  const fdeSuitePluginDir = await realpath(args.fdeSuitePluginDir);
  const pluginManifest = JSON.parse(
    await readFile(
      join(fdeSuitePluginDir, ".claude-plugin", "plugin.json"),
      "utf8",
    ),
  ) as { name?: unknown };
  if (pluginManifest.name !== "fde-suite") {
    throw new Error(`Expected fde-suite plugin at ${fdeSuitePluginDir}`);
  }

  // Use absolute path for static files (supported in @hono/node-server v1.17.0+)
  // Node.js 20.11.0+ compatible with fallback for older versions
  const __dirname =
    import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const bundledStaticPath = join(__dirname, "../static");
  const developmentStaticPath = join(__dirname, "../../frontend/dist");
  const staticPath = (await exists(bundledStaticPath))
    ? bundledStaticPath
    : (await exists(developmentStaticPath))
      ? developmentStaticPath
      : undefined;
  const runStore = new MemoryRunStore();
  const databaseUrl =
    process.env.CLAUDE_CODE_BACKEND_SESSION_STORE_DATABASE_URL;
  const schema = process.env.CLAUDE_CODE_BACKEND_SESSION_STORE_SCHEMA;
  if (Boolean(databaseUrl) !== Boolean(schema)) {
    throw new Error(
      "Builder session store database URL and schema must be configured together",
    );
  }
  let sessionStore: SessionStore = new InMemorySessionStore();
  if (databaseUrl && schema) {
    const pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 20_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      max: 5,
      query_timeout: 30_000,
    });
    pool.on("error", (error) => {
      logger.cli.error("PostgreSQL session store error: {error}", { error });
    });
    const postgres = new PostgresSessionStore(pool, schema);
    await postgres.assertReady();
    sessionStore = postgres;
  }

  // Create application
  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath,
    fdeSuitePluginDir,
    runStore,
    sessionStore,
  });

  // Start server (only show this message when everything is ready)
  logger.cli.info(`🚀 Server starting on ${args.host}:${args.port}`);
  runtime.serve(args.port, args.host, app.fetch);
}

// Run the application
const runtime = new NodeRuntime();
main(runtime).catch((error) => {
  // Logger may not be initialized yet, so use console.error
  console.error("Failed to start server:", error);
  exit(1);
});
