#!/usr/bin/env bash
set -euo pipefail

# goal-dispatcher.sh — Main entrypoint for Gideon's curiosity mesh goal dispatcher.
#
# Queries gideon_goals for stale (due-for-dispatch) goals and delegates each to
# a goal-worker subagent via `hermes delegate_task`.  Manages per-goal locking,
# attempt tracking, result verification, retry, and crash recovery.
#
# Spec: /root/gideon-mesh/docs/plans/2026-08-14-goal-dispatcher.md
# Safe to run multiple times (idempotent).  Does NOT break curiosity-daemon.sh.

# ───────────────────────── 1. Environment Setup ─────────────────────────

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB="${HERMES_DB:-${DB:-$HERMES_HOME/state.db}}"
CURIOSITY_HOME="${CURIOSITY_HOME:-$HERMES_HOME/goal-dispatcher}"
LOCK_DIR="$CURIOSITY_HOME/locks"
RESULTS_DIR="$CURIOSITY_HOME/results"
LOG_DIR="${GOAL_DISPATCHER_LOG_DIR:-$CURIOSITY_HOME/logs}"
GLOBAL_LOCK_FILE="${GOAL_DISPATCHER_GLOBAL_LOCK:-/tmp/goal-dispatcher.global.lock}"

# Staleness thresholds (seconds, for informational logging only — the SQL uses
# datetime modifiers; these mirror the defaults).
MAX_DISPATCH_TIMEOUT=1800   # 30 min per goal
POLL_INTERVAL=5             # seconds between result-file checks
DEFAULT_MAX_ATTEMPTS=3
STALE_PENDING_HOURS=2       # crash-reap threshold

mkdir -p "$LOCK_DIR" "$RESULTS_DIR" "$LOG_DIR"

LOG_FILE="$LOG_DIR/goal-dispatcher.log"

# ───────────────────────── Helpers ─────────────────────────

log() {
    # log LEVEL message...
    local level="${1:-INFO}"
    local ts
    ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
    printf '[%s] [%s] %s\n' "$ts" "$level" "${2:-}" >> "$LOG_FILE"
}

log_info()  { log INFO  "$*"; }
log_warn()  { log WARN  "$*"; }
log_error() { log ERROR "$*"; }

die() {
    log_error "$*"
    printf 'goal-dispatcher: ERROR: %s\n' "$*" >&2
    exit 1
}

require_sqlite3() {
    command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required but not found"
}

sql_quote() {
    # Safely quote a value for SQL string context.
    local value="${1-}"
    value="${value//\'/\'\'}"
    printf "'%s'" "$value"
}

# Execute SQL returning scalar (scalar = first column, first row).
sql_scalar() {
    sqlite3 -noheader -separator $'\t' "$DB" "$@"
}

# Execute SQL (no return).
sql_exec() {
    sqlite3 "$DB" "$@"
}

table_exists() {
    local table="$1" count
    count="$(sql_scalar "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$(sql_quote "$table");")"
    [[ "$count" == "1" ]]
}

column_exists() {
    local table="$1" column="$2" count
    count="$(sql_scalar "SELECT COUNT(*) FROM pragma_table_info($(sql_quote "$table")) WHERE name=$(sql_quote "$column");")"
    [[ "$count" == "1" ]]
}

add_column_if_missing() {
    local table="$1" column="$2" definition="$3"
    if ! column_exists "$table" "$column"; then
        sql_exec "ALTER TABLE $table ADD COLUMN $column $definition;"
    fi
}

# Resolve whether the gideon_goals table uses 'goal' or 'title' as the text column.
goal_text_column() {
    if column_exists gideon_goals goal; then
        printf 'goal'
    elif column_exists gideon_goals title; then
        printf 'title'
    else
        die "gideon_goals has neither 'goal' nor 'title' column"
    fi
}

# ───────────────────────── 2. Schema Migration ─────────────────────────

