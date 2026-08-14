#!/usr/bin/env bash
# goal-dispatcher-worker.sh — called by subagent to emit results
# Owner: Agent 2 (mesh-disp-2)
#
# Env:
#   RESULT_FILE  (required) — path to file where results are written
#   GOAL_ID      (optional) — gideon_goals.id for DB lookups
#   HERMES_HOME  (optional) — defaults to /root/.hermes
#   HERMES_DB    (optional) — overrides state.db path
#
# Usage in a subagent:
#   source goal-dispatcher-worker.sh
#   check_env
#   ... do work ...
#   emit_result SUCCESS "Found X. Y is working."
#   ... or on error:
#   emit_result FAILED "Error: Z not found"

set -euo pipefail

GOAL_ID="${GOAL_ID:-unknown}"
HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
HERMES_DB="${HERMES_DB:-${DB:-$HERMES_HOME/state.db}}"
RESULT_FILE="${RESULT_FILE:-}"

###############################################################################
# Helpers
###############################################################################

# log_msg — log a timestamped message to stderr; never disturbs stdout.
log_msg() {
    local msg="$*"
    printf '%s [worker:%s] %s\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$GOAL_ID" "$msg" >&2
}

# check_env — verify RESULT_FILE is set and the directory is writable.
check_env() {
    if [[ -z "$RESULT_FILE" ]]; then
        echo "ERROR: RESULT_FILE env var is required" >&2
        exit 1
    fi
    local result_dir
    result_dir="$(dirname "$RESULT_FILE")"
    if [[ ! -d "$result_dir" ]]; then
        mkdir -p "$result_dir" || {
            echo "ERROR: cannot create RESULT_FILE dir $result_dir" >&2
            exit 1
        }
    fi
    if ! touch "$RESULT_FILE" 2>/dev/null; then
        echo "ERROR: RESULT_FILE not writable: $RESULT_FILE" >&2
        exit 1
    fi
    log_msg "env OK: RESULT_FILE=$RESULT_FILE"
}

# read_goal_from_db — read goal details from state.db using GOAL_ID.
# Echoes a single line of key=value pairs. Returns 1 if not found.
read_goal_from_db() {
    if [[ "$GOAL_ID" == "unknown" ]]; then
        log_msg "read_goal_from_db: GOAL_ID not set, skipping"
        return 1
    fi
    if ! command -v sqlite3 >/dev/null 2>&1; then
        log_msg "read_goal_from_db: sqlite3 not available"
        return 1
    fi
    [[ -f "$HERMES_DB" ]] || {
        log_msg "read_goal_from_db: DB not found at $HERMES_DB"
        return 1
    }
    local row
    row="$(sqlite3 -noheader -cmd '.mode list' "$HERMES_DB" \
        "SELECT id, goal, parent_id, status, progress FROM gideon_goals WHERE id=$GOAL_ID;" 2>/dev/null || true)"
    if [[ -z "$row" ]]; then
        log_msg "read_goal_from_db: goal $GOAL_ID not found"
        return 1
    fi
    local gid goal parent status progress
    gid="${row%%|*}"; row="${row#*|}"
    goal="${row%%|*}"; row="${row#*|}"
    parent="${row%%|*}"; row="${row#*|}"
    status="${row%%|*}"; row="${row#*|}"
    progress="$row"
    printf 'goal_id=%s goal=%q parent=%s status=%s progress=%s\n' \
        "$gid" "$goal" "$parent" "$status" "$progress"
}

# update_dispatch_state — record dispatch result in goal_dispatch_state table.
# Args: status (pending|success|failed|error) [result_file] [error_msg]
update_dispatch_state() {
    local status="$1"
    local result_file="${2:-$RESULT_FILE}"
    local error_msg="${3:-}"

    if ! command -v sqlite3 >/dev/null 2>&1; then
        log_msg "update_dispatch_state: sqlite3 not available"
        return 1
    fi
    [[ -f "$HERMES_DB" ]] || {
        log_msg "update_dispatch_state: DB not found at $HERMES_DB"
        return 1
    }
    if [[ "$GOAL_ID" == "unknown" ]]; then
        log_msg "update_dispatch_state: GOAL_ID not set, skipping"
        return 0
    fi

    # SQL-quote the strings
    local s_status s_result s_error
    s_status="${status//\'/\'\'}"
    s_result="${result_file//\'/\'\'}"
    s_error="${error_msg//\'/\'\'}"

    sqlite3 "$HERMES_DB" <<SQL
INSERT INTO goal_dispatch_state (goal_id, attempts, max_attempts, dispatched_at, last_status, last_result_file, last_error, updated_at)
VALUES ($GOAL_ID, 1, 3, datetime('now'), '$s_status', '$s_result', '$s_error', datetime('now'))
ON CONFLICT(goal_id) DO UPDATE SET
    attempts = attempts + 1,
    last_status = excluded.last_status,
    last_result_file = excluded.last_result_file,
    last_error = excluded.last_error,
    updated_at = datetime('now');
SQL
    log_msg "dispatch state updated: status=$status"
}

# emit_result — write STATUS + body to RESULT_FILE and flush to disk.
# Args: status (SUCCESS|FAILED), body
emit_result() {
    local status="$1"  # SUCCESS | FAILED
    local body="$2"
    {
        printf 'STATUS: %s\n' "$status"
        printf '%s\n' "$body"
        printf 'GOAL_ID: %s\n' "$GOAL_ID"
        printf 'TIMESTAMP: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    } > "$RESULT_FILE"
    sync "$RESULT_FILE" 2>/dev/null || true
    log_msg "result emitted: status=$status"
}

# Trap ERR to auto-fail on script errors when sourced + executed.
# Only fires for the script itself, not interactive sourcing.
trap 'emit_result FAILED "worker trapped at line $LINENO with exit $?"' ERR
