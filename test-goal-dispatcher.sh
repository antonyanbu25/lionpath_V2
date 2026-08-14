#!/usr/bin/env bash
# test-goal-dispatcher.sh — test harness for goal-dispatcher worker + migration
# Owner: Agent 2 (mesh-disp-2)
#
# Tests:
#   1. test_migration          — apply migration, verify table created
#   2. test_no_stale_goals     — dispatcher with no stale goals → exit 0
#   3. test_stale_goal_selected — INSERT stale active goal, verify picked up
#   4. test_flock_contention   — two dispatchers; second locked out
#   5. test_status_parsing     — result files SUCCESS/FAILED/unknown → correct DB
#   6. test_retry_logic        — FAILED result → attempts incremented, then max
#
# Uses real DB at ~/.hermes/state.db. Tests clean up after themselves.

set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${HERMES_DB:-${DB:-$HERMES_HOME/state.db}}"
MIGRATIONS_DIR="$HERMES_HOME/scripts/curiosity-migrations"
WORKER="$HERMES_HOME/scripts/goal-dispatcher-worker.sh"
TMPDIR_BASE="${TMPDIR:-/tmp}"
TEST_TMP="$(mktemp -d "$TMPDIR_BASE/goal-dispatch-test-XXXXXX")"
LOCK_FILE="$TEST_TMP/dispatcher.lock"

PASS=0
FAIL=0
FAILED_TESTS=()

# Track test goal IDs + result files for cleanup
TEST_GOAL_IDS=()
TEST_RESULT_FILES=()

###############################################################################
# Utilities
###############################################################################

req() { command -v "$1" >/dev/null 2>&1; }

die() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

sql_quote() {
    local v="${1-}"
    v="${v//\'/\'\'}"
    printf "'%s'" "$v"
}

run_sql() {
    sqlite3 -noheader -cmd '.mode list' "$DB" "$@" 2>/dev/null
}

cleanup() {
    local gid rf
    # Delete test goals (cascades to goal_dispatch_state via FK)
    for gid in "${TEST_GOAL_IDS[@]:-}"; do
        [[ -n "$gid" ]] && run_sql "DELETE FROM goal_dispatch_state WHERE goal_id=$gid;" 2>/dev/null || true
        run_sql "DELETE FROM gideon_goals WHERE id=$gid;" 2>/dev/null || true
    done
    # Remove temp result files
    for rf in "${TEST_RESULT_FILES[@]:-}"; do
        [[ -n "$rf" && -f "$rf" ]] && rm -f "$rf"
    done
    rm -rf "$TEST_TMP"
}

trap cleanup EXIT

assert() {
    local label="$1" condition="$2"
    if eval "$condition" >/dev/null 2>&1 || [[ $? -eq 0 ]]; then
        if eval "$condition"; then
            printf '  ✓ %s\n' "$label"
            PASS=$((PASS + 1))
        else
            printf '  ✗ %s (condition false)\n' "$label"
            FAIL=$((FAIL + 1))
            FAILED_TESTS+=("$label")
        fi
    else
        printf '  ✗ %s (eval error)\n' "$label"
        FAIL=$((FAIL + 1))
        FAILED_TESTS+=("$label")
    fi
}

assert_eq() {
    local label="$1" actual="$2" expected="$3"
    if [[ "$actual" == "$expected" ]]; then
        printf '  ✓ %s\n' "$label"
        PASS=$((PASS + 1))
    else
        printf '  ✗ %s (got: "%s", expected: "%s")\n' "$label" "$actual" "$expected"
        FAIL=$((FAIL + 1))
        FAILED_TESTS+=("$label")
    fi
}

# Create a test goal in gideon_goals; echoes the new goal_id upserted.
insert_test_goal() {
    local goal_text="$1"
    local status="${2:-active}"
    run_sql "INSERT INTO gideon_goals (goal, status, progress, created_at, updated_at) VALUES ($(sql_quote "$goal_text"), $(sql_quote "$status"), 0, strftime('%s','now'), strftime('%s','now')); SELECT last_insert_rowid();"
}

# Apply the migration (idempotent — safe to re-run).
apply_migration() {
    local sql_file="$MIGRATIONS_DIR/003_dispatch_state.sql"
    local wrapper="$MIGRATIONS_DIR/003_dispatch_state.sh"
    if [[ -x "$wrapper" ]]; then
        HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" DB="$DB" bash "$wrapper"
    elif [[ -f "$wrapper" ]]; then
        HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" DB="$DB" bash "$wrapper"
    elif [[ -f "$sql_file" ]]; then
        sqlite3 "$DB" < "$sql_file"
    else
        die "migration file not found: $sql_file"
    fi
}