migrate_schema() {
    # Ensure gideon_goals exists (callers may run before curiosity-daemon).
    if ! table_exists gideon_goals; then
        sql_exec "
          CREATE TABLE IF NOT EXISTS gideon_goals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            goal        TEXT NOT NULL,
            parent_id   INTEGER,
            status      TEXT DEFAULT 'active',
            progress    INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
          );
        "
    fi

    # Non-breaking column additions (matches 002_goals_columns.sh pattern).
    add_column_if_missing gideon_goals "source"           "TEXT DEFAULT 'manual'"
    add_column_if_missing gideon_goals "status"           "TEXT DEFAULT 'active'"
    add_column_if_missing gideon_goals "last_progress_at" "TEXT"
    add_column_if_missing gideon_goals "progress_log"     "TEXT DEFAULT '[]'"
    add_column_if_missing gideon_goals "priority"         "TEXT DEFAULT 'medium'"
    add_column_if_missing gideon_goals "description"      "TEXT"

    # Dispatch-state table (idempotent).
    sql_exec "
      CREATE TABLE IF NOT EXISTS goal_dispatch_state (
        goal_id          INTEGER PRIMARY KEY REFERENCES gideon_goals(id) ON DELETE CASCADE,
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_ATTEMPTS},
        last_attempt_at  TEXT,
        dispatched_at    TEXT,
        last_status      TEXT,
        last_result_file TEXT,
        last_error       TEXT,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_gds_status ON goal_dispatch_state(last_status);
    "
}

# ───────────────────────── 3. Stale-Goal Query ─────────────────────────

# Returns rows (tab-separated): id<TAB>goal_text<TAB>description<TAB>priority<TAB>attempts
query_stale_goals() {
    local text_col
    text_col="$(goal_text_column)"

    # Use COALESCE so the text column works whether it's 'goal' or 'title'.
    sql_scalar "
      SELECT g.id,
             COALESCE(g.${text_col}, '') AS goal_text,
             COALESCE(g.description, '') AS description,
             COALESCE(g.priority, 'medium') AS priority,
             COALESCE(s.attempts, 0) AS attempts
      FROM gideon_goals g
      LEFT JOIN goal_dispatch_state s ON s.goal_id = g.id
      WHERE g.status = 'active'
        AND COALESCE(s.attempts, 0) < COALESCE(s.max_attempts, ${DEFAULT_MAX_ATTEMPTS})
        AND COALESCE(s.last_status, '') != 'pending'
        AND (
          s.goal_id IS NULL
          OR s.last_attempt_at IS NULL
          OR (
            CASE g.priority
              WHEN 'high'   THEN s.last_attempt_at <= datetime('now', '-1 hour')
              WHEN 'medium' THEN s.last_attempt_at <= datetime('now', '-6 hours')
              WHEN 'low'    THEN s.last_attempt_at <= datetime('now', '-24 hours')
              ELSE               s.last_attempt_at <= datetime('now', '-24 hours')
            END
          )
        )
      ORDER BY
        CASE g.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        g.created_at ASC
      LIMIT 25;
    "
}

# ───────────────────────── 4. Global Flock ─────────────────────────

acquire_global_lock() {
    exec 9>"$GLOBAL_LOCK_FILE"
    if ! flock -n 9; then
        log_warn "another goal-dispatcher instance is running (could not acquire $GLOBAL_LOCK_FILE); exiting"
        exit 0
    fi
    log_info "acquired global lock: $GLOBAL_LOCK_FILE"
}

# ───────────────────────── 6. Crash Recovery ─────────────────────────

