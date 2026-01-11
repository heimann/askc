# askc

Non-interactive AI assistant for quick terminal questions. Supports multiple backends: OpenCode, Pi, and Claude Code.

## Usage

```bash
askc "your question"              # interactive mode with spinner
askc -p "your question"           # print mode (pipeable)
askc                              # opens $EDITOR for question
askc -b pi "your question"        # use a specific backend
askc logs                         # view recent queries
askc logs 42                      # view specific query by ID
askc usage                        # show API usage costs
```

## Backends

| Backend | CLI Flag | Environment |
|---------|----------|-------------|
| OpenCode | `-b opencode` (default) | Requires `opencode` in PATH |
| Pi | `-b pi` | Requires `pi` in PATH |
| Claude Code | `-b claude` | Requires `claude` in PATH |

Set default backend via environment variable:
```bash
export ASKC_BACKEND=pi
```

## Install

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/heimann/askc.git
cd askc
bun install
```

Run directly:
```bash
bun run src/cli.ts "hello"
```

Or link globally:
```bash
bun link
askc "hello"
```

## Features

- Streaming responses with spinner feedback
- Tool call display during execution
- Query logging to SQLite with cost tracking
- Multiple backend support (OpenCode, Pi, Claude Code)
- Editor mode for longer questions
