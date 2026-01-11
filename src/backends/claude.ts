import { spawn } from "child_process";
import type { Backend, QueryResult, QueryCallbacks, QueryOptions } from "./types.js";
import type { ToolEvent } from "../db.js";

const SYSTEM_PROMPT = `You are a helpful terminal assistant. Answer the user's question concisely.

You have access to tools - USE THEM when helpful:
- For questions about current events, weather, prices, or anything requiring up-to-date information, search the web.
- For questions about code or files, use file tools.

Be direct and concise in your answers.`;

interface ClaudeResult {
  type: string;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  is_error?: boolean;
  error?: string;
}

export const claudeBackend: Backend = {
  name: "claude",

  async runQuery(question: string, callbacks: QueryCallbacks = {}, options: QueryOptions = {}): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      // Prepend system prompt to question
      const fullPrompt = `${SYSTEM_PROMPT}\n\nUser question: ${question}`;
      
      // Claude Code uses --output-format json for a single JSON result
      const proc = spawn("claude", ["--print", "--output-format", "json", fullPrompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      const toolEvents: ToolEvent[] = [];

      proc.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.error(msg);
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}`));
          return;
        }

        try {
          const result: ClaudeResult = JSON.parse(output.trim());
          
          if (result.is_error) {
            reject(new Error(result.error || "Unknown error"));
            return;
          }

          const answer = result.result || "";
          
          // Trigger the text callback with the full answer
          if (answer) {
            callbacks.onTextDelta?.(answer);
          }

          resolve({
            answer,
            cost: result.total_cost_usd,
            toolEvents,
          });
        } catch (err) {
          reject(new Error(`Failed to parse claude output: ${(err as Error).message}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  },
};
