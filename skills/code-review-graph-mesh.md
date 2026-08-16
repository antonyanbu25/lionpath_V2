---
name: code-review-graph-mesh
description: "Code intelligence graph MCP server for scoped code context in Codex swarm worktrees — entity extraction, dependency edges, blast-radius queries."
version: 1.0.0
author: Gideon
---

# code-review-graph — MCP Skill for Scoped Code Context

## When to Use

Use when a Codex swarm agent needs **scoped, dependency-aware code context** instead of loading entire files or directories. This MCP server builds a lightweight code intelligence graph from a worktree's source tree, enabling:

- **Blast-radius queries** — "what files are affected if I change `goal-dispatcher.sh`?"
- **Dependency lookups** — "what does `curiosity-act.sh` import/source?"
- **Reverse dependencies** — "who calls `mesh-memory.sh`?"
- **Scoped context extraction** — "give me only the functions touched by this diff"
- **Conflict detection** — "do two worktrees touch overlapping dependency subtrees?"

This is critical for Codex swarm patterns where each agent owns a disjoint file set (see `docs/plans/2026-08-11-power-upgrades.md`). The graph lets the critic agent (`scripts/critic-agent.sh`) and task router verify that worktree changes stay within their assigned scope.

## Architecture

```
┌─────────────────────────────────────────┐
│       Codex Swarm Agent (worktree)      │
│                                         │
│  codex / delegate_task / curiosity-act  │
└───────────────┬─────────────────────────┘
                │ MCP stdio / HTTP
                ▼
┌─────────────────────────────────────────┐
│     code-review-graph MCP Server        │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ Indexer  │→ │ Graph DB │← │ Query  │ │
│  │ (AST/   │  │ (SQLite) │  │ Engine │ │
│  │  regex) │  │          │  │        │ │
│  └─────────┘  └──────────┘  └────────┘ │
│       │                          │      │
│       ▼                          ▼      │
│  ┌──────────┐           ┌─────────────┐ │
│  │ Entity   │           │ Scoped      │ │
│  │ Extractor│           │ Context     │ │
│  │          │           │ Extractor   │ │
│  └──────────┘           └─────────────┘ │
└─────────────────────────────────────────┘
```

### Data Model

The graph is stored in a per-worktree SQLite database at `~/.hermes/code-graph/<worktree-name>.db`:

```sql
-- Code entities: files, functions, classes, modules
CREATE TABLE IF NOT EXISTS graph_nodes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worktree    TEXT NOT NULL,             -- worktree name / path hash
    file_path   TEXT NOT NULL,             -- relative path within worktree
    node_type   TEXT NOT NULL,             -- file | function | class | module | variable
    name        TEXT NOT NULL,             -- entity name (function name, class name, etc.)
    start_line  INTEGER,
    end_line    INTEGER,
    signature   TEXT,                     -- function/class signature
    attributes  TEXT,                      -- JSON: {language, visibility, is_exported, ...}
    content_hash TEXT,                     -- SHA-256 of entity body (for change detection)
    indexed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dependency edges: imports, sources, calls, definitions
CREATE TABLE IF NOT EXISTS graph_edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worktree    TEXT NOT NULL,
    source_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_id   INTEGER REFERENCES graph_nodes(id) ON DELETE CASCADE, -- nullable for external deps
    edge_type   TEXT NOT NULL,             -- imports | sources | calls | defines | references
    target_name TEXT,                      -- resolved name if target_id is NULL (external symbol)
    target_file TEXT,                      -- resolved file path if known
    line_number INTEGER,
    attributes  TEXT,                      -- JSON: {dynamic: true, conditional: false, ...}
    indexed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Change-tracking: what changed since last index
CREATE TABLE IF NOT EXISTS graph_changes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worktree    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    change_type TEXT NOT NULL,             -- added | modified | deleted
    old_hash    TEXT,
    new_hash    TEXT,
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_nodes_worktree_file ON graph_nodes(worktree, file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_worktree_name ON graph_nodes(worktree, name);
CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_target_name ON graph_edges(worktree, target_name);
```

## MCP Tools

The server exposes these MCP tools (registered via Hermes config or native MCP client):

### 1. `index_worktree`

