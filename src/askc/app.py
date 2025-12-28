import asyncio
import random
import subprocess
from dataclasses import dataclass

from rich.console import Console
from rich.markdown import Markdown
from rich.status import Status
from rich.syntax import Syntax

from claude_agent_sdk import ClaudeAgentOptions, query

console = Console()

# Fun messages for the final "StructuredOutput" phase
FINISHING_MESSAGES = [
    "Wrapping up",
    "Almost there",
    "Finishing touches",
    "Polishing response",
    "Just a moment",
    "Putting it together",
    "Final thoughts",
    "Tidying up",
    "One sec",
    "Dotting the i's",
    "Crossing the t's",
    "Nearly done",
    "Hang tight",
    "Last step",
    "Synthesizing",
    "Composing answer",
    "Crafting response",
    "Gathering thoughts",
    "Pulling it together",
    "Summing up",
    "Rounding out",
    "Buttoning up",
    "Home stretch",
    "Final pass",
    "Wrapping things up",
    "Just about done",
    "Tying loose ends",
    "Adding final touches",
    "Sealing the deal",
    "Last look",
    "Quick review",
    "Double checking",
    "Sanity check",
    "Final review",
    "Packaging response",
    "Gift wrapping",
    "Sprinkling magic",
    "Chef's kiss",
    "Mic drop prep",
    "Drumroll please",
    "And... done soon",
    "Bear with me",
    "Hold that thought",
    "Processing brilliance",
    "Genius at work",
    "Cooking up answer",
    "Baking response",
    "Marinating thoughts",
    "Simmering ideas",
    "Steeping wisdom",
]

# Spinner styles that cycle on each new tool call
SPINNER_STYLES = [
    "dots",
    "dots2",
    "dots3",
    "line",
    "arc",
    "moon",
    "arrow3",
    "bouncingBar",
]

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {
            "type": "string",
            "description": "Your helpful answer in markdown",
        },
        "suggested_command": {
            "type": "string",
            "description": "A single shell command to run (for simple tasks)",
        },
        "suggested_script": {
            "type": "string",
            "description": "A bash script for multi-step diagnostic or complex tasks",
        },
    },
    "required": ["answer"],
}

SYSTEM_PROMPT = """You are a helpful terminal assistant. Answer the user's question. Use tools to search files, run commands, or search the web when needed.

For follow-up actions, choose ONE of:
- suggested_command: A single shell command that the user can run to verify or reproduce your answer. Make sure the command output will match what you described (e.g., include hidden files if you mentioned them).
- suggested_script: A complete bash script for diagnostic tasks or multi-step operations.

Only include one or the other, not both. Keep the answer concise."""


@dataclass
class QueryResult:
    answer: str
    suggested_command: str | None = None
    suggested_script: str | None = None


def detect_language(script: str) -> str:
    """Detect if script is bash or python."""
    if script.strip().startswith("#!/usr/bin/env python") or script.strip().startswith("#!/usr/bin/python"):
        return "python"
    if script.strip().startswith("#!") or script.strip().startswith("#!/bin/bash"):
        return "bash"
    # Heuristics
    if "def " in script or "import " in script:
        return "python"
    return "bash"


def run_script(script: str) -> None:
    """Execute a script using subprocess."""
    lang = detect_language(script)
    console.print(f"[dim]Running {lang} script...[/dim]\n")

    if lang == "python":
        result = subprocess.run(["python", "-c", script], capture_output=False)
    else:
        result = subprocess.run(["bash", "-c", script], capture_output=False)

    if result.returncode != 0:
        console.print(f"\n[red]Script exited with code {result.returncode}[/red]")


def preview_script(script: str) -> None:
    """Show syntax-highlighted preview of script."""
    lang = detect_language(script)
    console.print()
    console.print(Syntax(script, lang, theme="monokai", line_numbers=True))
    console.print()


async def analyze_script(script: str) -> None:
    """Ask Claude to analyze the script for safety."""
    lang = detect_language(script)
    prompt = f"""Analyze this {lang} script for safety. Rate it from 10 (completely safe, read-only operations) to 0 (dangerous, could damage system). Be concise - just give the rating and a 1-2 sentence explanation of what it does and any concerns:

```{lang}
{script}
```"""

    with Status("[bold cyan]Analyzing...", console=console) as status:
        async for message in query(
            prompt=prompt,
            options=ClaudeAgentOptions(allowed_tools=[]),
        ):
            if hasattr(message, "result"):
                console.print()
                console.print(Markdown(message.result))
                console.print()


def save_script(script: str) -> None:
    """Save script to a file."""
    lang = detect_language(script)
    default_ext = ".py" if lang == "python" else ".sh"

    path = console.input(f"[bold]Save to[/bold] [dim](default: script{default_ext})[/dim]: ").strip()
    if not path:
        path = f"script{default_ext}"

    with open(path, "w") as f:
        f.write(script)

    console.print(f"[green]Saved to {path}[/green]")