reap_stale_pending() {
    # Reap stale 'pending' entries older than STALE_PENDING_HOURS hours.
    # These are goals whose dispatch was interrupted (dispatcher crashed).
    local reaped
    reaped=$(sql_scalar "
      UPDATE goal_dispatch_state
      SET last_status = 'error',
          last_error  = 'dispatcher crashed during pending',
          updated_at  = datetime('now')
      WHERE last_status = 'pending'
        AND last_attempt_at < datetime('now', '-${STALE_PENDING_HOURS} hours')
      RETURNING goal_id;
    " 2>/dev/null || true)

    # Fallback: some sqlite3 builds lack RETURNING; use select-then-update.
    if [[ -z "${reaped:-}" ]]; then
        local stale_ids
        stale_ids=$(sql_scalar "
          SELECT goal_id FROM goal_dispatch_state
          WHERE last_status = 'pending'
            AND last_attempt_at < datetime('now', '-${STALE_PENDING_HOURS} hours');
        " 2>/dev/null || true)
        if [[ -n "$stale_ids" ]]; then
            while IFS= read -r gid; do
                [[ -n "$gid" ]] || continue
                sql_exec "
                  UPDATE goal_dispatch_state
                  SET last_status = 'error',
                      last_error  = 'dispatcher crashed during pending',
                      updated_at  = datetime('now')
                  WHERE goal_id = ${gid};
                "
                reaped+="${gid}\n"
            done <<< "$stale_ids"
        fi
    fi

    # Count reaped for logging.
    local count=0
    while IFS= read -r _line; do
        [[ -n "$_line" ]] && ((count++)) || true
    done <<< "${reaped}"
    if (( count > 0 )); then
        log_warn "reaped $count stale pending goal(s) (crash recovery, >${STALE_PENDING_HOURS}h)"
    fi
}

# ───────────────────────── 5. Per-Goal Dispatch ─────────────────────────

# dispatch_goal: dispatch one goal to a goal-worker subagent.
# Usage: dispatch_goal <id> <goal_text> <description> <priority> <attempt>
dispatch_goal() {
    local goal_id="$1" goal_text="$2" description="$3" priority="$4" attempt="$5"

    local goal_lock="$LOCK_DIR/goal-${goal_id}.lock"

    exec 8>"$goal_lock"
    if ! flock -n 8; then
        log_warn "goal $goal_id: another dispatcher holds the per-goal lock; skipping"
        return 0
    fi

    # ── Double-check staleness inside the lock (idempotency) ──
    local current_status
    current_status=$(sql_scalar "
      SELECT COALESCE(last_status, '')
      FROM goal_dispatch_state
      WHERE goal_id = ${goal_id};
    " 2>/dev/null || true)
    if [[ "$current_status" == "pending" ]]; then
        log_info "goal $goal_id: already pending after acquiring lock; skipping"
        return 0
    fi

    # ── UPSERT goal_dispatch_state ──
    # attempts++, last_attempt_at = now, last_status = 'pending', dispatched_at = now
    local new_attempt=$((attempt + 1))
    sql_exec "
      INSERT INTO goal_dispatch_state (goal_id, attempts, max_attempts, last_attempt_at, dispatched_at, last_status, updated_at)
      VALUES (${goal_id}, 1, ${DEFAULT_MAX_ATTEMPTS}, datetime('now'), datetime('now'), 'pending', datetime('now'))
      ON CONFLICT(goal_id) DO UPDATE SET
        attempts        = goal_dispatch_state.attempts + 1,
        last_attempt_at = datetime('now'),
        dispatched_at    = datetime('now'),
        last_status      = 'pending',
        last_error       = NULL,
        updated_at       = datetime('now');
    "

    log_info "goal $goal_id: dispatched (attempt $new_attempt, priority=$priority)"

    # ── Result file ──
    local result_file="$RESULTS_DIR/goal-${goal_id}-attempt-${new_attempt}.out"
    rm -f "$result_file"  # clean any stale leftover

    # ── Spawn subagent via hermes chat --cli ──
    log_info "goal $goal_id: spawning subagent (timeout=${MAX_DISPATCH_TIMEOUT}s)"
    local delegate_rc=0
    export RESULT_FILE="$result_file"
    export GOAL_ID="$goal_id"
    hermes chat --cli -q "You are a goal-worker for Gideon's curiosity mesh.

GOAL ID: ${goal_id}
GOAL: ${goal_text}
DESCRIPTION: ${description}
PRIORITY: ${priority}

Your task:
1. Work toward achieving the goal described above.
2. When you are done (success or failure), write your result to the file whose
   path is in the environment variable RESULT_FILE.

The result file MUST have this format:
  First line:  STATUS: SUCCESS   (or)   STATUS: FAILED
  Remaining lines: details / explanation / summary of what you did.

If you encounter an unrecoverable error, write STATUS: FAILED with the error details.
Do NOT leave the result file empty.

RESULT_FILE is: ${result_file}
GOAL_ID is: ${goal_id}" \
        >> "$LOG_FILE" 2>&1 || delegate_rc=$?

    if (( delegate_rc != 0 )); then
        log_error "goal $goal_id: subagent spawn failed (rc=$delegate_rc)"
    fi

    # ── Poll for result_file ──
    log_info "goal $goal_id: polling for result file: $result_file"
    local elapsed=0
    while (( elapsed < MAX_DISPATCH_TIMEOUT )); do
        if [[ -s "$result_file" ]]; then
            break
        fi
        sleep "$POLL_INTERVAL"
        elapsed=$((elapsed + POLL_INTERVAL))
    done

    # ── Verify result ──
    verify_result "$goal_id" "$new_attempt" "$result_file"
}

# ───────────────────────── 5 (cont). Result Verification ─────────────────────────

# verify_result <goal_id> <attempt> <result_file>
verify_result() {
    local goal_id="$1" attempt="$2" rf="$3"

    if [[ ! -s "$rf" ]]; then
        log_error "goal $goal_id: no result file or empty (timeout after ${MAX_DISPATCH_TIMEOUT}s)"
        update_state "$goal_id" "$attempt" "error" "" "no result file or timeout"
        handle_failure_or_retry "$goal_id" "$attempt"
        return 1
    fi

    local first_line
    first_line="$(head -n1 "$rf" | tr -d '\r' | tr '[:lower:]' '[:upper:]')"
    first_line="${first_line#"${first_line%%[![:space:]]*}"}"  # trim leading whitespace

    case "$first_line" in
        "STATUS: SUCCESS")
            log_info "goal $goal_id: result STATUS: SUCCESS"
            sql_exec "UPDATE gideon_goals SET status='completed', updated_at=datetime('now') WHERE id=${goal_id};"
            update_state "$goal_id" "$attempt" "success" "$rf" ""
            ;;
        "STATUS: FAILED")
            log_warn "goal $goal_id: result STATUS: FAILED"
            update_state "$goal_id" "$attempt" "failed" "$rf" "subagent reported failure"
            handle_failure_or_retry "$goal_id" "$attempt"
            ;;
        *)
            log_error "goal $goal_id: unknown status in result: '$first_line'"
            update_state "$goal_id" "$attempt" "error" "$rf" "unknown status: $first_line"
            handle_failure_or_retry "$goal_id" "$attempt"
            ;;
    esac
}