Indexes a worktree's source tree into the graph. Re-indexing is incremental — only files whose content hash has changed are re-parsed.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_path` | string | yes | Absolute path to the git worktree |
| `worktree_name` | string | no | Human-friendly name (defaults to basename) |
| `file_globs` | string[] | no | Limit to specific globs (default: `**/*.{sh,py,js,ts,md,json,yaml,yml}`) |
| `force` | boolean | no | Re-index all files even if unchanged (default: false) |

**Returns:** `{ indexed_files: int, new_nodes: int, new_edges: int, changes: int }`

**Entity extraction strategy:**

| Language | Extraction Method | Node Types | Edge Types |
|----------|------------------|------------|------------|
| Bash (`.sh`) | Regex + `source`/function parsing | file, function | sources, calls, defines |
| Python (`.py`) | `ast` module | file, function, class, module | imports, calls, defines |
| Markdown (`.md`) | Section heading + link parsing | file, section | references |
| JSON/YAML | Structural key extraction | file, key, section | references |

For bash files (the dominant language in gideon-mesh), the indexer:
1. Extracts `source` and `.` (dot-source) statements → `sources` edges to target file node
2. Extracts function definitions (`name() {` blocks) → `function` nodes with start/end lines
3. Extracts function call sites within function bodies → `calls` edges
4. Extracts `command -v` / `which` checks → `references` edges to external tools
5. Extracts env var reads (`$VAR`, `${VAR}`) → `references` edges to variable nodes

### 2. `query_dependencies`

Returns all entities that a given file or function depends on (direct, or transitive up to `depth`).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_name` | string | yes | Worktree to query |
| `entity` | string | yes | File path or entity name |
| `edge_types` | string[] | no | Filter: `sources, imports, calls, references` (default: all) |
| `depth` | int | no | Transitive depth (default: 1, max: 5) |
| `include_external` | boolean | no | Include unresolved/external deps (default: false) |

**Returns:** Array of `{ node_id, file_path, node_type, name, edge_type, depth }`

**Example:**

```bash
# What does curiosity-act.sh depend on?
mcp call code-review-graph query_dependencies \
  --worktree-name gideon-mesh \
  --entity scripts/curiosity-act.sh \
  --edge-types sources,calls \
  --depth 1
```

Returns:
```json
[
  {"node_id": 42, "file_path": "scripts/lib/curiosity-act-primitives.sh", "node_type": "file", "name": "curiosity-act-primitives.sh", "edge_type": "sources", "depth": 1},
  {"node_id": 55, "file_path": "scripts/curiosity-act-primitives.sh", "node_type": "function", "name": "act_memory_write", "edge_type": "calls", "depth": 1},
  {"node_id": 56, "file_path": "scripts/curiosity-act-primitives.sh", "node_type": "function", "name": "act_skill_patch", "edge_type": "calls", "depth": 1},
  {"node_id": 57, "file_path": "scripts/curiosity-act-primitives.sh", "node_type": "function", "name": "act_goal_register", "edge_type": "calls", "depth": 1}
]
```

### 3. `query_reverse_dependencies`

Returns all entities that depend on a given file or function (the "who uses me" query). This is the **blast-radius** query.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_name` | string | yes | Worktree to query |
| `entity` | string | yes | File path or entity name |
| `depth` | int | no | Transitive depth (default: 1, max: 5) |
| `filter_files` | string[] | no | Only return results matching these file globs |

**Returns:** Array of `{ node_id, file_path, node_type, name, edge_type, depth }`

**Example — blast-radius of changing `curiosity-act-primitives.sh`:**

```bash
mcp call code-review-graph query_reverse_dependencies \
  --worktree-name gideon-mesh \
  --entity scripts/lib/curiosity-act-primitives.sh \
  --depth 2
```

Returns:
```json
[
  {"node_id": 30, "file_path": "scripts/curiosity-act.sh", "node_type": "file", "name": "curiosity-act.sh", "edge_type": "sources", "depth": 1},
  {"node_id": 31, "file_path": "scripts/curiosity-verify.sh", "node_type": "file", "name": "curiosity-verify.sh", "edge_type": "sources", "depth": 1},
  {"node_id": 12, "file_path": "scripts/curiosity-daemon.sh", "node_type": "function", "name": "do_act", "edge_type": "calls", "depth": 2}
]
```

### 4. `get_scoped_context`

