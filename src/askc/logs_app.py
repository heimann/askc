import subprocess
from datetime import datetime

from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, ListItem, ListView, Static
from textual.binding import Binding

from askc.db import get_recent_queries


class QueryListItem(ListItem):
    """A single query in the list."""

    def __init__(self, query: dict) -> None:
        super().__init__()
        self.query = query

    def compose(self) -> ComposeResult:
        dt = datetime.fromisoformat(self.query["timestamp"])
        date_str = dt.strftime("%b %d %H:%M")
        cost = f"${self.query['cost_usd']:.2f}"
        question = self.query["question"][:30]
        if len(self.query["question"]) > 30:
            question += "..."

        yield Static(f"[dim]{date_str}[/dim] [green]{cost}[/green]\n{question}")


class QueryDetail(Static):
    """Shows full details of a query."""

    def update_query(self, query: dict | None) -> None:
        if not query:
            self.update("[dim]No query selected[/dim]")
            return

        lines = []

        # Header
        dt = datetime.fromisoformat(query["timestamp"])
        lines.append(f"[bold]{query['question']}[/bold]")
        lines.append(f"[dim]#{query['id']} • {dt.strftime('%B %d, %Y at %H:%M')} • ${query['cost_usd']:.4f}[/dim]")
        lines.append("")

        # Tool calls
        if query["log"]:
            lines.append("[cyan]Tool calls:[/cyan]")
            for event in query["log"]:
                if event["type"] == "tool_use":
                    tool = event["tool"]
                    inp = event.get("input", {})

                    if tool == "Bash":
                        detail = inp.get("command", "")[:60]
                    elif tool == "Read":
                        detail = inp.get("file_path", "")
                    elif tool in ("Glob", "Grep"):
                        detail = inp.get("pattern", "")
                    elif tool == "WebSearch":
                        detail = inp.get("query", "")
                    elif tool == "WebFetch":
                        detail = inp.get("url", "")[:50]
                    else:
                        detail = ""

                    lines.append(f"  [yellow]→[/yellow] {tool}({detail})")

                elif event["type"] == "tool_result":
                    output = event.get("output", "")
                    if output:
                        # Show first few lines of output
                        output_lines = output.strip().split("\n")[:3]
                        for ol in output_lines:
                            lines.append(f"    [dim]{ol[:70]}[/dim]")
                        if len(output.strip().split("\n")) > 3:
                            lines.append("    [dim]...[/dim]")

            lines.append("")

        # Answer
        if query["answer"]:
            lines.append("[green]Answer:[/green]")
            # Wrap answer text
            answer_lines = query["answer"].split("\n")[:10]
            for al in answer_lines:
                lines.append(f"  {al[:70]}")
            if len(query["answer"].split("\n")) > 10:
                lines.append("  [dim]...[/dim]")
            lines.append("")

        # Suggested
        if query["suggested"]:
            status = "[green]✓ Run[/green]" if query["script_run"] else "[dim]✗ Not run[/dim]"
            lines.append(f"[yellow]Suggested:[/yellow] {status}")
            suggested_lines = query["suggested"].split("\n")[:5]
            for sl in suggested_lines:
                lines.append(f"  [dim]{sl[:70]}[/dim]")

        self.update("\n".join(lines))


class LogsApp(App):
    """Browse query logs."""

    CSS = """
    #container {
        height: 100%;
    }

    #list-container {
        width: 35%;
        border-right: solid $primary;
    }

    #detail-container {
        width: 65%;
        padding: 1 2;
    }

    ListView {
        height: 100%;
    }

    QueryListItem {
        padding: 1;
    }

    QueryListItem:hover {
        background: $surface-lighten-1;
    }

    ListView > QueryListItem.--highlight {
        background: $primary-darken-2;
    }

    QueryDetail {
        height: 100%;
        overflow-y: auto;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("y", "yank", "Yank"),
        Binding("j", "cursor_down", "Down", show=False),
        Binding("k", "cursor_up", "Up", show=False),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.queries = get_recent_queries(50)
        self.current_query: dict | None = None

    def compose(self) -> ComposeResult:
        with Horizontal(id="container"):
            with Vertical(id="list-container"):
                yield ListView(*[QueryListItem(q) for q in self.queries])
            with Vertical(id="detail-container"):
                yield QueryDetail(id="detail")
        yield Footer()

    def on_mount(self) -> None:
        # Select first item
        if self.queries:
            self.current_query = self.queries[0]
            self.query_one(QueryDetail).update_query(self.current_query)
            lv = self.query_one(ListView)
            if lv.children:
                lv.index = 0

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        if isinstance(event.item, QueryListItem):
            self.current_query = event.item.query
            self.query_one(QueryDetail).update_query(self.current_query)

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if isinstance(event.item, QueryListItem):
            self.current_query = event.item.query
            self.query_one(QueryDetail).update_query(self.current_query)

    def action_cursor_down(self) -> None:
        self.query_one(ListView).action_cursor_down()

    def action_cursor_up(self) -> None:
        self.query_one(ListView).action_cursor_up()

    def action_yank(self) -> None:
        """Copy 'askc logs {id}' to clipboard."""
        if not self.current_query:
            self.notify("No query selected", severity="warning")
            return

        query_id = self.current_query["id"]
        cmd = f"askc logs {query_id}"

        # Try OSC 52 first (works over SSH in terminals like Blink, iTerm2, etc.)
        import base64
        import sys
        osc52 = f"\033]52;c;{base64.b64encode(cmd.encode()).decode()}\a"
        sys.stdout.write(osc52)
        sys.stdout.flush()
        self.notify(f"Copied: {cmd}")


def run_logs_app() -> None:
    app = LogsApp()
    app.run()
