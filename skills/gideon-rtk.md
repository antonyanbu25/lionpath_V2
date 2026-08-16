---
name: gideon-rtk
description: "CLI output compression for Codex swarm agents — RTK shrinks shell output bytes by 60-90% before the LLM sees it."
version: 1.0.0
author: Gideon
---

# RTK — Rust Token Killer

RTK (`rtk-ai/rtk`) is a CLI proxy that sits between shell commands and the LLM, compressing output before it hits the context window. Single Rust binary, zero dependencies, <10ms overhead.

**Apache 2.0 — clean for mesh use.**

## When to Use

- Any Codex swarm agent runs a shell command (`npm test`, `cargo build`, `pytest`, `git diff`, etc.)
- You want to reduce input token consumption from noisy CLI output
- Works mesh-wide: install once, all agents benefit

## Installation

```bash
# Quick install (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# Verify
rtk --version
rtk gain        # shows savings dashboard
```

**Add to PATH** if needed:
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc  # or ~/.zshrc
```

### Per-Agent Init

```bash
rtk init -g                     # Claude Code / Copilot (default)
rtk init -g --codex             # Codex (OpenAI)
rtk init -g --agent cursor      # Cursor
rtk init -g --agent windsurf   # Windsurf
rtk init --agent cline          # Cline / Roo Code
```

## What RTK Compresses

| Command | Before RTK | After RTK |
|---------|-----------|-----------|
| `ls` / `tree` | One line per file | Tree format with counts |
| `cat` / `read` | Full file body | Signatures + structure |
| `grep` / `rg` | All matches, long lines | Truncated, grouped by file |
| `git status` | Full diff output | Compact stat format |
| `git diff` | Full context | Reduced context, headers stripped |
| `git log` | Full messages | Hash + author + subject |
| `cargo test` / `npm test` | Full output | Failures only |
| `pytest` | Full traceback | Failures only, trimmed |
| `ruff check` | Full output | Grouped by rule + file |
| `docker ps` | All fields | Essential fields only |

**100+ commands** supported. Full list: `rtk --help`.

## Integration with the Gideon Mesh

### Mesh-Wide Hook Install

```bash
# Global install — all agents on this machine
rtk init -g
```

This installs a shell hook that intercepts commands. Every shell invocation from any Codex swarm agent automatically passes through RTK compression before the output reaches the LLM context.

### Manual Per-Command Use

```bash
# Wrap any command explicitly
rtk run -- your-command args

# Example: compress pytest output
rtk run -- pytest tests/

# Show what was saved
rtk gain
```

### Verifying Installation

```bash
rtk --version          # Should show rtk version
rtk gain               # Savings dashboard
rtk discover           # Find existing RTK sessions
```

## Token Savings Reality

RTK honestly documents the savings chain:

1. **RTK compresses bash output bytes** — not tokens directly
2. Compressed bytes → fewer input tokens (contributor, not the whole bill)
3. Input tokens → part of the total bill (output tokens also billed)
4. Savings **dilute at every step**

Reported token counts use `bytes / 4` estimation — percentages are reliable, absolute numbers are approximate.

**Expected range**: 60-90% bash output reduction → ~10-30% effective input token reduction for shell-heavy tasks.

## Limitations

- **Hook conflicts**: If other mesh components install shell hooks (e.g., other agent wrappers), RTK hook must be compatible
- **Windows**: Works natively, but needs ACL checks for SQLite parent directories
- **Name collision**: Another `rtk` project exists on crates.io (Rust Type Kit) — ensure `rtk gain` works after install; if not, use `cargo install --git` directly
- **Shell-only**: RTK compresses CLI output, not HTTP API responses or file reads

## Comparison with Caveman

| | RTK | Caveman |
|--|-----|---------|
| **Layer** | Shell output (bash) | LLM output (responses) |
| **Reduction** | 60-90% bash output bytes | 65% LLM output tokens |
| **License** | Apache 2.0 ✅ | MIT skill / BSL-1.1 engine |
| **Agents** | All CLI agents | All major agents |
| **Install** | Single Rust binary | Node.js + optional binaries |

**Both can run together** — RTK handles shell output, Caveman handles LLM responses. They compress at different layers.

## Verification

```bash
# Test RTK is active
rtk gain

# Run a compressed command
rtk run -- pytest -v

# Compare sizes
pytest -v 2>&1 | wc -c     # before
rtk run -- pytest -v 2>&1 | wc -c  # after
```
