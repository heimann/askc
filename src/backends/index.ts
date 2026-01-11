export type { Backend, BackendType, QueryResult, QueryCallbacks } from "./types.js";
export { opencodeBackend } from "./opencode.js";
export { piBackend } from "./pi.js";
export { claudeBackend } from "./claude.js";

import type { Backend, BackendType } from "./types.js";
import { opencodeBackend } from "./opencode.js";
import { piBackend } from "./pi.js";
import { claudeBackend } from "./claude.js";

const backends: Record<BackendType, Backend> = {
  opencode: opencodeBackend,
  pi: piBackend,
  claude: claudeBackend,
};

export function getBackend(name: BackendType): Backend {
  const backend = backends[name];
  if (!backend) {
    throw new Error(`Unknown backend: ${name}`);
  }
  return backend;
}

export function getDefaultBackend(): BackendType {
  // Check for ASKC_BACKEND env var first
  const envBackend = process.env.ASKC_BACKEND as BackendType | undefined;
  if (envBackend && backends[envBackend]) {
    return envBackend;
  }
  
  // Default to opencode
  return "opencode";
}
