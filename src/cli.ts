#!/usr/bin/env bun
import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, unlinkSync, readFileSync } from "fs";

import { getBackend, getDefaultBackend, type BackendType } from "./backends/index.js";
import { logQuery, getDailyUsage, getTotalUsage, getQueryById, getRecentQueries } from "./db.js";

const SPINNERS = ["dots", "dots2", "dots3", "line", "arc", "moon", "arrow3", "bouncingBar"] as const;

const FINISHING_MESSAGES = [
  "Wrapping up",
  "Almost there",
  "Finishing touches",
  "Polishing response",
  "Just a moment",
  "Final thoughts",
  "Tidying up",
  "Nearly done",
  "Last step",
  "Composing answer",
  "Pulling it together",
  "Home stretch",
  "Final pass",
  "Quick review",
  "Packaging response",
  "Cooking up answer",
];

function getQuestionFromEditor(): string | null {
  const editor = process.env.EDITOR || process.env.VISUAL || "vim";
  const tmpFile = join(tmpdir(), `askc-${Date.now()}.md`);

  writeFileSync(tmpFile, "");

  try {
    spawnSync(editor, [tmpFile], { stdio: "inherit" });
    const content = readFileSync(tmpFile, "utf-8").trim();
    return content || null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore
    }
  }
}

// Human-friendly tool descriptions for spinner
const TOOL_DESCRIPTIONS: Record<string, string> = {
  websearch: "Searching the web",
  codesearch: "Searching code",
  webfetch: "Fetching webpage",
  bash: "Running command",
  read: "Reading file",
  glob: "Finding files",
  grep: "Searching files",
  edit: "Editing file",
  write: "Writing file",
  task: "Running task",
};

function formatToolCall(tool: string, input: Record<string, unknown>): string {
  const toolLower = tool.toLowerCase();
  const description = TOOL_DESCRIPTIONS[toolLower] || tool;
  let detail = "";

  switch (toolLower) {
    case "bash":
      detail = (input.command as string || "").slice(0, 40);
      break;
    case "read":
      detail = (input.file_path as string || input.filePath as string || "").split("/").pop() || "";
      break;
    case "glob":
    case "grep":
      detail = (input.pattern as string || "").slice(0, 30);
      break;
    case "websearch":
    case "codesearch":
      detail = (input.query as string || "").slice(0, 35);
      break;
    case "webfetch":
      detail = (input.url as string || "").slice(0, 40);
      break;
    default:
      const inputStr = JSON.stringify(input);
      if (inputStr.length > 2) {
        detail = inputStr.slice(0, 40);
      }
  }

  if (detail) {
    return `${chalk.cyan(description)}: ${chalk.dim(detail)}`;
  }
  return chalk.cyan(description + "...");
}

