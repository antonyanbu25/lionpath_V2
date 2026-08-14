# Task: goal-dispatcher-worker.sh + SQL migration + test script

## Context
Repo: /root/gideon-mesh, worktree at /tmp/mesh-disp-2
Install targets: 
- /root/.hermes/scripts/goal-dispatcher-worker.sh
- /root/.hermes/scripts/curiosity-migrations/003_dispatch_state.sql
- /root/.hermes/scripts/test-goal-dispatcher.sh

## Part 1: goal-dispatcher-worker.sh

A template script the subagent calls to emit results. 
The subagent (dispatched by delegate_task) writes its findings to RESULT_FILE using this template.

```bash
#!/usr/bin/env bash
# goal-dispatcher-worker.sh — called by subagent to emit results
# Env: RESULT_FILE (required), GOAL_ID (optional)

set -euo pipefail

RESULT_FILE="${RESULT_FILE:-}"
GOAL_ID="${GOAL_ID:-unknown}"

if [[ -z "$RESULT_FILE" ]]; then
    echo "ERROR: RESULT_FILE env var is required" >&2
    exit 1
fi

emit_result() {
    local status="$1"  # SUCCESS | FAILED
    local body="$2"
    {
        printf 'STATUS: %s\n' "$status"
        printf '%s\n' "$body"
    } > "$RESULT_FILE"
    sync "$RESULT_FILE"
}

# Usage in subagent:
#   source goal-dispatcher-worker.sh
#   ... do work ...
#   emit_result SUCCESS "Found X. Y is working."
#   ... or on error:
#   emit_result FAILED "Error: Z not found"

# Trap ERR to auto-fail on script errors
trap 'emit_result FAILED "worker trapped at line $LINENO with exit $?"' ERR
```

Also include helper functions:
- `log_msg()` — log to stderr with timestamp
- `check_env()` — verify RESULT_FILE is set and writable
- `read_goal_from_db()` — read goal details from state.db using GOAL_ID

## Part 2: SQL Migration

File: /root/.hermes/scripts/curiosity-migrations/003_dispatch_state.sql

```sql
-- Goal Dispatcher state table
-- Non-breaking: only creates if not exists

CREATE TABLE IF NOT EXISTS goal_dispatch_state (
    goal_id         INTEGER PRIMARY KEY REFERENCES gideon_goals(id) ON DELETE CASCADE,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TEXT,
    dispatched_at   TEXT,
    last_status     TEXT,    -- pending | success | failed | error
    last_result_file TEXT,
    last_error      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gds_status ON goal_dispatch_state(last_status);
```

Add a corresponding .sh migration runner:
File: /root/.hermes/scripts/curiosity-migrations/003_dispatch_state.sh
```bash
#!/usr/bin/env bash
# Run migration 003
DB="${HERMES_DB:-$HERMES_HOME/state.db}"
sqlite3 "$DB" < "$(dirname "$0")/003_dispatch_state.sql"
echo "Migration 003 applied: goal_dispatch_state table"
```

## Part 3: Test script

File: /root/.hermes/scripts/test-goal-dispatcher.sh

Test harness using the real state.db. Tests:

1. **test_migration** — apply migration, verify table created
2. **test_no_stale_goals** — run dispatcher with no stale goals, expect exit 0, "no stale goals"
3. **test_stale_goal_selected** — INSERT a stale active goal, run dispatcher, verify it's picked up
4. **test_flock_contention** — start two dispatchers simultaneously, verify second is skipped (locked out)
5. **test_status_parsing** — create result files with SUCCESS/FAILED/unknown, verify correct DB updates
6. **test_retry_logic** — mock a FAILED result, verify attempts incremented, then mark failed after max

Each test function:
- Sets up test data
- Runs the dispatcher or component
- Asserts expected state
- Cleans up test data

Use `sqlite3 "$DB"` for all DB operations. Use `bash -n` for syntax checks.

## Constraints
- All scripts must pass `bash -n`
- Tests must clean up after themselves (delete test goals)
- Tests must be order-independent
- Use real DB at ~/.hermes/state.db for integration tests
