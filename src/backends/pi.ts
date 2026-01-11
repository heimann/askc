import { spawn } from "child_process";
import type { Backend, QueryResult, QueryCallbacks, QueryOptions } from "./types.js";
import type { ToolEvent } from "../db.js";

const SYSTEM_PROMPT = `You are a helpful terminal assistant. Answer the user's question concisely.

You have access to tools - USE THEM when helpful:
- For questions about current events, weather, prices, or anything requiring up-to-date information, search the web.
- For questions about code or files, use file tools.

Be direct and concise in your answers.`;

interface PiEvent {
  type: string;
  [key: string]: unknown;
}

export const piBackend: Backend = {
  name: "pi",

  async runQuery(question: string, callbacks: QueryCallbacks = {}, options: QueryOptions = {}): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      // Prepend system prompt to question
      const fullPrompt = `${SYSTEM_PROMPT}\n\nUser question: ${question}`;
      
      // Pi uses --mode json for streaming JSON events
      const proc = spawn("pi", ["--mode", "json", "--print", fullPrompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });

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
            const event: PiEvent = JSON.parse(line);
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
            const event: PiEvent = JSON.parse(buffer);
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
          reject(new Error(`pi exited with code ${code}`));
          return;
        }

        resolve({
          answer: fullText.trim(),
          cost,
          toolEvents,
        });
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn pi: ${err.message}`));
      });
    });
  },
};

function handleEvent(
  event: PiEvent,
  callbacks: QueryCallbacks,
  toolEvents: ToolEvent[],
  appendText: (text: string) => void,
  setCost: (cost: number) => void
): void {
  // Pi event types based on the RPC documentation
  switch (event.type) {
    case "text":
      const text = event.text as string;
      if (text) {
        appendText(text);
        callbacks.onTextDelta?.(text);
      }
      break;

    case "thinking":
      const thinking = event.text as string;
      if (thinking) {
        callbacks.onThinking?.(thinking);
      }
      break;

    case "tool_use":
      const toolName = event.name as string;
      const toolInput = event.input as Record<string, unknown>;
      const toolId = event.id as string;
      if (toolName) {
        toolEvents.push({
          type: "tool_use",
          tool: toolName,
          input: toolInput,
          id: toolId,
        });
        callbacks.onToolUse?.(toolName, toolInput || {});
      }
      break;

    case "tool_result":
      const resultId = event.tool_use_id as string;
      const output = event.content as string;
      if (resultId) {
        toolEvents.push({
          type: "tool_result",
          id: resultId,
          output: output?.slice(0, 1000),
        });
        callbacks.onToolResult?.(resultId, output || "");
      }
      break;

    case "usage":
      const totalCost = event.total_cost_usd as number;
      if (totalCost !== undefined) {
        setCost(totalCost);
      }
      break;

    case "done":
      // Final event, cost may be here
      if (event.total_cost_usd !== undefined) {
        setCost(event.total_cost_usd as number);
      }
      break;
  }
}