async function runInteractive(question: string, backendName: BackendType, debug: boolean = false): Promise<void> {
  const backend = getBackend(backendName);
  const spinner = ora({ text: chalk.cyan("Thinking..."), spinner: "dots" }).start();
  let spinnerIdx = 0;
  let fullAnswer = "";
  let receivedFirstText = false;

  if (debug) {
    spinner.stop();
    console.log(chalk.yellow("[DEBUG] Starting query with backend:"), backendName);
    console.log(chalk.yellow("[DEBUG] Question:"), question);
    console.log(chalk.yellow("[DEBUG] Events:"));
  }

  try {
    const result = await backend.runQuery(question, {
      onToolUse(tool, input) {
        if (debug) {
          console.log(chalk.cyan(`[TOOL_USE] ${tool}`), JSON.stringify(input, null, 2));
        } else {
          spinnerIdx = (spinnerIdx + 1) % SPINNERS.length;
          spinner.spinner = SPINNERS[spinnerIdx];
          spinner.text = formatToolCall(tool, input);
        }
      },
      onToolResult(toolId, output) {
        if (debug) {
          console.log(chalk.green(`[TOOL_RESULT] ${toolId}`), output?.slice(0, 200));
        }
        // Don't change spinner text on result - keep showing the tool name
        // The tool name is more informative than a truncated result preview
      },
      onTextDelta(delta) {
        if (debug) {
          console.log(chalk.blue(`[TEXT]`), delta.slice(0, 100));
        } else {
          if (!receivedFirstText) {
            receivedFirstText = true;
            const msg = FINISHING_MESSAGES[Math.floor(Math.random() * FINISHING_MESSAGES.length)];
            spinner.text = chalk.green(msg + "...");
          }
        }
        fullAnswer += delta;
      },
      onThinking() {
        if (debug) {
          console.log(chalk.magenta(`[THINKING]`));
        } else {
          spinner.text = chalk.cyan("Thinking...");
        }
      },
      onRawEvent(event) {
        if (debug) {
          console.log(chalk.dim(`[RAW]`), JSON.stringify(event));
        }
      },
    }, { debug });

    if (!debug) {
      spinner.stop();
    }

    console.log();
    console.log(result.answer || fullAnswer);
    console.log();

    // Show tools used (non-debug mode)
    if (!debug && result.toolEvents.length > 0) {
      const toolsUsed = result.toolEvents
        .filter(ev => ev.type === "tool_use" && ev.tool)
        .map(ev => ev.tool);
      const uniqueTools = [...new Set(toolsUsed)];
      if (uniqueTools.length > 0) {
        const toolNames = uniqueTools.map(t => TOOL_DESCRIPTIONS[t!.toLowerCase()] || t).join(", ");
        console.log(chalk.dim(`  Used: ${toolNames}`));
      }
    }

    if (result.cost !== undefined) {
      console.log(chalk.dim(`  Cost: $${result.cost.toFixed(4)}`));
      logQuery(result.cost, question, result.answer || fullAnswer, result.toolEvents);
    }

    if (debug && result.toolEvents.length > 0) {
      console.log(chalk.yellow("\n[DEBUG] Tool events recorded:"));
      for (const ev of result.toolEvents) {
        console.log(chalk.dim(`  - ${ev.type}: ${ev.tool || ev.id}`));
      }
    }

  } catch (err) {
    if (!debug) {
      spinner.fail(chalk.red((err as Error).message));
    } else {
      console.error(chalk.red(`[ERROR] ${(err as Error).message}`));
    }
    process.exit(1);
  }
}