# update_state <goal_id> <attempt> <status> <result_file> <error>
update_state() {
    local goal_id="$1" attempt="$2" status="$3" rf="$4" error="$5"
    local rf_quoted err_quoted
    rf_quoted="$(sql_quote "$rf")"
    err_quoted="$(sql_quote "$error")"
    sql_exec "
      UPDATE goal_dispatch_state
      SET last_status      = $(sql_quote "$status"),
          last_result_file = ${rf_quoted},
          last_error       = ${err_quoted},
          attempts         = ${attempt},
          updated_at       = datetime('now')
      WHERE goal_id = ${goal_id};
    "
}

# handle_failure_or_retry <goal_id> <attempt>
# 7. Retry logic — reset for next cycle or mark goal as failed.
handle_failure_or_retry() {
    local goal_id="$1" attempt="$2"

    local max_att
    max_att=$(sql_scalar "
      SELECT COALESCE(max_attempts, ${DEFAULT_MAX_ATTEMPTS})
      FROM goal_dispatch_state
      WHERE goal_id = ${goal_id};
    " 2>/dev/null || echo "$DEFAULT_MAX_ATTEMPTS")

    if (( attempt < max_att )); then
        # Reset last_status to empty (not 'pending') so next dispatcher cycle picks it up.
        log_info "goal $goal_id: will retry (attempt ${attempt}/${max_att}); resetting state for next cycle"
        sql_exec "
          UPDATE goal_dispatch_state
          SET last_status = '',
              updated_at  = datetime('now')
          WHERE goal_id = ${goal_id};
        "
    else
        log_error "goal $goal_id: max attempts (${max_att}) reached; marking goal as failed"
        sql_exec "UPDATE gideon_goals SET status='failed', updated_at=datetime('now') WHERE id=${goal_id};"
        sql_exec "
          UPDATE goal_dispatch_state
          SET last_status = 'failed',
              updated_at  = datetime('now')
          WHERE goal_id = ${goal_id};
        "
    fi
}

# ───────────────────────── Main ─────────────────────────

main() {
    require_sqlite3
    # Ensure DB file exists.
    mkdir -p "$(dirname "$DB")"
    [[ -f "$DB" ]] || sql_exec "PRAGMA user_version;" >/dev/null

    log_info "=== goal-dispatcher run starting ==="

    acquire_global_lock
    migrate_schema
    reap_stale_pending

    # Query stale goals.
    local stale_output
    stale_output="$(query_stale_goals)"

    if [[ -z "$stale_output" ]]; then
        log_info "no stale goals to dispatch"
        log_info "=== goal-dispatcher run complete ==="
        exit 0
    fi

    local stale_count
    stale_count=$(printf '%s\n' "$stale_output" | grep -c . || true)
    log_info "found ${stale_count} stale goal(s) to dispatch"

    # Process each stale goal.
    local goal_id goal_text description priority attempts
    while IFS=$'\t' read -r goal_id goal_text description priority attempts; do
        # Validate goal_id is numeric.
        [[ "$goal_id" =~ ^[0-9]+$ ]] || continue

        log_info "processing goal $goal_id: [$priority] ${goal_text:0:80}"

        # Dispatch (collect errors so one bad goal doesn't stop the loop).
        if ! dispatch_goal "$goal_id" "$goal_text" "$description" "$priority" "$attempts"; then
            log_error "goal $goal_id: dispatch_goal returned non-zero, continuing"
        fi
    done <<< "$stale_output"

    log_info "=== goal-dispatcher run complete ==="
}

main "$@"
