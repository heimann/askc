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


@app.command("logs")
def logs_cmd(
    query_id: int = typer.Argument(None, help="Show specific query by ID"),
    n: int = typer.Option(None, "-n", help="Number of queries (inline mode)"),
):
    """Browse query logs. Use -n for inline output, or pass an ID for specific query."""
    if query_id is not None:
        # Show specific query
        show_single_log(query_id)
    elif n is not None:
        # Inline mode
        show_logs_inline(n)
    else:
        # TUI mode
        from askc.logs_app import run_logs_app
        run_logs_app()


def show_single_log(query_id: int) -> None:
    """Show a single query log in full detail."""
    from datetime import datetime

    from rich.console import Console
    from rich.markdown import Markdown
    from rich.syntax import Syntax

    from askc.db import get_query_by_id

    console = Console()
    q = get_query_by_id(query_id)

    if not q:
        console.print(f"[red]Query {query_id} not found[/red]")
        return

    # Header
    dt = datetime.fromisoformat(q["timestamp"])
    console.print(f"[bold]Query #{q['id']}[/bold]")
    console.print(f"[dim]{dt.strftime('%B %d, %Y at %H:%M')} • ${q['cost_usd']:.4f}[/dim]")
    console.print()

    # Question
    console.print("[cyan]Question:[/cyan]")
    console.print(f"  {q['question']}")
    console.print()

    # Tool calls
    if q["log"]:
        console.print("[cyan]Tool calls:[/cyan]")
        for event in q["log"]:
            if event["type"] == "tool_use":
                tool = event["tool"]
                inp = event.get("input", {})

                if tool == "Bash":
                    detail = inp.get("command", "")
                elif tool == "Read":
                    detail = inp.get("file_path", "")
                elif tool in ("Glob", "Grep"):
                    detail = inp.get("pattern", "")
                elif tool == "WebSearch":
                    detail = inp.get("query", "")
                elif tool == "WebFetch":
                    detail = inp.get("url", "")
                else:
                    detail = str(inp)[:100] if inp else ""

                console.print(f"  [yellow]→[/yellow] {tool}({detail})")

            elif event["type"] == "tool_result":
                output = event.get("output", "")
                if output:
                    # Show output (truncated)
                    lines = output.strip().split("\n")[:5]
                    for line in lines:
                        console.print(f"    [dim]{line[:100]}[/dim]")
                    if len(output.strip().split("\n")) > 5:
                        console.print("    [dim]...[/dim]")
        console.print()

    # Answer
    if q["answer"]:
        console.print("[green]Answer:[/green]")
        console.print(Markdown(q["answer"]))
        console.print()

    # Suggested
    if q["suggested"]:
        status = "[green]✓ Run[/green]" if q["script_run"] else "[dim]✗ Not run[/dim]"
        console.print(f"[yellow]Suggested:[/yellow] {status}")
        lang = "python" if "import " in q["suggested"] or "def " in q["suggested"] else "bash"
        console.print(Syntax(q["suggested"], lang, theme="monokai"))


def show_logs_inline(n: int) -> None:
    """Show logs inline (non-TUI)."""
    from datetime import datetime

    from rich.console import Console
    from rich.text import Text

    from askc.db import get_recent_queries

    console = Console()
    queries = get_recent_queries(n)

    if not queries:
        console.print("[dim]No queries logged yet.[/dim]")
        return

    for q in queries:
        # Header with timestamp and question
        dt = datetime.fromisoformat(q["timestamp"])
        header = Text()
        header.append(f"[{dt.strftime('%b %d %H:%M')}] ", style="dim")
        header.append(f"${q['cost_usd']:.4f} ", style="green")
        header.append(f'"{q["question"][:60]}{"..." if len(q["question"]) > 60 else ""}"', style="bold")

        console.print(header)

        # Tool calls
        for event in q["log"]:
            if event["type"] == "tool_use":
                tool = event["tool"]
                inp = event.get("input", {})

                if tool == "Bash":
                    detail = inp.get("command", "")[:50]
                elif tool == "Read":
                    detail = inp.get("file_path", "").split("/")[-1]
                elif tool in ("Glob", "Grep"):
                    detail = inp.get("pattern", "")[:30]
                elif tool == "WebSearch":
                    detail = inp.get("query", "")[:30]
                else:
                    detail = ""

                console.print(f"  [cyan]→[/cyan] {tool}({detail})")

            elif event["type"] == "tool_result":
                output = event.get("output", "")
                if output and len(output) > 0:
                    preview = output[:80].replace("\n", " ")
                    if len(output) > 80:
                        preview += "..."
                    console.print(f"    [dim]{preview}[/dim]")

        # Answer preview
        if q["answer"]:
            answer_preview = q["answer"][:100].replace("\n", " ")
            if len(q["answer"]) > 100:
                answer_preview += "..."
            console.print(f"  [green]✓[/green] {answer_preview}")

        # Suggested command/script
        if q["suggested"]:
            status = "[green]✓ Run[/green]" if q["script_run"] else "[dim]✗ Not run[/dim]"
            suggested_preview = q["suggested"][:50].replace("\n", " ")
            if len(q["suggested"]) > 50:
                suggested_preview += "..."
            console.print(f"  [yellow]→[/yellow] {suggested_preview} {status}")

        console.print()


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


SUBCOMMANDS = {"usage", "logs"}


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

    # If first arg looks like a subcommand, invoke it with parsed args
    if question and question[0] in SUBCOMMANDS:
        if question[0] == "usage":
            usage_cmd()
        elif question[0] == "logs":
            # Parse query_id (first arg after "logs") and -n option
            query_id = None
            n = None
            args = question[1:]  # Skip "logs"

            # Check if first arg is a query ID (number)
            if args and args[0].isdigit():
                query_id = int(args[0])

            # Parse -n option
            for i, arg in enumerate(args):
                if arg == "-n" and i + 1 < len(args):
                    try:
                        n = int(args[i + 1])
                    except ValueError:
                        pass

            logs_cmd(query_id=query_id, n=n)
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
