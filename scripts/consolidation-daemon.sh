#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${GIDEON_DB:-$HERMES_HOME/state.db}"
INTERVAL="${CONSOLIDATION_INTERVAL:-3600}"
STOPPING=0

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  consolidation-daemon.sh [run|once|digest]
  consolidation-daemon.sh daemon [--interval <sec>]
  consolidation-daemon.sh --help

Writes one stats row to gideon_mem_stats. It never deletes or rewrites memory data.
The daemon mode is intended for a 3-4am scheduler window.

Environment:
  HERMES_HOME                Defaults to ~/.hermes
  GIDEON_DB                  Defaults to $HERMES_HOME/state.db
  CONSOLIDATION_INTERVAL     Daemon loop sleep seconds, defaults to 3600
USAGE
}

check_prereqs() {
  if ! command -v sqlite3 >/dev/null 2>&1; then
    log ERROR "missing prerequisite: sqlite3"
    exit 2
  fi
  if [[ ! -f "$DB_PATH" ]]; then
    log ERROR "database not found: $DB_PATH"
    exit 3
  fi
}

quote_ident() {
  local ident="${1//\"/\"\"}"
  printf '"%s"' "$ident"
}

init_stats_table() {
  sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS gideon_mem_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  episodic_count INTEGER,
  semantic_count INTEGER,
  db_size_bytes INTEGER
);
SQL
}

table_has_column() {
  local table="$1"
  local column="$2"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info($(printf "'%s'" "${table//\'/\'\'}")) WHERE name = '$(printf "%s" "${column//\'/\'\'}")';"
}

first_table_matching() {
  local pattern="$1"
  sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND lower(name) GLOB '$pattern' ORDER BY name LIMIT 1;"
}

count_table_rows() {
  local table="$1"
  [[ -n "$table" ]] || return 1
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $(quote_ident "$table");"
}

count_typed_memory_rows() {
  local type="$1"
  local table
  for table in memory memories facts; do
    if [[ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")" == "1" ]] && [[ "$(table_has_column "$table" type)" != "0" ]]; then
      sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $(quote_ident "$table") WHERE lower(type) LIKE '%$type%';"
      return 0
    fi
  done
  return 1
}

estimate_count() {
  local db_size_bytes="$1"
  local divisor="$2"
  if [[ "$db_size_bytes" =~ ^[0-9]+$ && "$db_size_bytes" -gt 0 ]]; then
    printf '%s\n' "$((db_size_bytes / divisor))"
  else
    printf '0\n'
  fi
}

detect_count() {
  local kind="$1"
  local db_size_bytes="$2"
  local table=""
  local count=""

  if [[ "$kind" == "episodic" ]]; then
    table="$(first_table_matching '*episod*')"
    if [[ -n "$table" ]]; then
      count="$(count_table_rows "$table")"
    else
      count="$(count_typed_memory_rows episod 2>/dev/null || true)"
    fi
    [[ -n "$count" ]] || count="$(estimate_count "$db_size_bytes" 2048)"
  else
    table="$(first_table_matching '*semantic*')"
    if [[ -n "$table" ]]; then
      count="$(count_table_rows "$table")"
    else
      count="$(count_typed_memory_rows semantic 2>/dev/null || true)"
    fi
    [[ -n "$count" ]] || count="$(estimate_count "$db_size_bytes" 8192)"
  fi

  printf '%s\n' "$count"
}

write_stats_row() {
  local ts db_size_bytes episodic_count semantic_count
  ts="$(date +%s)"
  db_size_bytes="$(stat -c%s "$DB_PATH")"
  episodic_count="$(detect_count episodic "$db_size_bytes")"
  semantic_count="$(detect_count semantic "$db_size_bytes")"

  sqlite3 "$DB_PATH" <<SQL
INSERT INTO gideon_mem_stats (ts, episodic_count, semantic_count, db_size_bytes)
VALUES ($ts, $episodic_count, $semantic_count, $db_size_bytes);
SQL
  printf 'ts=%s episodic_count=%s semantic_count=%s db_size_bytes=%s\n' "$ts" "$episodic_count" "$semantic_count" "$db_size_bytes"
}

event_table_exists() {
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='gideon_events';"
}

