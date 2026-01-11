import type { ToolEvent } from "../db.js";

export type BackendType = "opencode" | "pi" | "claude";

export interface QueryResult {
  answer: string;
  suggestedCommand?: string;
  suggestedScript?: string;
  cost?: number;
  toolEvents: ToolEvent[];
}

export interface QueryCallbacks {
  onToolUse?: (tool: string, input: Record<string, unknown>) => void;
  onToolResult?: (toolId: string, output: string) => void;
  onTextDelta?: (delta: string) => void;
  onThinking?: (thinking: string) => void;
  onRawEvent?: (event: unknown) => void;
}

export interface QueryOptions {
  debug?: boolean;
}

export interface Backend {
  name: BackendType;
  runQuery(question: string, callbacks?: QueryCallbacks, options?: QueryOptions): Promise<QueryResult>;
}
