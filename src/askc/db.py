import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path.home() / ".local" / "share" / "askc" / "usage.db"


def get_connection() -> sqlite3.Connection:
    """Get database connection, creating db if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Create table with all columns
    conn.execute("""
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
    """)

    # Migration: add new columns if they don't exist
    cursor = conn.execute("PRAGMA table_info(queries)")
    columns = {row[1] for row in cursor.fetchall()}
    if "answer" not in columns:
        conn.execute("ALTER TABLE queries ADD COLUMN answer TEXT")
    if "log" not in columns:
        conn.execute("ALTER TABLE queries ADD COLUMN log TEXT")
    if "suggested" not in columns:
        conn.execute("ALTER TABLE queries ADD COLUMN suggested TEXT")
    if "script_run" not in columns:
        conn.execute("ALTER TABLE queries ADD COLUMN script_run INTEGER DEFAULT 0")

    return conn


def log_query(
    cost_usd: float,
    question: str,
    answer: str = "",
    log_events: list[dict] | None = None,
    suggested: str = "",
) -> int:
    """Log a query with its cost and details. Returns the query ID."""
    conn = get_connection()
    cursor = conn.execute(
        """INSERT INTO queries (timestamp, cost_usd, question, answer, log, suggested)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            datetime.now().isoformat(),
            cost_usd,
            question[:500],
            answer,
            json.dumps(log_events or []),
            suggested,
        ),
    )
    query_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return query_id


def mark_script_run(query_id: int) -> None:
    """Mark that the user ran the suggested script."""
    conn = get_connection()
    conn.execute("UPDATE queries SET script_run = 1 WHERE id = ?", (query_id,))
    conn.commit()
    conn.close()


def get_daily_usage(days: int = 7) -> list[tuple[str, float, int]]:
    """Get usage grouped by day for the last N days."""
    conn = get_connection()
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    rows = conn.execute("""
        SELECT date(timestamp) as day, SUM(cost_usd), COUNT(*)
        FROM queries
        WHERE timestamp > ?
        GROUP BY day
        ORDER BY day DESC
    """, (cutoff,)).fetchall()
    conn.close()
    return [(row[0], row[1], row[2]) for row in rows]


def get_total_usage(days: int = 30) -> tuple[float, int]:
    """Get total usage for the last N days."""
    conn = get_connection()
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    row = conn.execute("""
        SELECT COALESCE(SUM(cost_usd), 0), COUNT(*)
        FROM queries
        WHERE timestamp > ?
    """, (cutoff,)).fetchone()
    conn.close()
    return (row[0], row[1])


def get_query_by_id(query_id: int) -> dict | None:
    """Get a single query by ID."""
    conn = get_connection()
    row = conn.execute("""
        SELECT id, timestamp, cost_usd, question, answer, log, suggested, script_run
        FROM queries
        WHERE id = ?
    """, (query_id,)).fetchone()
    conn.close()

    if not row:
        return None

    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "cost_usd": row["cost_usd"],
        "question": row["question"],
        "answer": row["answer"],
        "log": json.loads(row["log"]) if row["log"] else [],
        "suggested": row["suggested"],
        "script_run": bool(row["script_run"]),
    }


def get_recent_queries(limit: int = 5) -> list[dict]:
    """Get recent queries with full details."""
    conn = get_connection()
    rows = conn.execute("""
        SELECT id, timestamp, cost_usd, question, answer, log, suggested, script_run
        FROM queries
        ORDER BY id DESC
        LIMIT ?
    """, (limit,)).fetchall()
    conn.close()

    return [
        {
            "id": row["id"],
            "timestamp": row["timestamp"],
            "cost_usd": row["cost_usd"],
            "question": row["question"],
            "answer": row["answer"],
            "log": json.loads(row["log"]) if row["log"] else [],
            "suggested": row["suggested"],
            "script_run": bool(row["script_run"]),
        }
        for row in rows
    ]
