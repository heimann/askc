import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { join } from "path";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bun", ["run", CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 5000,
  });

  return {
    stdout: result.stdout?.toString() || "",
    stderr: result.stderr?.toString() || "",
    exitCode: result.status || 0,
  };
}

describe("CLI", () => {
  test("--help shows usage", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Non-interactive AI assistant");
    expect(stdout).toContain("logs");
    expect(stdout).toContain("usage");
  });

  test("--version shows version", () => {
    const { stdout, exitCode } = runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  test("ask --help shows backend options", () => {
    const { stdout, exitCode } = runCli(["ask", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--backend");
    expect(stdout).toContain("opencode");
    expect(stdout).toContain("pi");
    expect(stdout).toContain("claude");
  });

  test("usage command works", () => {
    const { stdout, exitCode } = runCli(["usage"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("30-day total:");
  });

  test("logs command works", () => {
    const { stdout, exitCode } = runCli(["logs", "-n", "1"]);
    expect(exitCode).toBe(0);
    // Either shows a log entry or "No queries logged yet"
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("no question without TTY shows error", () => {
    const { stderr, exitCode } = runCli([]);
    // When not a TTY and no question, should error
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No question provided");
  });
});