query_recent_session_heartbeats() {
  local has_created_at has_ts time_filter order_expr

  [[ "$(event_table_exists)" == "1" ]] || return 0

  has_created_at="$(table_has_column gideon_events created_at)"
  has_ts="$(table_has_column gideon_events ts)"

  if [[ "$has_created_at" != "0" ]]; then
    time_filter="((typeof(created_at) = 'integer' AND created_at > strftime('%s','now','-30 minutes')) OR (typeof(created_at) != 'integer' AND created_at > datetime('now','-30 minutes')))"
    order_expr="created_at"
  elif [[ "$has_ts" != "0" ]]; then
    time_filter="ts > (CAST(strftime('%s','now') AS INTEGER) - 1800)"
    order_expr="ts"
  else
    time_filter="1 = 1"
    order_expr="rowid"
  fi

  sqlite3 -batch -noheader -separator $'\t' "$DB_PATH" \
    "SELECT COALESCE(payload, ''), COALESCE($order_expr, 0) FROM gideon_events WHERE type='session_heartbeat' AND $time_filter ORDER BY $order_expr ASC;"
}

write_session_digest() {
  local digest_path="${SESSION_DIGEST_PATH:-/tmp/session-digest.md}"
  local rows body

  check_prereqs
  if ! command -v jq >/dev/null 2>&1; then
    log ERROR "missing prerequisite for digest: jq"
    exit 2
  fi

  rows="$(query_recent_session_heartbeats)"
  if [[ -z "$rows" ]]; then
    printf 'No active sessions\n' >"$digest_path"
    printf '%s\n' "$digest_path"
    return 0
  fi

  body="$(printf '%s\n' "$rows" | jq -r -R -s '
    def clean($n):
      tostring
      | gsub("[\\r\\n\\t|]"; " ")
      | gsub(" +"; " ")
      | ltrimstr(" ")
      | rtrimstr(" ")
      | if length > $n then .[0:($n - 3)] + "..." else . end;
    split("\n")
    | map(select(length > 0) | split("\t"))
    | map(select(length >= 1) | {payload: .[0], event_ts: ((.[1] // "0") | tonumber? // 0)})
    | map((.payload | fromjson?) as $p | select($p != null) | ($p + {event_ts: .event_ts}))
    | map(select((.session_id // "") != ""))
    | sort_by(.session_id, (.ts // .event_ts // 0))
    | group_by(.session_id)
    | map(max_by(.ts // .event_ts // 0))
    | sort_by(.ts // .event_ts // 0)
    | reverse
    | .[:5]
    | if length == 0 then
        "No active sessions"
      else
        "## Active Sessions\n" +
        "| Agent | Goal | Status | Last Action | Blocked | Topics |\n" +
        "|-------|------|--------|-------------|---------|--------|\n" +
        (map(
          "| " +
          ((.agent_id // .session_id // "unknown") | clean(18)) + " | " +
          ((.goal // "") | clean(30)) + " | " +
          ((.status // "") | clean(12)) + " | " +
          ((.last_action // "") | clean(30)) + " | " +
          ((.blocked_on // "") | clean(24)) + " | " +
          (((.topics // []) | if type == "array" then join(",") else tostring end) | clean(24)) +
          " |"
        ) | join("\n"))
      end
  ')"

  printf '%s\n' "$body" >"$digest_path"
  printf '%s\n' "$digest_path"
}

run_once() {
  check_prereqs
  init_stats_table
  write_stats_row
}

in_sleep_window() {
  local hour
  hour="$(date +%H)"
  [[ "$hour" == "03" ]]
}

handle_signal() {
  STOPPING=1
  log INFO "received termination signal, shutting down"
}

run_daemon() {
  local arg
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval)
        [[ $# -ge 2 ]] || { log ERROR "--interval requires a value"; exit 1; }
        INTERVAL="$2"
        shift 2
        ;;
      *)
        log ERROR "unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
  [[ "$INTERVAL" =~ ^[0-9]+$ && "$INTERVAL" -gt 0 ]] || { log ERROR "invalid interval: $INTERVAL"; exit 1; }
  check_prereqs
  init_stats_table
  trap handle_signal TERM INT
  log INFO "daemon started interval=$INTERVAL db=$DB_PATH"
  while (( STOPPING == 0 )); do
    if in_sleep_window; then
      write_stats_row
    else
      log INFO "outside 3-4am consolidation window"
    fi
    sleep "$INTERVAL" || true
  done
  log INFO "daemon stopped"
}

main() {
  local cmd="${1:-run}"
  case "$cmd" in
    run|once)
      run_once
      ;;
    digest)
      write_session_digest
      ;;
    daemon)
      shift
      run_daemon "$@"
      ;;
    --help|-h|help)
      usage
      ;;
    *)
      log ERROR "unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
