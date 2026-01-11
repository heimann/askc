import { spawn } from "child_process";
import type { Backend, QueryResult, QueryCallbacks, QueryOptions } from "./types.js";
import type { ToolEvent } from "../db.js";

const SYSTEM_PROMPT = `You are a helpful terminal assistant. Answer the user's question concisely.

You have access to tools - USE THEM when helpful:
- websearch: Search the web for current information (weather, news, docs, etc.)
- webfetch: Fetch and read web pages
- bash: Run shell commands
- read/glob/grep: Search and read files

For questions about current events, weather, prices, or anything that requires up-to-date information, USE the websearch tool.
For questions about code or files, use the file tools.

Be direct and concise in your answers.`;

interface OpenCodeEvent {
  type: string;
  timestamp?: number;
  sessionID?: string;
  part?: {
    id?: string;
    type?: string;
    text?: string;
    name?: string;
    tool?: string;
    callID?: string;
    input?: Record<string, unknown>;
    output?: string;
    cost?: number;
    reason?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      title?: string;
    };
  };
}

export const opencodeBackend: Backend = {
  name: "opencode",

  async runQuery(question: string, callbacks: QueryCallbacks = {}, options: QueryOptions = {}): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      // Prepend system prompt to question
      const fullPrompt = `${SYSTEM_PROMPT}\n\nUser question: ${question}`;
      
      const proc = spawn("opencode", ["run", "--format", "json", fullPrompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Close stdin immediately since we don't need it
      proc.stdin?.end();

      let fullText = "";
      const toolEvents: ToolEvent[] = [];
      let cost: number | undefined;
      let buffer = "";

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event: OpenCodeEvent = JSON.parse(line);
            
            // Debug: emit raw event
            if (options.debug) {
              callbacks.onRawEvent?.(event);
            }
            
            handleEvent(event, callbacks, toolEvents, (text) => {
              fullText += text;
            }, (c) => {
              cost = c;
            });
          } catch {
            // Not valid JSON, ignore
          }
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.error(msg);
      });

      proc.on("close", (code) => {
        if (buffer.trim()) {
          try {
            const event: OpenCodeEvent = JSON.parse(buffer);
            
            if (options.debug) {
              callbacks.onRawEvent?.(event);
            }
            
            handleEvent(event, callbacks, toolEvents, (text) => {
              fullText += text;
            }, (c) => {
              cost = c;
            });
          } catch {
            // Ignore
          }
        }

        if (code !== 0) {
          reject(new Error(`opencode exited with code ${code}`));
          return;
        }

        resolve({
          answer: fullText.trim(),
          cost,
          toolEvents,
        });
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn opencode: ${err.message}`));
      });
    });
  },
};

function handleEvent(
  event: OpenCodeEvent,
  callbacks: QueryCallbacks,
  toolEvents: ToolEvent[],
  appendText: (text: string) => void,
  setCost: (cost: number) => void
): void {
  const part = event.part;
  if (!part) return;

  switch (event.type) {
    case "text":
      // Text content from the assistant
      if (part.text) {
        appendText(part.text);
        callbacks.onTextDelta?.(part.text);
      }
      break;

    case "thinking":
      // Thinking content
      if (part.text) {
        callbacks.onThinking?.(part.text);
      }
      break;

    case "tool_use":
      // Tool invocation - opencode format has tool name in part.tool
      const toolName = part.tool || part.name;
      const toolInput = part.state?.input || part.input || {};
      if (toolName) {
        toolEvents.push({
          type: "tool_use",
          tool: toolName,
          input: toolInput,
          id: part.callID || part.id,
        });
        callbacks.onToolUse?.(toolName, toolInput);
      }
      // If this is a completed tool call, also emit the result
      if (part.state?.status === "completed" && part.state?.output) {
        const resultId = part.callID || part.id || "";
        toolEvents.push({
          type: "tool_result",
          id: resultId,
          output: part.state.output.slice(0, 1000),
        });
        callbacks.onToolResult?.(resultId, part.state.output);
      }
      break;

    case "tool-call":
      // Alternative tool call format
      if (part.name) {
        toolEvents.push({
          type: "tool_use",
          tool: part.name,
          input: part.input || {},
          id: part.id,
        });
        callbacks.onToolUse?.(part.name, part.input || {});
      }
      break;

    case "tool-result":
      // Tool result
      if (part.id) {
        toolEvents.push({
          type: "tool_result",
          id: part.id,
          output: part.output?.slice(0, 1000),
        });
        callbacks.onToolResult?.(part.id, part.output || "");
      }
      break;

    case "step_finish":
      // Step finished, may contain cost
      if (part.cost !== undefined) {
        setCost(part.cost);
      }
      break;
  }
}
