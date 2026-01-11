import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

const DB_PATH = join(homedir(), ".local", "share", "askc", "usage.db");

export interface Query {
  id: number;
  timestamp: string;
  cost_usd: number;
  question: string;
  answer: string;
  log: ToolEvent[];
  suggested: string;
  script_run: boolean;
}

export interface ToolEvent {
  type: "tool_use" | "tool_result";
  tool?: string;
  input?: Record<string, unknown>;
  id?: string;
  output?: string;
}

function getConnection(): Database {
  mkdirSync(join(homedir(), ".local", "share", "askc"), { recursive: true });
  const db = new Database(DB_PATH);

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

export function logQuery(
  costUsd: number,
  question: string,
  answer: string = "",
  logEvents: ToolEvent[] = [],
  suggested: string = ""
): number {
  const db = getConnection();
  const stmt = db.prepare(`
    INSERT INTO queries (timestamp, cost_usd, question, answer, log, suggested)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    new Date().toISOString(),
    costUsd,
    question.slice(0, 500),
    answer,
    JSON.stringify(logEvents),
    suggested
  );

  db.close();
  return Number(result.lastInsertRowid);
}

export function markScriptRun(queryId: number): void {
  const db = getConnection();
  db.run("UPDATE queries SET script_run = 1 WHERE id = ?", [queryId]);
  db.close();
}

export function getDailyUsage(days: number = 7): Array<{ day: string; cost: number; count: number }> {
  const db = getConnection();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .query(`
      SELECT date(timestamp) as day, SUM(cost_usd) as cost, COUNT(*) as count
      FROM queries
      WHERE timestamp > ?
      GROUP BY day
      ORDER BY day DESC
    `)
    .all(cutoff) as Array<{ day: string; cost: number; count: number }>;

  db.close();
  return rows;
}

export function getTotalUsage(days: number = 30): { cost: number; count: number } {
  const db = getConnection();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const row = db
    .query(`
      SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as count
      FROM queries
      WHERE timestamp > ?
    `)
    .get(cutoff) as { cost: number; count: number };

  db.close();
  return row;
}

export function getQueryById(queryId: number): Query | null {
  const db = getConnection();
  const row = db
    .query(`
      SELECT id, timestamp, cost_usd, question, answer, log, suggested, script_run
      FROM queries
      WHERE id = ?
    `)
    .get(queryId) as {
    id: number;
    timestamp: string;
    cost_usd: number;
    question: string;
    answer: string;
    log: string;
    suggested: string;
    script_run: number;
  } | null;

  db.close();

  if (!row) return null;

  return {
    id: row.id,
    timestamp: row.timestamp,
    cost_usd: row.cost_usd,
    question: row.question,
    answer: row.answer,
    log: row.log ? JSON.parse(row.log) : [],
    suggested: row.suggested,
    script_run: Boolean(row.script_run),
  };
}

export function getRecentQueries(limit: number = 50): Query[] {
  const db = getConnection();
  const rows = db
    .query(`
      SELECT id, timestamp, cost_usd, question, answer, log, suggested, script_run
      FROM queries
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(limit) as Array<{
    id: number;
    timestamp: string;
    cost_usd: number;
    question: string;
    answer: string;
    log: string;
    suggested: string;
    script_run: number;
  }>;

  db.close();

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    cost_usd: row.cost_usd,
    question: row.question,
    answer: row.answer,
    log: row.log ? JSON.parse(row.log) : [],
    suggested: row.suggested,
    script_run: Boolean(row.script_run),
  }));
}
