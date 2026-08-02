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
  cliPath: string; // Path to actual CLI script detected by validateClaudeCli
  runStore?: RunStateStore;
  sessionStore?: SessionStore;
}
