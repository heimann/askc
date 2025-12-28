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


@app.command()
def main(
    question: Optional[list[str]] = typer.Argument(None, help="Question to ask"),
    print_mode: bool = typer.Option(False, "--print", "-p", help="Print only (no interactive UI)"),
):
    """AI-powered terminal assistant."""
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