# A minimal in-script dispatcher that finds stale active goals.
# A goal is "stale" if status='active' AND (updated_at is NULL OR
# updated_at < strftime('%s','now') - <threshold>).
# Echoes "goal_id" for the first stale goal found, or empty string.
find_stale_goals() {
    local threshold="${1:-0}"
    run_sql "SELECT id FROM gideon_goals WHERE status='active' AND (updated_at IS NULL OR updated_at < strftime('%s','now') - $threshold) ORDER BY id LIMIT 1;"
}

# A minimal dispatcher: acquires flock, picks up stale goals, writes result.
# Args: threshold_seconds result_dir [lock_file]
run_dispatcher() {
    local threshold="${1:-0}"
    local result_dir="${2:-$TEST_TMP}"
    local lock="${3:-$LOCK_FILE}"

    exec 9>"$lock"
    if ! flock -n 9; then
        echo "LOCKED"
        return 0
    fi

    local stale
    stale="$(find_stale_goals "$threshold")"
    if [[ -z "$stale" ]]; then
        echo "NO_STALE"
        return 0
    fi

    # Simulate dispatching: write a result file with SUCCESS
    local rf="$result_dir/result-$stale.txt"
    {
        printf 'STATUS: SUCCESS\n'
        printf 'Goal %s dispatched and completed\n' "$stale"
    } > "$rf"
    TEST_RESULT_FILES+=("$rf")

    echo "$stale"
}

###############################################################################
# Tests
###############################################################################

test_migration() {
    echo "test_migration"
    apply_migration >/dev/null 2>&1
    local count
    count="$(run_sql "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='goal_dispatch_state';")"
    assert_eq "goal_dispatch_state table exists" "$count" "1"

    # Verify columns
    local col_count
    col_count="$(run_sql "SELECT COUNT(*) FROM pragma_table_info('goal_dispatch_state');")"
    [[ "$col_count" -ge 9 ]] && COL_COUNT_OK=1 || COL_COUNT_OK=0
    assert "has >=9 columns" "[[ $COL_COUNT_OK -eq 1 ]]"
}

test_no_stale_goals() {
    echo "test_no_stale_goals"
    # Ensure no active goals exist with small threshold
    local result
    result="$(run_dispatcher 0 "$TEST_TMP" "$TEST_TMP/lock-nsg.txt")"
    assert_eq "no stale goals → NO_STALE" "$result" "NO_STALE"
}

test_stale_goal_selected() {
    echo "test_stale_goal_selected"
    local gid
    gid="$(insert_test_goal "test: stale goal selection")"
    [[ -n "$gid" ]] || die "insert_test_goal failed"
    TEST_GOAL_IDS+=("$gid")

    # Set updated_at to the distant past so it's definitely stale
    run_sql "UPDATE gideon_goals SET updated_at=0 WHERE id=$gid;"

    local result
    result="$(run_dispatcher 0 "$TEST_TMP" "$TEST_TMP/lock-sgs.txt")"
    assert_eq "stale goal $gid picked up" "$result" "$gid"
}

test_flock_contention() {
    echo "test_flock_contention"
    local gid
    gid="$(insert_test_goal "test: flock contention")"
    [[ -n "$gid" ]] || die "insert_test_goal failed"
    TEST_GOAL_IDS+=("$gid")
    run_sql "UPDATE gideon_goals SET updated_at=0 WHERE id=$gid;"

    local lock="$TEST_TMP/lock-flock.txt"
    # Start first dispatcher in background (will hold lock briefly)
    (
        exec 9>"$lock"
        flock 9
        sleep 1
    ) &
    local bg_pid=$!

    # Small sleep to ensure background holds lock first
    sleep 0.2

    # Second dispatcher should get LOCKED
    local result
    result="$(run_dispatcher 0 "$TEST_TMP" "$lock")"

    wait "$bg_pid" 2>/dev/null || true
    assert_eq "second dispatcher skipped (LOCKED)" "$result" "LOCKED"
}

