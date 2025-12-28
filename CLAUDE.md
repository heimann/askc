# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
uv sync                      # Install dependencies
uv run askc "question"       # Run interactively
uv run askc -p "question"    # Print mode (pipeable)
uv run askc usage            # Show API cost breakdown
```

## Architecture

askc is an AI terminal assistant built on the Claude Agent SDK. It wraps the SDK with a Rich-based UI.

**Entry flow:** `cli.py` (Typer CLI) → `app.py` (Rich UI + Agent SDK) → `db.py` (SQLite usage tracking)

**Key concepts:**

- **Structured output**: Responses use a JSON schema (`RESPONSE_SCHEMA` in app.py) returning `answer` + optional `suggested_command` or `suggested_script`
- **Interactive actions**: After answers, users can run/preview/analyze/save suggested scripts
- **Spinner cycling**: Each tool call cycles through `SPINNER_STYLES` with contextual status messages
- **Subcommand handling**: `SUBCOMMANDS` set in cli.py requires manual `ctx.invoke()` due to Typer's argument parsing

**Data storage:** `~/.local/share/askc/usage.db` - SQLite tracking query costs

## Adding Subcommands

When adding new subcommands to cli.py:
1. Add the command name to the `SUBCOMMANDS` set
2. Create the command with `@app.command("name")`
3. The callback will auto-invoke it when detected as first argument
