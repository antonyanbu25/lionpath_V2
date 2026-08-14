#!/usr/bin/env bash
# Migration 003: dispatch state columns + dispatch log table for goal-dispatcher.
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${HERMES_DB:-${DB:-$HERMES_HOME/state.db}}"

die() {
  printf '003_dispatch_state.sh: %s\n' "$*" >&2
  exit 1
}

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

require_sqlite3() {
  command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
}

ensure_db() {
  mkdir -p "$(dirname "$DB")"
  [[ -f "$DB" ]] || sqlite3 "$DB" 'PRAGMA user_version;' >/dev/null
}

table_exists() {
  local table="$1"
  local count
  count="$(sqlite3 -noheader "$DB" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$(sql_quote "$table");")"
  [[ "$count" == "1" ]]
}

column_exists() {
  local table="$1"
  local column="$2"
  local count
  count="$(sqlite3 -noheader "$DB" \
    "SELECT COUNT(*) FROM pragma_table_info($(sql_quote "$table")) WHERE name=$(sql_quote "$column");")"
  [[ "$count" == "1" ]]
}

add_column_if_missing() {
  local table="$1"
  local column="$2"
  local definition="$3"

  if column_exists "$table" "$column"; then
    return 0
  fi

  sqlite3 "$DB" "ALTER TABLE $table ADD COLUMN $column $definition;"
}

main() {
  require_sqlite3
  ensure_db

  if ! table_exists "gideon_goals"; then
    die "gideon_goals table does not exist — run earlier migrations first"
  fi

  # Columns for tracking dispatch state on the goal itself.
  add_column_if_missing "gideon_goals" "dispatched_at" "TEXT"
  add_column_if_missing "gideon_goals" "assigned_agent" "TEXT"
  add_column_if_missing "gideon_goals" "dispatch_count" "INTEGER DEFAULT 0"

  # Dispatch log table — one row per dispatch attempt.
  if ! table_exists "gideon_goal_dispatches"; then
    sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS gideon_goal_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES gideon_goals(id),
  agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_goal_dispatches_goal_id
  ON gideon_goal_dispatches(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_dispatches_status
  ON gideon_goal_dispatches(status);
SQL
  fi
}

main "$@"