Extracts only the code relevant to a specific change set (diff, entity list, or blast-radius window). This is the primary tool for giving a Codex agent **exactly the context it needs** — no more, no less.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_name` | string | yes | Worktree to query |
| `scope` | string | yes | `diff:<base>..<head>`, `entity:<name>`, `file:<path>`, or `blast:<file>:<depth>` |
| `include_deps` | boolean | no | Include dependencies of scoped entities (default: true, depth 1) |
| `include_reverse_deps` | boolean | no | Include reverse dependencies (default: false) |
| `max_tokens` | int | no | Approximate token budget for returned context (default: 8000) |
| `output_format` | string | no | `json` or `markdown` (default: `markdown`) |

**Returns:** Scoped context as structured markdown or JSON, containing only the relevant function bodies, signatures, and dependency notes.

**Example — give a Codex agent context for modifying `goal-dispatcher.sh`:**

```bash
mcp call code-review-graph get_scoped_context \
  --worktree-name gideon-mesh \
  --scope "blast:scripts/goal-dispatcher.sh:2" \
  --max-tokens 6000 \
  --output-format markdown
```

Returns a markdown document containing:
1. The full body of `goal-dispatcher.sh`
2. Signatures + docstrings of directly-sourced files (`goal-dispatcher-worker.sh`, `curiosity-act-primitives.sh`)
3. One-liner summaries of transitive dependencies
4. Any files that source or call `goal-dispatcher.sh` (reverse deps)

### 5. `check_scope_boundary`

Verifies that a change set stays within an agent's assigned file ownership. Used by the critic agent and task router for swarm partition enforcement.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_name` | string | yes | Worktree to check |
| `changed_files` | string[] | yes | List of file paths changed in the worktree |
| `owned_files` | string[] | yes | List of file globs the agent is assigned to own |
| `check_reverse_deps` | boolean | no | Also flag if changes affect reverse deps outside owned set (default: true) |

**Returns:**

```json
{
  "in_scope": ["scripts/goal-dispatcher.sh"],
  "out_of_scope": ["scripts/curiosity-daemon.sh"],
  "reverse_dep_violations": [
    {"changed_file": "scripts/goal-dispatcher.sh", "affected_file": "scripts/curiosity-daemon.sh", "edge_type": "calls", "reason": "curiosity-daemon.sh calls goal-dispatcher.sh"}
  ],
  "verdict": "REJECT"
}
```

**Example — critic integration:**

```bash
# In critic-agent.sh, after git show --stat HEAD:
CHANGED_FILES=$(git -C "$worktree_dir" show --name-only --format="" HEAD)
OWNED_FILES=$(extract_owned_files "$spec_file")
RESULT=$(mcp call code-review-graph check_scope_boundary \
  --worktree-name "$worktree_name" \
  --changed-files "$CHANGED_FILES" \
  --owned-files "$OWNED_FILES")

if echo "$RESULT" | jq -r '.verdict' | grep -q REJECT; then
  reasons+=("scope boundary violation: $(echo "$RESULT" | jq -r '.out_of_scope | join(", ")')")
  reasons+=("reverse dep impact: $(echo "$RESULT" | jq -r '.reverse_dep_violations[].affected_file' | sort -u | tr '\n' ' ')"
fi
```

### 6. `detect_conflicts`

Checks whether two worktrees' change sets have overlapping dependency subtrees. Used by the orchestrator before merging parallel branches.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_a` | string | yes | First worktree name |
| `worktree_b` | string | yes | Second worktree name |
| `depth` | int | no | Dependency depth to check (default: 2) |

**Returns:**

```json
{
  "conflicts": [
    {
      "file": "scripts/lib/curiosity-act-primitives.sh",
      "changed_in_a": true,
      "changed_in_b": true,
      "shared_reverse_deps": ["scripts/curiosity-act.sh", "scripts/curiosity-verify.sh"],
      "severity": "high"
    }
  ],
  "no_conflict_files": 15
}
```

**Example — merge-order check:**

```bash
# Before merging D1-eventbus and D3-goalqueue:
RESULT=$(mcp call code-review-graph detect_conflicts \
  --worktree-a D1-eventbus \
  --worktree-b D3-goalqueue \
  --depth 2)

CONFLICTS=$(echo "$RESULT" | jq '.conflicts | length')
if [ "$CONFLICTS" -gt 0 ]; then
  echo "WARNING: $CONFLICTS file conflicts detected — merge order matters"
  echo "$RESULT" | jq -r '.conflicts[] | "  \(.file) (severity: \(.severity))"'
fi
```

