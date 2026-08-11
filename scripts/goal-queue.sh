#!/usr/bin/env bash
set -euo pipefail

DB="${HOME}/.hermes/state.db"

usage() {
  cat <<'USAGE'
Usage:
  goal-queue.sh add "<goal>" [parent_id]
  goal-queue.sh list
  goal-queue.sh update <id> <status>
  goal-queue.sh children <parent_id>
USAGE
}

require_sqlite3() {
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 is required" >&2
    exit 1
  fi
}

sql_quote() {
  local value=${1//\'/\'\'}
  printf "'%s'" "$value"
}

init_db() {
  mkdir -p "$(dirname "$DB")"
  sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS gideon_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal TEXT NOT NULL,
  parent_id INTEGER,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
SQL
}

add_goal() {
  local goal=$1
  local parent_id=${2:-}
  local now
  now=$(date +%s)

  if [[ -n "$parent_id" && ! "$parent_id" =~ ^[0-9]+$ ]]; then
    echo "parent_id must be an integer" >&2
    exit 1
  fi

  local parent_sql="NULL"
  if [[ -n "$parent_id" ]]; then
    parent_sql="$parent_id"
  fi

  sqlite3 "$DB" \
    "INSERT INTO gideon_goals (goal, parent_id, status, progress, created_at, updated_at)
     VALUES ($(sql_quote "$goal"), $parent_sql, 'pending', 0, $now, $now);
     SELECT last_insert_rowid();"
}

list_goals() {
  sqlite3 -header -column "$DB" \
    "SELECT id, goal, parent_id, status, progress, created_at, updated_at
     FROM gideon_goals
     ORDER BY id;"
}

update_goal() {
  local id=$1
  local status=$2
  local now
  now=$(date +%s)

  if [[ ! "$id" =~ ^[0-9]+$ ]]; then
    echo "id must be an integer" >&2
    exit 1
  fi

  sqlite3 "$DB" \
    "UPDATE gideon_goals
     SET status = $(sql_quote "$status"),
         progress = CASE WHEN $(sql_quote "$status") = 'completed' THEN 100 ELSE progress END,
         updated_at = $now
     WHERE id = $id;"
}

children() {
  local parent_id=$1
  if [[ ! "$parent_id" =~ ^[0-9]+$ ]]; then
    echo "parent_id must be an integer" >&2
    exit 1
  fi

  sqlite3 -header -column "$DB" \
    "SELECT id, goal, parent_id, status, progress, created_at, updated_at
     FROM gideon_goals
     WHERE parent_id = $parent_id
     ORDER BY id;"
}

main() {
  require_sqlite3
  init_db

  local command=${1:-}
  case "$command" in
    add)
      if [[ $# -lt 2 || $# -gt 3 ]]; then
        usage >&2
        exit 1
      fi
      add_goal "$2" "${3:-}"
      ;;
    list)
      if [[ $# -ne 1 ]]; then
        usage >&2
        exit 1
      fi
      list_goals
      ;;
    update)
      if [[ $# -ne 3 ]]; then
        usage >&2
        exit 1
      fi
      update_goal "$2" "$3"
      ;;
    children)
      if [[ $# -ne 2 ]]; then
        usage >&2
        exit 1
      fi
      children "$2"
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
