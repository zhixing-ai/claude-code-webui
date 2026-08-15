/**
 * Backend-specific type definitions
 */

import type { Runtime } from "./runtime/types.ts";
import type { RunStateStore } from "./state/types.ts";
import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";

// Application configuration shared across backend handlers
export interface AppConfig {
  debugMode: boolean;
  runtime: Runtime;
  cliPath?: string; // Explicit compatible Claude Code override; SDK binary is the default
  fdeSuitePluginDir?: string;
  runStore?: RunStateStore;
  sessionStore?: SessionStore;
}