### 7. `get_graph_stats`

Returns summary statistics about the code intelligence graph for a worktree.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worktree_name` | string | yes | Worktree to query |

**Returns:**

```json
{
  "worktree": "gideon-mesh",
  "total_files": 47,
  "total_nodes": 312,
  "total_edges": 548,
  "node_type_counts": {"file": 47, "function": 198, "class": 12, "module": 5},
  "edge_type_counts": {"sources": 23, "imports": 8, "calls": 401, "defines": 89, "references": 27},
  "most_depended_on": [
    {"name": "scripts/lib/curiosity-act-primitives.sh", "reverse_dep_count": 4},
    {"name": "scripts/agent-radio.sh", "reverse_dep_count": 6}
  ],
  "last_indexed": "2026-08-14T22:46:00Z"
}
```

## Installation

### 1. Server script

Place the MCP server at `~/.hermes/scripts/code-review-graph-mcp.sh`:

```bash
#!/usr/bin/env bash
# code-review-graph-mcp.sh — MCP stdio server for code intelligence graph
#
# Protocol: JSON-RPC over stdio (MCP stdio transport)
# Storage:  ~/.hermes/code-graph/<worktree-name>.db (SQLite)
# Deps:    sqlite3, python3 (for AST parsing), coreutils

set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
GRAPH_DIR="${GRAPH_DIR:-$HERMES_HOME/code-graph}"
mkdir -p "$GRAPH_DIR"

# MCP stdio protocol loop — reads JSON-RPC from stdin, writes to stdout
while IFS= read -r line; do
    method=$(echo "$line" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('method',''))" 2>/dev/null || echo "")
    case "$method" in
        initialize)    echo '{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"tools":{}}}}' ;;
        tools/list)    echo "$TOOLS_LIST_JSON" ;;  # pre-built JSON of tool schemas
        tools/call)    handle_tool_call "$line" ;;
        *)             echo '{"jsonrpc":"2.0","error":{"code":-32601,"message":"method not found"}}' ;;
    esac
done
```

### 2. Hermes MCP configuration

Add to `~/.hermes/config.yaml` under the `mcp.servers` key:

```yaml
mcp:
  servers:
    code-review-graph:
      command: bash
      args:
        - ~/.hermes/scripts/code-review-graph-mcp.sh
      env:
        GRAPH_DIR: ~/.hermes/code-graph
        HERMES_DB: ~/.hermes/state.db
```

After adding, restart Hermes or run `hermes mcp reload` for the native MCP client to pick up the new server.

### 3. Verify

```bash
# Check the server starts
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | bash ~/.hermes/scripts/code-review-graph-mcp.sh

# Index a worktree
mcp call code-review-graph index_worktree \
  --worktree-path /root/gideon-mesh \
  --worktree-name gideon-mesh

# Query stats
mcp call code-review-graph get_graph_stats --worktree-name gideon-mesh

# Check blast radius
mcp call code-review-graph query_reverse_dependencies \
  --worktree-name gideon-mesh \
  --entity scripts/lib/curiosity-act-primitives.sh \
  --depth 2
```

## Codex Swarm Integration

### Indexing before dispatch

Before dispatching a Codex agent to a worktree, the orchestrator indexes it:

```bash
# In goal-dispatcher-worker.sh or task-router, before delegate_task:
mcp call code-review-graph index_worktree \
  --worktree-path "$WORKTREE_PATH" \
  --worktree-name "$WORKTREE_NAME"
```

### Scoped context injection

Instead of loading entire files, the orchestrator injects scoped context into the agent prompt:

```bash
SCOPED_CONTEXT=$(mcp call code-review-graph get_scoped_context \
  --worktree-name "$WORKTREE_NAME" \
  --scope "blast:$TARGET_FILE:2" \
  --max-tokens 6000 \
  --output-format markdown)

PROMPT="You are working in worktree $WORKTREE_NAME.
Your target: $TARGET_FILE

## Scoped Code Context
$SCOPED_CONTEXT

## Task
$TASK_DESCRIPTION"