async def handle_script_interaction(script: str, is_multiline: bool) -> None:
    """Handle interactive prompt for script/command."""
    if is_multiline:
        console.print("[dim]  → script ready[/dim]")
    else:
        console.print(f"[dim]  → [yellow]{script}[/yellow][/dim]")

    while True:
        console.print()
        if is_multiline:
            choice = console.input("[bold][[/bold][cyan]r[/cyan][bold]]un  [[/bold][cyan]p[/cyan][bold]]review  [[/bold][cyan]a[/cyan][bold]]nalyze  [[/bold][cyan]s[/cyan][bold]]ave  [[/bold][cyan]q[/cyan][bold]]uit:[/bold] ").strip().lower()
        else:
            choice = console.input("[bold][[/bold][cyan]r[/cyan][bold]]un  [[/bold][cyan]a[/cyan][bold]]nalyze  [[/bold][cyan]q[/cyan][bold]]uit:[/bold] ").strip().lower()

        if choice == "r":
            run_script(script)
            break
        elif choice == "p" and is_multiline:
            preview_script(script)
            # After preview, show options again
        elif choice == "a":
            await analyze_script(script)
            # After analyze, show options again
        elif choice == "s" and is_multiline:
            save_script(script)
            break
        elif choice == "q" or choice == "":
            break
        else:
            console.print("[dim]Invalid choice[/dim]")


def get_tool_status(name: str, tool_input: dict) -> tuple[str, str]:
    """Get status message and color for a tool call."""
    detail = ""
    color = "yellow"

    if name == "StructuredOutput":
        # Pick a random finishing message
        msg = random.choice(FINISHING_MESSAGES)
        return f"[bold cyan]{msg}...[/]", "cyan"
    elif name == "Bash":
        color = "green"
        cmd = tool_input.get("command", "")
        detail = cmd[:30] + "..." if len(cmd) > 30 else cmd
        return f"[bold {color}]Running[/] [dim]({detail})[/]", color
    elif name == "Read":
        color = "cyan"
        path = tool_input.get("file_path", "")
        detail = path.split("/")[-1]  # Just filename
        return f"[bold {color}]Reading[/] [dim]({detail})[/]", color
    elif name in ("Glob", "Grep"):
        color = "yellow"
        pattern = tool_input.get("pattern", "")
        detail = pattern[:20] + "..." if len(pattern) > 20 else pattern
        return f"[bold {color}]Searching[/] [dim]({detail})[/]", color
    elif name == "WebSearch":
        color = "magenta"
        query = tool_input.get("query", "")
        detail = query[:25] + "..." if len(query) > 25 else query
        return f"[bold {color}]Web search[/] [dim]({detail})[/]", color
    elif name == "WebFetch":
        color = "magenta"
        url = tool_input.get("url", "")
        detail = url[:30] + "..." if len(url) > 30 else url
        return f"[bold {color}]Fetching[/] [dim]({detail})[/]", color
    else:
        return f"[bold {color}]{name}...[/]", color


async def run_interactive(question: str) -> None:
    """Run a query with inline spinner and markdown output."""
    result: QueryResult | None = None
    cost: float | None = None
    spinner_idx = 0

    bash_tool_ids: dict[str, str] = {}  # tool_use_id -> command

    with Status("[bold cyan]Thinking...", console=console, spinner=SPINNER_STYLES[0]) as status:
        async for message in query(
            prompt=question,
            options=ClaudeAgentOptions(
                allowed_tools=["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
                system_prompt=SYSTEM_PROMPT,
                output_format={"type": "json_schema", "schema": RESPONSE_SCHEMA},
            ),
        ):
            # Check for tool use in message content
            msg_class = type(message).__name__
            content = getattr(message, "content", [])

            if msg_class in ("AssistantMessage", "UserMessage"):
                for block in content:
                    if type(block).__name__ == "ToolUseBlock":
                        # Cycle to next spinner style
                        spinner_idx = (spinner_idx + 1) % len(SPINNER_STYLES)
                        tool_name = getattr(block, "name", "tool")
                        tool_input = getattr(block, "input", {})
                        status_msg, _ = get_tool_status(tool_name, tool_input)
                        status.update(status_msg, spinner=SPINNER_STYLES[spinner_idx])

                        # Track Bash commands for showing output later
                        if tool_name == "Bash":
                            tool_id = getattr(block, "id", None)
                            if tool_id:
                                bash_tool_ids[tool_id] = tool_input.get("command", "")

                    elif type(block).__name__ == "ToolResultBlock":
                        # Show Bash output when it completes
                        tool_use_id = getattr(block, "tool_use_id", None)
                        if tool_use_id in bash_tool_ids:
                            cmd = bash_tool_ids.pop(tool_use_id)
                            output = getattr(block, "content", "")
                            if output and isinstance(output, str):
                                # Show truncated output
                                lines = output.strip().split("\n")
                                preview = lines[0][:60] if lines else ""
                                if len(lines) > 1 or len(lines[0]) > 60:
                                    preview += "..."
                                console.print(f"[dim]  $ {cmd[:40]}{'...' if len(cmd) > 40 else ''} → {preview}[/dim]")

            # Capture structured result and cost
            if hasattr(message, "structured_output") and message.structured_output:
                out = message.structured_output
                result = QueryResult(
                    answer=out.get("answer", ""),
                    suggested_command=out.get("suggested_command"),
                    suggested_script=out.get("suggested_script"),
                )
                cost = getattr(message, "total_cost_usd", None)

    # Print the answer
    console.print()
    if result:
        console.print(Markdown(result.answer))
        console.print()

        # Show cost and log to db
        if cost is not None:
            console.print(f"[dim]  💰 ${cost:.4f}[/dim]")
            from askc.db import log_query
            log_query(cost, question)

        # Handle script/command interaction
        script = result.suggested_script or result.suggested_command
        if script:
            is_script = bool(result.suggested_script)
            await handle_script_interaction(script, is_script)
    else:
        console.print("[red]No response received[/red]")


def run_app(question: str) -> None:
    asyncio.run(run_interactive(question))