async function runPrint(question: string, backendName: BackendType): Promise<void> {
  const backend = getBackend(backendName);

  try {
    const result = await backend.runQuery(question);
    console.log(result.answer);

    if (result.cost !== undefined) {
      logQuery(result.cost, question, result.answer, result.toolEvents);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

function showUsage(): void {
  const daily = getDailyUsage(7);

  if (daily.length > 0) {
    console.log(chalk.bold("Last 7 days:"));
    for (const { day, cost, count } of daily) {
      const date = new Date(day);
      const dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      console.log(`  ${chalk.cyan(dayStr)}  ${chalk.green(`$${cost.toFixed(4)}`)}  ${chalk.dim(`(${count})`)}`);
    }
    console.log();
  }

  const { cost, count } = getTotalUsage(30);
  console.log(`${chalk.bold("30-day total:")} ${chalk.green(`$${cost.toFixed(4)}`)} (${count} queries)`);
}

function showLog(queryId: number): void {
  const q = getQueryById(queryId);
  if (!q) {
    console.log(chalk.red(`Query ${queryId} not found`));
    return;
  }

  const date = new Date(q.timestamp);
  console.log(chalk.bold(`Query #${q.id}`));
  console.log(chalk.dim(`${date.toLocaleString()} - $${q.cost_usd.toFixed(4)}`));
  console.log();
  console.log(chalk.cyan("Question:"));
  console.log(`  ${q.question}`);
  console.log();

  if (q.log.length > 0) {
    console.log(chalk.cyan("Tool calls:"));
    for (const event of q.log) {
      if (event.type === "tool_use") {
        const detail = formatToolCall(event.tool || "", event.input || {});
        console.log(`  → ${detail}`);
      }
    }
    console.log();
  }

  if (q.answer) {
    console.log(chalk.green("Answer:"));
    console.log(q.answer);
  }
}

function showLogsInline(n: number): void {
  const queries = getRecentQueries(n);

  if (queries.length === 0) {
    console.log(chalk.dim("No queries logged yet."));
    return;
  }

  for (const q of queries) {
    const date = new Date(q.timestamp);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const questionPreview = q.question.slice(0, 60) + (q.question.length > 60 ? "..." : "");

    console.log(`${chalk.dim(`[${dateStr}]`)} ${chalk.green(`$${q.cost_usd.toFixed(4)}`)} ${chalk.bold(`"${questionPreview}"`)}`);

    for (const event of q.log) {
      if (event.type === "tool_use") {
        const detail = formatToolCall(event.tool || "", event.input || {});
        console.log(`  ${chalk.cyan("→")} ${detail}`);
      }
    }

    if (q.answer) {
      const answerPreview = q.answer.slice(0, 100).replace(/\n/g, " ");
      console.log(`  ${chalk.green("✓")} ${answerPreview}${q.answer.length > 100 ? "..." : ""}`);
    }

    console.log();
  }
}

// CLI setup
program
  .name("askc")
  .description("Non-interactive AI assistant for quick terminal questions")
  .version("0.2.0");

program
  .command("logs [id]")
  .description("View query logs")
  .option("-n <count>", "Show last N queries inline")
  .action((id, options) => {
    if (id) {
      showLog(parseInt(id, 10));
    } else if (options.n) {
      showLogsInline(parseInt(options.n, 10));
    } else {
      showLogsInline(10);
    }
  });

program
  .command("usage")
  .description("Show API usage costs")
  .action(() => {
    showUsage();
  });

program
  .command("tools")
  .description("Check available tools for opencode backend")
  .action(async () => {
    const { spawnSync } = await import("child_process");
    
    console.log(chalk.bold("Checking opencode environment...\n"));
    
    // Check env vars
    console.log(chalk.cyan("Environment:"));
    console.log(`  OPENCODE_ENABLE_EXA: ${process.env.OPENCODE_ENABLE_EXA || chalk.dim("(not set)")}`);
    console.log(`  EXA_API_KEY: ${process.env.EXA_API_KEY ? chalk.green("set") : chalk.dim("(not set)")}`);
    console.log();
    
    // Try to get tool list from opencode
    console.log(chalk.cyan("Fetching available tools..."));
    const result = spawnSync("opencode", ["run", "--format", "json", "List all available tools you have access to. Just list the tool names, nothing else."], {
      encoding: "utf-8",
      timeout: 30000,
    });
    
    if (result.status === 0 && result.stdout) {
      // Parse the events to find the text response
      const lines = result.stdout.split("\n").filter(l => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "text" && event.part?.text) {
            console.log(chalk.green("\nTools from model:"));
            console.log(event.part.text);
          }
        } catch {}
      }
    } else {
      console.log(chalk.red("Failed to query opencode"));
      if (result.stderr) console.error(result.stderr);
    }
  });

program
  .command("ask [question...]", { isDefault: true })
  .description("Ask a question")
  .option("-b, --backend <backend>", "Backend to use: opencode, pi, claude", getDefaultBackend())
  .option("-p, --print", "Print mode (no interactive UI, pipeable)")
  .option("-d, --debug", "Debug mode (show raw events)")
  .action(async (questionParts: string[], options) => {
    const backendName = options.backend as BackendType;
    const debug = options.debug || false;
    
    let question: string;
    if (questionParts && questionParts.length > 0) {
      question = questionParts.join(" ");
    } else if (process.stdin.isTTY) {
      // Only open editor if running interactively
      const editorQuestion = getQuestionFromEditor();
      if (!editorQuestion) {
        process.exit(0);
      }
      question = editorQuestion;
    } else {
      // No question and not a TTY - show help
      console.error("No question provided. Use: askc \"your question\"");
      process.exit(1);
    }

    if (options.print) {
      await runPrint(question, backendName);
    } else {
      await runInteractive(question, backendName, debug);
    }
  });

program.parse();
