import asyncio
import os
import subprocess
import tempfile
from typing import Optional

import typer

from claude_agent_sdk import ClaudeAgentOptions, query

app = typer.Typer(add_completion=False)


def get_question_from_editor() -> str | None:
    """Open $EDITOR for user to type a question."""
    editor = os.environ.get("EDITOR", "vim")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
        temp_path = f.name

    try:
        subprocess.run([editor, temp_path], check=True)
        with open(temp_path) as f:
            question = f.read().strip()
        return question if question else None
    finally:
        os.unlink(temp_path)


async def run_query(question: str) -> None:
    """Run a query and print the result (structured output, answer only)."""
    from askc.app import RESPONSE_SCHEMA, SYSTEM_PROMPT

    async for message in query(
        prompt=question,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
            system_prompt=SYSTEM_PROMPT,
            output_format={"type": "json_schema", "schema": RESPONSE_SCHEMA},
        ),
    ):
        if hasattr(message, "structured_output") and message.structured_output:
            print(message.structured_output.get("answer", ""))


@app.command("usage")
def usage_cmd():
    """Show API usage costs."""
    from datetime import datetime

    from rich.console import Console
    from rich.table import Table

    from askc.db import get_daily_usage, get_total_usage

    console = Console()

    # Daily breakdown
    daily = get_daily_usage(7)
    if daily:
        table = Table(title="Last 7 days", show_header=False, box=None)
        table.add_column("Day", style="cyan")
        table.add_column("Cost", style="green", justify="right")
        table.add_column("Queries", style="dim", justify="right")

        for day, cost, count in daily:
            # Format date nicely
            dt = datetime.fromisoformat(day)
            day_str = dt.strftime("%b %d")
            table.add_row(day_str, f"${cost:.4f}", f"({count})")

        console.print(table)
        console.print()

    # 30-day total
    total_cost, total_count = get_total_usage(30)
    console.print(f"[bold]30-day total:[/bold] ${total_cost:.4f} ({total_count} queries)")


SUBCOMMANDS = {"usage"}


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    question: Optional[list[str]] = typer.Argument(None, help="Question to ask"),
    print_mode: bool = typer.Option(False, "--print", "-p", help="Print only (no interactive UI)"),
):
    """AI-powered terminal assistant."""
    # If a subcommand was invoked, don't run the default behavior
    if ctx.invoked_subcommand is not None:
        return

    # Check if first arg is actually a subcommand - invoke it manually
    if question and question[0] in SUBCOMMANDS:
        ctx.invoke(usage_cmd)
        return

    if question:
        q = " ".join(question)
    else:
        # No args - open editor
        q = get_question_from_editor()
        if not q:
            raise typer.Exit(0)

    if print_mode:
        asyncio.run(run_query(q))
    else:
        from askc.app import run_app
        run_app(q)
