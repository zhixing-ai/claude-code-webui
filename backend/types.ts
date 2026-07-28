/**
 * Backend-specific type definitions
 */

import type { Runtime } from "./runtime/types.ts";
import type { AppStateStore } from "./state/types.ts";

// Application configuration shared across backend handlers
export interface AppConfig {
  debugMode: boolean;
  runtime: Runtime;
  cliPath: string; // Path to actual CLI script detected by validateClaudeCli
  stateStore?: AppStateStore;
}