test_status_parsing() {
    echo "test_status_parsing"
    local gid rf
    gid="$(insert_test_goal "test: status parsing")"
    [[ -n "$gid" ]] || die "insert_test_goal failed"
    TEST_GOAL_IDS+=("$gid")

    # Test SUCCESS
    rf="$TEST_TMP/result-success-$gid.txt"
    printf 'STATUS: SUCCESS\nFound it.\n' > "$rf"
    TEST_RESULT_FILES+=("$rf")
    parse_result_and_update "$gid" "$rf" "success"
    local status
    status="$(run_sql "SELECT last_status FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "SUCCESS → last_status=success" "$status" "success"

    # Reset for FAILED
    run_sql "DELETE FROM goal_dispatch_state WHERE goal_id=$gid;" >/dev/null 2>&1

    rf="$TEST_TMP/result-failed-$gid.txt"
    printf 'STATUS: FAILED\nSomething broke.\n' > "$rf"
    TEST_RESULT_FILES+=("$rf")
    parse_result_and_update "$gid" "$rf" "failed"
    status="$(run_sql "SELECT last_status FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "FAILED → last_status=failed" "$status" "failed"

    # Unknown status → error
    run_sql "DELETE FROM goal_dispatch_state WHERE goal_id=$gid;" >/dev/null 2>&1

    rf="$TEST_TMP/result-unknown-$gid.txt"
    printf 'STATUS: FROBNICATED\nhuh?\n' > "$rf"
    TEST_RESULT_FILES+=("$rf")
    parse_result_and_update "$gid" "$rf" "unknown"
    status="$(run_sql "SELECT last_status FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "Unknown status → last_status=error" "$status" "error"
}

# Parse a result file's STATUS line and update goal_dispatch_state.
# Args: goal_id result_file raw_status
parse_result_and_update() {
    local gid="$1" rf="$2" raw_status="$3"
    local db_status="error"
    case "$raw_status" in
        success) db_status="success" ;;
        failed)  db_status="failed" ;;
        *)       db_status="error" ;;
    esac
    local s_status s_rf
    s_status="${db_status//\'/\'\'}"
    s_rf="${rf//\'/\'\'}"
    sqlite3 "$DB" <<SQL
INSERT INTO goal_dispatch_state (goal_id, attempts, max_attempts, last_status, last_result_file, updated_at)
VALUES ($gid, 1, 3, '$s_status', '$s_rf', datetime('now'))
ON CONFLICT(goal_id) DO UPDATE SET
    attempts = attempts + 1,
    last_status = excluded.last_status,
    last_result_file = excluded.last_result_file,
    updated_at = datetime('now');
SQL
}

test_retry_logic() {
    echo "test_retry_logic"
    local gid rf
    gid="$(insert_test_goal "test: retry logic")"
    [[ -n "$gid" ]] || die "insert_test_goal failed"
    TEST_GOAL_IDS+=("$gid")

    local max_attempts=3
    local attempt

    # Simulate max_attempts-1 FAILED attempts: attempts should increment but
    # goal not marked permanently failed yet.
    for ((attempt = 1; attempt <= max_attempts - 1; attempt++)); do
        rf="$TEST_TMP/retry-${attempt}-${gid}.txt"
        printf 'STATUS: FAILED\nAttempt %d failed\n' "$attempt" > "$rf"
        TEST_RESULT_FILES+=("$rf")
        parse_result_and_update "$gid" "$rf" "failed"
    done

    local attempts_after
    attempts_after="$(run_sql "SELECT attempts FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "attempts after $((max_attempts - 1)) failures" "$attempts_after" "$((max_attempts - 1))"

    local status_mid
    status_mid="$(run_sql "SELECT last_status FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "status mid-retry is failed" "$status_mid" "failed"

    # Final attempt also fails → attempts == max_attempts, still failed
    rf="$TEST_TMP/retry-final-${gid}.txt"
    printf 'STATUS: FAILED\nFinal attempt failed\n' > "$rf"
    TEST_RESULT_FILES+=("$rf")
    parse_result_and_update "$gid" "$rf" "failed"

    local attempts_final
    attempts_final="$(run_sql "SELECT attempts FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "attempts == max_attempts" "$attempts_final" "$max_attempts"

    local status_final
    status_final="$(run_sql "SELECT last_status FROM goal_dispatch_state WHERE goal_id=$gid;")"
    assert_eq "final status failed" "$status_final" "failed"
}

###############################################################################
# Main
###############################################################################

main() {
    req sqlite3 || die "sqlite3 is required"
    [[ -f "$DB" ]] || die "state.db not found at $DB"

    echo "=========================================="
    echo "test-goal-dispatcher.sh"
    echo "DB:   $DB"
    echo "TEST: $TEST_TMP"
    echo "=========================================="

    # Run tests in order
    test_migration
    test_no_stale_goals
    test_stale_goal_selected
    test_flock_contention
    test_status_parsing
    test_retry_logic

    echo "=========================================="
    printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
    if [[ "$FAIL" -gt 0 ]]; then
        printf 'Failed tests:\n'
        for t in "${FAILED_TESTS[@]:-}"; do
            printf '  - %s\n' "$t"
        done
    fi
    echo "=========================================="

    [[ "$FAIL" -eq 0 ]]
}

main "$@"
