import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path.home() / ".local" / "share" / "askc" / "usage.db"


def get_connection() -> sqlite3.Connection:
    """Get database connection, creating db if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY,
            timestamp TEXT,
            cost_usd REAL,
            question TEXT
        )
    """)
    return conn


def log_query(cost_usd: float, question: str) -> None:
    """Log a query with its cost."""
    conn = get_connection()
    conn.execute(
        "INSERT INTO queries (timestamp, cost_usd, question) VALUES (?, ?, ?)",
        (datetime.now().isoformat(), cost_usd, question[:100]),
    )
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
    return rows


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
    return row
