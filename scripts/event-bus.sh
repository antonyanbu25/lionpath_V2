#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${EVENT_BUS_DB:-$HERMES_HOME/state.db}"

die() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  event-bus.sh init
  event-bus.sh publish <type> <payload>
  event-bus.sh poll [handler]

Environment:
  HERMES_HOME    Defaults to ~/.hermes
  EVENT_BUS_DB   Defaults to $HERMES_HOME/state.db
USAGE
  exit 1
}

require_sqlite() {
  command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
}

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

init_db() {
  mkdir -p "$(dirname "$DB_PATH")"
  sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS gideon_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  consumed INTEGER DEFAULT 0
);
SQL
}

cmd_publish() {
  [[ $# -ge 2 ]] || die "publish requires <type> <payload>"
  local type="$1"
  shift
  local payload="$*"
  local ts
  ts="$(date +%s)"

  init_db
  sqlite3 "$DB_PATH" \
    "INSERT INTO gideon_events (ts, type, payload, consumed) VALUES ($ts, $(sql_quote "$type"), $(sql_quote "$payload"), 0);"
}

call_handler() {
  local handler="$1"
  local id="$2"
  local ts="$3"
  local type="$4"
  local payload="$5"

  if ! declare -F "$handler" >/dev/null 2>&1; then
    die "handler is not a loaded function: $handler"
  fi
  "$handler" "$id" "$ts" "$type" "$payload"
}

cmd_poll() {
  local handler="${1:-}"
  [[ $# -le 1 ]] || die "poll accepts at most one handler"

  init_db
  while IFS=$'\t' read -r id ts type payload; do
    [[ -n "${id:-}" ]] || continue
    if [[ -n "$handler" ]]; then
      call_handler "$handler" "$id" "$ts" "$type" "${payload:-}"
    else
      printf '%s\t%s\t%s\t%s\n' "$id" "$ts" "$type" "${payload:-}"
    fi
    sqlite3 "$DB_PATH" "UPDATE gideon_events SET consumed = 1 WHERE id = $id;"
  done < <(sqlite3 -separator $'\t' "$DB_PATH" \
    "SELECT id, ts, type, COALESCE(payload, '') FROM gideon_events WHERE consumed = 0 ORDER BY id;")
}

main() {
  require_sqlite
  [[ $# -ge 1 ]] || usage

  local cmd="$1"
  shift
  case "$cmd" in
    init) [[ $# -eq 0 ]] || die "init takes no arguments"; init_db ;;
    publish) cmd_publish "$@" ;;
    poll) cmd_poll "$@" ;;
    -h|--help|help) usage ;;
    *) usage ;;
  esac
}

main "$@"
