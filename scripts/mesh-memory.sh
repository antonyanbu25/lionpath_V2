#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="$HERMES_HOME/state.db"
REMOTE_DB_PATH="$HERMES_HOME/state.db"
NODE=""
ACTION=""
BATCH_SIZE="${MESH_BATCH:-500}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)
LOCK_FD=9

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  mesh-memory.sh --pull   --node <user@host> [--db <path>] [--remote-db <path>]
  mesh-memory.sh --push   --node <user@host> [--db <path>] [--remote-db <path>]
  mesh-memory.sh --sync   --node <user@host> [--db <path>] [--remote-db <path>]
  mesh-memory.sh --status [--node <user@host>] [--db <path>]
  mesh-memory.sh --migrate [--db <path>]
  mesh-memory.sh --help

Environment:
  HERMES_HOME       Defaults to ~/.hermes
  MESH_BATCH        Rows per page, defaults to 500
  MESH_REMOTE_LOCAL Set to 1 to force local execution for --node
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  :
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 ssh flock; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  (( missing == 0 )) || exit 2
}

is_local_node() {
  local node="${1:-}"
  local host="${node#*@}"
  local short
  short="$(hostname 2>/dev/null || true)"
  [[ "${MESH_REMOTE_LOCAL:-0}" == "1" || "$node" == "localhost" || "$node" == "127.0.0.1" || "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "$short" ]]
}

local_sql() {
  sqlite3 "$DB_PATH" "$1"
}

remote_sql() {
  local node="$1"
  local sql="$2"
  if is_local_node "$node"; then
    sqlite3 "$REMOTE_DB_PATH" "$sql"
  else
    ssh "${SSH_OPTS[@]}" "$node" "sqlite3 $(printf '%q' "$REMOTE_DB_PATH") $(printf '%q' "$sql")"
  fi
}

remote_sql_stdin() {
  local node="$1"
  if is_local_node "$node"; then
    sqlite3 "$REMOTE_DB_PATH"
  else
    ssh "${SSH_OPTS[@]}" "$node" "sqlite3 $(printf '%q' "$REMOTE_DB_PATH")"
  fi
}

check_remote_prereqs() {
  local node="$1"
  if is_local_node "$node"; then
    command -v sqlite3 >/dev/null 2>&1 || exit 5
    return 0
  fi
  if ! ssh "${SSH_OPTS[@]}" "$node" 'true' >/dev/null 2>&1; then
    log ERROR "node unreachable: $node"
    set_sync_state "$node" "$(get_last_pull "$node")" "$(get_last_push "$node")" 0 "node unreachable"
    exit 4
  fi
  if ! ssh "${SSH_OPTS[@]}" "$node" 'command -v sqlite3 >/dev/null 2>&1'; then
    log ERROR "remote sqlite3 missing: $node"
    exit 5
  fi
}

migration_sql() {
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS memory (
  key TEXT PRIMARY KEY,
  value TEXT
);
ALTER TABLE memory ADD COLUMN updated_at INTEGER DEFAULT 0;
ALTER TABLE memory ADD COLUMN origin_node TEXT DEFAULT NULL;
UPDATE memory SET updated_at = strftime('%s','now') WHERE updated_at IS NULL OR updated_at = 0;
CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at);
CREATE TABLE IF NOT EXISTS mesh_sync_state (
  node_host TEXT PRIMARY KEY,
  last_pull_at INTEGER NOT NULL DEFAULT 0,
  last_push_at INTEGER NOT NULL DEFAULT 0,
  last_sync_ok INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
SQL
}

migrate_one_db() {
  local db="$1"
  mkdir -p "$(dirname "$db")"
  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT);"
  sqlite3 "$db" "ALTER TABLE memory ADD COLUMN updated_at INTEGER DEFAULT 0;" 2>/dev/null || true
  sqlite3 "$db" "ALTER TABLE memory ADD COLUMN origin_node TEXT DEFAULT NULL;" 2>/dev/null || true
  sqlite3 "$db" "UPDATE memory SET updated_at = strftime('%s','now') WHERE updated_at IS NULL OR updated_at = 0; CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at); CREATE TABLE IF NOT EXISTS mesh_sync_state (node_host TEXT PRIMARY KEY, last_pull_at INTEGER NOT NULL DEFAULT 0, last_push_at INTEGER NOT NULL DEFAULT 0, last_sync_ok INTEGER NOT NULL DEFAULT 0, last_error TEXT);"
}

migrate_schema() {
  migrate_one_db "$DB_PATH"
  log INFO "migrated local schema: $DB_PATH"
}

migrate_remote_schema() {
  local node="$1"
  if is_local_node "$node"; then
    migrate_one_db "$REMOTE_DB_PATH"
  else
    remote_sql "$node" "$(migration_sql)" >/dev/null
  fi
  log INFO "migrated remote schema: $node:$REMOTE_DB_PATH"
}

get_state_value() {
  local node="$1"
  local column="$2"
  local qnode
  qnode="$(sql_quote "$node")"
  sqlite3 "$DB_PATH" "SELECT COALESCE((SELECT $column FROM mesh_sync_state WHERE node_host=$qnode),0);"
}

get_last_pull() {
  get_state_value "$1" last_pull_at
}

get_last_push() {
  get_state_value "$1" last_push_at
}

set_sync_state() {
  local node="$1"
  local pull_at="$2"
  local push_at="$3"
  local ok="$4"
  local error="${5:-}"
  local qnode qerr
  qnode="$(sql_quote "$node")"
  qerr="$(sql_quote "$error")"
  sqlite3 "$DB_PATH" "INSERT INTO mesh_sync_state(node_host,last_pull_at,last_push_at,last_sync_ok,last_error) VALUES($qnode,$pull_at,$push_at,$ok,$qerr) ON CONFLICT(node_host) DO UPDATE SET last_pull_at=excluded.last_pull_at,last_push_at=excluded.last_push_at,last_sync_ok=excluded.last_sync_ok,last_error=excluded.last_error;"
}

count_rows_newer() {
  local db_side="$1"
  local node="$2"
  local since="$3"
  local sql="SELECT COUNT(*) FROM memory WHERE updated_at > $since;"
  if [[ "$db_side" == "local" ]]; then
    sqlite3 "$DB_PATH" "$sql"
  else
    remote_sql "$node" "$sql"
  fi
}

max_rows_newer() {
  local db_side="$1"
  local node="$2"
  local since="$3"
  local sql="SELECT COALESCE(MAX(updated_at),$since) FROM memory WHERE updated_at > $since;"
  if [[ "$db_side" == "local" ]]; then
    sqlite3 "$DB_PATH" "$sql"
  else
    remote_sql "$node" "$sql"
  fi
}

emit_insert_sql() {
  local db_side="$1"
  local node="$2"
  local since="$3"
  local limit="$4"
  local offset="$5"
  local sql
  sql="SELECT 'INSERT INTO __mesh_staging(key,value,updated_at,origin_node) VALUES(' || quote(key) || ',' || quote(value) || ',' || COALESCE(updated_at,0) || ',' || quote(origin_node) || ');' FROM memory WHERE updated_at > $since ORDER BY updated_at, key LIMIT $limit OFFSET $offset;"
  if [[ "$db_side" == "local" ]]; then
    sqlite3 "$DB_PATH" "$sql"
  else
    remote_sql "$node" "$sql"
  fi
}

merge_sql_prefix() {
  cat <<'SQL'
.timeout 5000
BEGIN IMMEDIATE;
CREATE TEMP TABLE __mesh_staging (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER,
  origin_node TEXT
);
SQL
}

merge_sql_suffix() {
  cat <<'SQL'
INSERT OR REPLACE INTO memory(key,value,updated_at,origin_node)
SELECT s.key, s.value, s.updated_at, s.origin_node
FROM __mesh_staging s
LEFT JOIN memory m ON m.key = s.key
WHERE m.key IS NULL OR s.updated_at > COALESCE(m.updated_at,0);
DROP TABLE __mesh_staging;
COMMIT;
SQL
}

run_merge_local() {
  local sql_file="$1"
  local attempt
  for attempt in 1 2 3; do
    if sqlite3 "$DB_PATH" < "$sql_file"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

run_merge_remote() {
  local node="$1"
  local sql_file="$2"
  local attempt
  for attempt in 1 2 3; do
    if remote_sql_stdin "$node" < "$sql_file"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

pull_from() {
  local node="$1"
  local last total max_seen offset rows tmp last_push
  last="$(get_last_pull "$node")"
  total="$(count_rows_newer remote "$node" "$last")"
  max_seen="$(max_rows_newer remote "$node" "$last")"
  offset=0
  rows=0
  log INFO "pull from $node since $last ($total rows)"
  while (( offset < total )); do
    tmp="$(mktemp)"
    merge_sql_prefix > "$tmp"
    emit_insert_sql remote "$node" "$last" "$BATCH_SIZE" "$offset" >> "$tmp"
    merge_sql_suffix >> "$tmp"
    run_merge_local "$tmp"
    rm -f "$tmp"
    rows=$(( rows + BATCH_SIZE ))
    offset=$(( offset + BATCH_SIZE ))
  done
  last_push="$(get_last_push "$node")"
  set_sync_state "$node" "$max_seen" "$last_push" 1 ""
  log INFO "pull from $node complete; cursor=$max_seen"
}

push_to() {
  local node="$1"
  local last total max_seen offset tmp last_pull
  last="$(get_last_push "$node")"
  total="$(count_rows_newer local "$node" "$last")"
  max_seen="$(max_rows_newer local "$node" "$last")"
  offset=0
  log INFO "push to $node since $last ($total rows)"
  while (( offset < total )); do
    tmp="$(mktemp)"
    merge_sql_prefix > "$tmp"
    emit_insert_sql local "$node" "$last" "$BATCH_SIZE" "$offset" >> "$tmp"
    merge_sql_suffix >> "$tmp"
    run_merge_remote "$node" "$tmp"
    rm -f "$tmp"
    offset=$(( offset + BATCH_SIZE ))
  done
  last_pull="$(get_last_pull "$node")"
  set_sync_state "$node" "$last_pull" "$max_seen" 1 ""
  log INFO "push to $node complete; cursor=$max_seen"
}

do_sync() {
  local node="$1"
  migrate_schema
  check_remote_prereqs "$node"
  migrate_remote_schema "$node"
  if ! pull_from "$node"; then
    set_sync_state "$node" "$(get_last_pull "$node")" "$(get_last_push "$node")" 0 "pull failed"
    exit 4
  fi
  if ! push_to "$node"; then
    set_sync_state "$node" "$(get_last_pull "$node")" "$(get_last_push "$node")" 0 "push failed"
    exit 4
  fi
}

show_status() {
  migrate_schema
  if [[ -n "$NODE" ]]; then
    sqlite3 -header -column "$DB_PATH" "SELECT * FROM mesh_sync_state WHERE node_host=$(sql_quote "$NODE");"
  else
    sqlite3 -header -column "$DB_PATH" "SELECT * FROM mesh_sync_state ORDER BY node_host;"
  fi
}

parse_args() {
  [[ $# -gt 0 ]] || { usage; exit 1; }
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pull|--push|--sync|--status|--migrate)
        ACTION="$1"
        shift
        ;;
      --node)
        [[ $# -ge 2 ]] || { log ERROR "--node requires a value"; exit 1; }
        NODE="$2"
        shift 2
        ;;
      --db)
        [[ $# -ge 2 ]] || { log ERROR "--db requires a value"; exit 1; }
        DB_PATH="$2"
        shift 2
        ;;
      --remote-db)
        [[ $# -ge 2 ]] || { log ERROR "--remote-db requires a value"; exit 1; }
        REMOTE_DB_PATH="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        log ERROR "unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  check_prereqs
  mkdir -p "$(dirname "$DB_PATH")"
  exec {LOCK_FD}>"$DB_PATH.mesh.lock"
  flock -w 10 "$LOCK_FD"
  case "$ACTION" in
    --migrate)
      migrate_schema
      ;;
    --pull)
      [[ -n "$NODE" ]] || { log ERROR "--pull requires --node"; exit 1; }
      migrate_schema
      check_remote_prereqs "$NODE"
      migrate_remote_schema "$NODE"
      pull_from "$NODE" || { set_sync_state "$NODE" "$(get_last_pull "$NODE")" "$(get_last_push "$NODE")" 0 "pull failed"; exit 4; }
      ;;
    --push)
      [[ -n "$NODE" ]] || { log ERROR "--push requires --node"; exit 1; }
      migrate_schema
      check_remote_prereqs "$NODE"
      migrate_remote_schema "$NODE"
      push_to "$NODE" || { set_sync_state "$NODE" "$(get_last_pull "$NODE")" "$(get_last_push "$NODE")" 0 "push failed"; exit 4; }
      ;;
    --sync)
      [[ -n "$NODE" ]] || { log ERROR "--sync requires --node"; exit 1; }
      do_sync "$NODE"
      ;;
    --status)
      show_status
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
