import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to mock the DB path for testing
const TEST_DB_DIR = join(tmpdir(), `askc-test-${Date.now()}`);
const TEST_DB_PATH = join(TEST_DB_DIR, "usage.db");

// Create a test version of the db functions
function getTestConnection(): Database {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  const db = new Database(TEST_DB_PATH);

  db.run(`
    CREATE TABLE IF NOT EXISTS queries (
      id INTEGER PRIMARY KEY,
      timestamp TEXT,
      cost_usd REAL,
      question TEXT,
      answer TEXT,
      log TEXT,
      suggested TEXT,
      script_run INTEGER DEFAULT 0
    )
  `);

  return db;
}

describe("Database", () => {
  let db: Database;

  beforeEach(() => {
    db = getTestConnection();
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true });
    } catch {}
  });

  test("creates queries table", () => {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables).toContainEqual({ name: "queries" });
  });

  test("inserts and retrieves a query", () => {
    const stmt = db.prepare(`
      INSERT INTO queries (timestamp, cost_usd, question, answer, log, suggested)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      new Date().toISOString(),
      0.0123,
      "test question",
      "test answer",
      JSON.stringify([]),
      ""
    );

    expect(Number(result.lastInsertRowid)).toBe(1);

    const row = db.query("SELECT * FROM queries WHERE id = 1").get() as {
      id: number;
      question: string;
      answer: string;
      cost_usd: number;
    };

    expect(row.question).toBe("test question");
    expect(row.answer).toBe("test answer");
    expect(row.cost_usd).toBe(0.0123);
  });

  test("calculates total usage", () => {
    const stmt = db.prepare(`
      INSERT INTO queries (timestamp, cost_usd, question, answer, log, suggested)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Insert 3 queries
    stmt.run(new Date().toISOString(), 0.01, "q1", "a1", "[]", "");
    stmt.run(new Date().toISOString(), 0.02, "q2", "a2", "[]", "");
    stmt.run(new Date().toISOString(), 0.03, "q3", "a3", "[]", "");

    const result = db.query("SELECT SUM(cost_usd) as total, COUNT(*) as count FROM queries").get() as {
      total: number;
      count: number;
    };

    expect(result.total).toBeCloseTo(0.06);
    expect(result.count).toBe(3);
  });

  test("stores tool events as JSON", () => {
    const toolEvents = [
      { type: "tool_use", tool: "bash", input: { command: "ls" } },
      { type: "tool_result", id: "123", output: "file.txt" },
    ];

    const stmt = db.prepare(`
      INSERT INTO queries (timestamp, cost_usd, question, answer, log, suggested)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(new Date().toISOString(), 0.01, "q", "a", JSON.stringify(toolEvents), "");

    const row = db.query("SELECT log FROM queries WHERE id = 1").get() as { log: string };
    const parsed = JSON.parse(row.log);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].tool).toBe("bash");
    expect(parsed[1].output).toBe("file.txt");
  });
});