hermes delegate_task --prompt "$PROMPT" --timeout 1800
```

### Post-merge critic check

The critic agent uses `check_scope_boundary` to verify the Codex agent didn't stray outside its assigned file set:

```bash
# In critic-agent.sh, after extracting changed files:
SCOPE_CHECK=$(mcp call code-review-graph check_scope_boundary \
  --worktree-name "$WORKTREE_NAME" \
  --changed-files "$CHANGED_FILES_CSV" \
  --owned-files "$OWNED_FILES_CSV")

VERDICT=$(echo "$SCOPE_CHECK" | jq -r '.verdict')
if [[ "$VERDICT" == "REJECT" ]]; then
    OUTCOME="REJECT"
    VIOLATIONS=$(echo "$SCOPE_CHECK" | jq -r '.out_of_scope | join(", ")')
    REVERSE_VIOLATIONS=$(echo "$SCOPE_CHECK" | jq -r '.reverse_dep_violations[].affected_file' | sort -u | tr '\n' ' ')
    reasons+=("scope boundary violated: $VIOLATIONS")
    [[ -n "$REVERSE_VIOLATIONS" ]] && reasons+=("reverse-dep impact on: $REVERSE_VIOLATIONS")
fi
```

### Merge-order conflict detection

Before merging two parallel branches, the orchestrator checks for dependency conflicts:

```bash
CONFLICTS=$(mcp call code-review-graph detect_conflicts \
  --worktree-a "$BRANCH_A" \
  --worktree-b "$BRANCH_B" \
  --depth 2)

CONFLICT_COUNT=$(echo "$CONFLICTS" | jq '.conflicts | length')
if [ "$CONFLICT_COUNT" -gt 0 ]; then
    echo "WARNING: $CONFLICT_COUNT conflict(s) — adjust merge order or rebase"
    echo "$CONFLICTS" | jq -r '.conflicts[] | "  \(.file) [\(.severity)]"'
    # High-severity: both branches changed the same file
    # Medium: one changed a file, other changed a reverse-dep of it
    # Low: shared transitive dep but neither changed it directly
fi
```

## Incremental Indexing

Re-indexing is cheap. The indexer:
1. Walks the file tree matching `file_globs`
2. Computes SHA-256 of each file
3. Compares to `content_hash` in `graph_nodes` (for `file` type nodes)
4. Re-parses only changed files (new, modified, or deleted since last index)
5. Deletes nodes/edges for deleted files
6. Records changes in `graph_changes` table

For a 50-file repository like gideon-mesh, re-indexing takes < 2 seconds. The index can be rebuilt from scratch at any time with `--force`.

## Constraints

- All graph databases are per-worktree — no cross-worktree pollution
- The server is **read-only** during agent execution; indexing happens before dispatch
- `check_scope_boundary` verdicts are advisory — the critic agent makes the final ACCEPT/REJECT call
- External dependencies (system binaries, npm packages) are recorded as `references` edges with `target_name` but `target_id=NULL`
- The indexer does NOT execute any code — it is purely a static analysis tool
- Graph DBs are disposable: deleting `~/.hermes/code-graph/<name>.db` and re-indexing is always safe
- SQLite-only — no external database server needed (consistent with gideon-mesh conventions)

## Files

| File | Location | Purpose |
|------|----------|---------|
| `code-review-graph-mcp.sh` | `~/.hermes/scripts/` | MCP stdio server (JSON-RPC loop + tool handlers) |
| `code-graph-index.py` | `~/.hermes/scripts/` | Python indexer (AST/regex extraction, incremental hash check) |
| `<worktree>.db` | `~/.hermes/code-graph/` | Per-worktree SQLite graph database |

## Related

- `scripts/critic-agent.sh` — uses `check_scope_boundary` for ACCEPT/REJECT verdicts
- `scripts/goal-dispatcher.sh` — indexes worktrees before dispatching Codex agents
- `scripts/task-router-daemon.sh` — can use `detect_conflicts` before assigning parallel tasks
- `docs/plans/2026-08-11-power-upgrades.md` — swarm partition rules that `check_scope_boundary` enforces
- `docs/plans/critic.md` — critic sub-agent contract
- Hermes `hermes-agent` skill — for `mcp.servers` configuration syntax
- `parallel-codex-worktrees` skill — for worktree creation and agent dispatch patterns
