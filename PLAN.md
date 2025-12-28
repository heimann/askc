# askc - AI-powered terminal assistant

A Textual-based CLI tool for quick Claude queries with interactive follow-up actions.

## Features

### Core (v1)
- **Quick queries**: `askc "question"` → streaming answer with markdown rendering
- **Suggested actions**: Single commands or multi-step diagnostic scripts
- **Interactive prompt**: After answer, show `[y] run  [p] preview  [q] quit`
- **Script preview**: Syntax-highlighted script with safety rating
- **Cost display**: Show API cost after each query
- **Spinner with status**: Dynamic spinner showing tool usage (Searching, Running, etc.)

### Future ideas
- Persistent chat mode (`askc --chat`)
- History/recall previous queries
- Multiple panes (answer + script side-by-side)
- Config file for model selection, budget limits
- Shell integration (fish/zsh completions)

## Tech Stack

- **Python 3.11+**
- **uv** - Package management
- **anthropic** - Claude SDK
- **textual** - TUI framework
- **rich** - Markdown/syntax rendering (included with textual)

## Project Structure

```
askc/
├── pyproject.toml
├── README.md
├── src/
│   └── askc/
│       ├── __init__.py
│       ├── __main__.py      # Entry point: python -m askc
│       ├── app.py           # Main Textual app
│       ├── claude.py        # Claude SDK wrapper, streaming
│       ├── widgets/
│       │   ├── __init__.py
│       │   ├── spinner.py   # Animated spinner widget
│       │   ├── answer.py    # Markdown answer display
│       │   └── prompt.py    # Interactive action prompt
│       └── schema.py        # Structured output schemas
└── tests/
    └── ...
```

## Setup Commands

```bash
# Initialize project
uv init askc
cd askc

# Add dependencies
uv add anthropic textual rich

# Add dev dependencies
uv add --dev pytest ruff

# Run during development
uv run python -m askc "your question"

# Install globally (optional)
uv tool install .
```

## Implementation Plan

### Phase 1: Basic Query Flow
1. Set up project with uv
2. Create Claude SDK wrapper with streaming
3. Basic Textual app that:
   - Takes question from CLI arg
   - Shows spinner while waiting
   - Streams answer with markdown rendering
   - Displays cost
   - Exits

### Phase 2: Structured Output
1. Define JSON schema for responses:
   ```python
   schema = {
       "answer": str,           # Markdown response
       "suggested_command": str, # Optional single command
       "suggested_script": str,  # Optional bash script
   }
   ```
2. Parse structured output from Claude
3. Save command/script to temp files (for compatibility with shell)

### Phase 3: Interactive Actions
1. After answer, show action bar: `[y] run  [p] preview  [q] quit`
2. Handle keypresses:
   - `y` → Execute command/script, show output
   - `p` → Show script with syntax highlighting + safety analysis
   - `q` → Exit
3. After preview, show: `[y] run  [b] back  [q] quit`

### Phase 4: Enhanced Spinner
1. Multiple spinner styles (dots, arrows, moon, etc.)
2. Cycle styles on events (new tool call)
3. Show current action: "Running (git status)...", "Searching..."
4. Color-code by action type

### Phase 5: Polish
1. Error handling (API errors, network issues)
2. Ctrl+C handling (graceful exit)
3. Config file support (~/.config/askc/config.toml)
4. Shell completions

## Key Code Snippets

### Claude Streaming (claude.py)
```python
import anthropic
from typing import AsyncIterator

client = anthropic.Anthropic()

async def stream_response(question: str) -> AsyncIterator[str]:
    with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": question}],
        # Add structured output schema here
    ) as stream:
        for text in stream.text_stream:
            yield text
```

### Main App Structure (app.py)
```python
from textual.app import App, ComposeResult
from textual.widgets import Static, Footer
from textual.containers import Container

class AskC(App):
    BINDINGS = [
        ("y", "run_suggestion", "Run"),
        ("p", "preview", "Preview"),
        ("q", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Container(
            SpinnerWidget(),
            AnswerWidget(),
            id="main"
        )
        yield Footer()

    async def on_mount(self) -> None:
        # Start streaming response
        await self.stream_answer()
```

### Entry Point (__main__.py)
```python
import sys
from .app import AskC

def main():
    if len(sys.argv) < 2:
        print("Usage: askc 'your question'")
        sys.exit(1)

    question = " ".join(sys.argv[1:])
    app = AskC(question=question)
    app.run()

if __name__ == "__main__":
    main()
```

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for Claude API access

## Shell Integration

After building, add to fish config:
```fish
# ~/.config/fish/functions/askc.fish
function askc
    uv run --directory ~/path/to/askc python -m askc $argv
end
```

Or if installed as a tool:
```fish
function askc
    ~/.local/bin/askc $argv
end
```

## Notes

- Keep the fish wrapper minimal - all logic in Python
- Textual handles terminal rendering, keyboard input, async
- Start simple, add features incrementally
- The `y` and `preview` subcommands can still work for shell scripting:
  - `askc y` reads from temp file and executes
  - `askc preview` shows script and safety check
  - But interactive mode is the primary UX
