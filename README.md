# askc

Non-interactive Claude Code on the command line for one off tasks.

## Usage

```bash
askc "your question"     # interactive mode
askc -p "your question"  # print mode (pipeable)
askc                     # opens $EDITOR for question
```

## Install

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/heimann/askc.git
cd askc
uv sync
```

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

Run with `uv run askc` or install globally:

```bash
uv tool install -e .
askc "hello"
```
