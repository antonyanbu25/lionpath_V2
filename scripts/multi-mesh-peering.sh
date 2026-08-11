#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SCRIPTS_DIR="$HERMES_HOME/scripts"
STATE_DIR="$HERMES_HOME/state"
RUN_DIR="$HERMES_HOME/run"
LOG_DIR="$HERMES_HOME/logs"
DEFAULT_DB="$HERMES_HOME/state/state.db"
[[ -s "$HERMES_HOME/state.db" && ! -s "$DEFAULT_DB" ]] && DEFAULT_DB="$HERMES_HOME/state.db"
DB="${HERMES_DB:-${GIDEON_DB:-$DEFAULT_DB}}"
LOCK="$RUN_DIR/multi-mesh-peering.lock"
LOG="$LOG_DIR/multi-mesh-peering.log"
RADIO_MESH="${RADIO_MESH:-$SCRIPTS_DIR/agent-radio-mesh.sh}"
TASK_ROUTER="${TASK_ROUTER:-$SCRIPTS_DIR/task-routing-protocol.sh}"
SYNC_INTERVAL="${HERMES_PEER_SYNC_INTERVAL:-60}"
PEER_SESSION="${HERMES_PEER_SESSION:-multi-mesh-peering}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)
LOCK_FD_OPEN=0

log() {
  local level="$1"
  shift
  mkdir -p "$LOG_DIR"
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" | tee -a "$LOG" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  multi-mesh-peering.sh --peer <remoteLeadHost>
  multi-mesh-peering.sh --unpeer <remoteLeadHost>
  multi-mesh-peering.sh --list-peers
  multi-mesh-peering.sh --forward <task_id> <peer_mesh>
  multi-mesh-peering.sh --sync [peer_id]
  multi-mesh-peering.sh --help

Peering shares only filtered peer snapshots: memory digests and liveness summaries.
It never synchronizes a peer's full task_queue. --forward is explicit per task.

Environment:
  HERMES_HOME                 Defaults to ~/.hermes
  HERMES_DB or GIDEON_DB      Defaults to ~/.hermes/state/state.db, or ~/.hermes/state.db if populated
  HERMES_PEER_SYNC_INTERVAL   Defaults to 60 seconds
  HERMES_PEER_SESSION         Defaults to multi-mesh-peering
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

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 ssh flock sha256sum date hostname awk sed grep base64; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -x "$RADIO_MESH" ]] || { log ERROR "missing executable: $RADIO_MESH"; missing=1; }
  [[ -x "$TASK_ROUTER" ]] || log WARN "local task router is not executable: $TASK_ROUTER"
  [[ "$SYNC_INTERVAL" =~ ^[0-9]+$ && "$SYNC_INTERVAL" -gt 0 ]] || { log ERROR "invalid HERMES_PEER_SYNC_INTERVAL: $SYNC_INTERVAL"; missing=1; }
  (( missing == 0 )) || exit 2
}

acquire_lock() {
  mkdir -p "$RUN_DIR"
  exec 9>"$LOCK"
  LOCK_FD_OPEN=1
  if ! flock -n 9; then
    log WARN "another multi-mesh-peering instance is running"
    exit 75
  fi
}

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

db() {
  sqlite3 "$DB" "$@"
}

init_db() {
  mkdir -p "$(dirname "$DB")" "$STATE_DIR"
  sqlite3 "$DB" <<'SQL'
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS mesh_peers (
  peer_id TEXT PRIMARY KEY,
  lead_host TEXT NOT NULL,
  peering_since TEXT NOT NULL DEFAULT (datetime('now')),
  last_contact TEXT,
  filter_rules TEXT NOT NULL DEFAULT 'memory_digest,liveness',
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS mesh_peer_snapshots (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_id TEXT NOT NULL,
  lead_host TEXT NOT NULL,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
  memory_digest TEXT,
  liveness_json TEXT,
  filter_rules TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_mesh_peer_snapshots_peer_time ON mesh_peer_snapshots(peer_id, snapshot_at);
SQL
}

parse_peer_host() {
  local raw="${1:-}"
  [[ -n "$raw" && "$raw" != -* ]] || { log ERROR "invalid peer host: $raw"; return 1; }
  printf '%s' "$raw"
}

verify_remote_lead() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE' >/dev/null
set -Eeuo pipefail
script="$HOME/.hermes/scripts/agent-radio-mesh.sh"
[[ -x "$script" ]]
found=0
for db in "$HOME/.hermes/state/state.db" "$HOME/.hermes/state.db"; do
  [[ -e "$db" ]] && found=1
done
[[ "$found" -eq 1 ]]
REMOTE
}

remote_uuid() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
uuid_file="$HOME/.hermes/state/node.uuid"
mkdir -p "$(dirname "$uuid_file")"
if [[ ! -s "$uuid_file" ]]; then
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen > "$uuid_file"
  else
    cat /proc/sys/kernel/random/uuid > "$uuid_file"
  fi
fi
cat "$uuid_file"
REMOTE
}

peer_register() {
  local peer_id="$1"
  local lead_host="$2"
  local filter_rules="${3:-memory_digest,liveness}"
  db "INSERT INTO mesh_peers(peer_id,lead_host,peering_since,last_contact,filter_rules,status) VALUES($(sql_quote "$peer_id"),$(sql_quote "$lead_host"),datetime('now'),datetime('now'),$(sql_quote "$filter_rules"),'active') ON CONFLICT(peer_id) DO UPDATE SET lead_host=excluded.lead_host,last_contact=excluded.last_contact,filter_rules=excluded.filter_rules,status='active';"
}

peer_filter_allows() {
  local filter_rules="$1"
  local kind="$2"
  local part known=0
  IFS=',' read -r -a parts <<< "$filter_rules"
  for part in "${parts[@]}"; do
    part="$(printf '%s' "$part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$part" in
      memory_digest|liveness|task_queue) known=1 ;;
      "") ;;
      *) log WARN "unknown filter rule '$part'; ignoring" ;;
    esac
    [[ "$part" == "$kind" ]] && return 0
  done
  [[ "$known" -eq 0 && "$kind" == "liveness" ]] && return 0
  return 1
}

peer_with() {
  local raw="$1"
  local target peer_id filter_rules="memory_digest,liveness"
  target="$(parse_peer_host "$raw")"
  verify_remote_lead "$target" || { log ERROR "remote lead verification failed: $target"; return 4; }
  peer_id="$(remote_uuid "$target")"
  "$RADIO_MESH" join "$PEER_SESSION" "$target" >/dev/null
  peer_register "$peer_id" "$target" "$filter_rules"
  log INFO "peered with $target peer_id=$peer_id"
  printf '{"peer_id":"%s","lead_host":"%s","filter_rules":"%s"}\n' "$peer_id" "$target" "$filter_rules"
}

peer_unpeer() {
  local raw="$1"
  local target peer_id
  target="$(parse_peer_host "$raw")"
  peer_id="$(db "SELECT peer_id FROM mesh_peers WHERE peer_id=$(sql_quote "$target") OR lead_host=$(sql_quote "$target") LIMIT 1;")"
  [[ -n "$peer_id" ]] || { log ERROR "unknown peer: $target"; return 1; }
  db "UPDATE mesh_peers SET status='revoked',last_contact=datetime('now') WHERE peer_id=$(sql_quote "$peer_id");"
  "$RADIO_MESH" leave "$PEER_SESSION" "$target" >/dev/null 2>&1 || true
  log INFO "unpeered $target peer_id=$peer_id"
}

peer_list() {
  sqlite3 -header -column "$DB" "SELECT peer_id,lead_host,peering_since,last_contact,filter_rules,status FROM mesh_peers ORDER BY peering_since DESC;"
}

build_memory_digest() {
  if db "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesh_consciousness';" | grep -qx 1; then
    sqlite3 -readonly "$DB" "SELECT COALESCE(node_host,'') || char(9) || COALESCE(state_digest,'') || char(9) || COALESCE(updated_at,0) FROM mesh_consciousness ORDER BY node_host;" 2>/dev/null | sha256sum | awk '{print $1}'
  elif db "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory';" | grep -qx 1; then
    sqlite3 -readonly "$DB" "SELECT quote(key) || '=' || quote(value) || ':' || COALESCE(updated_at,0) || ':' || COALESCE(origin_node,'') FROM memory ORDER BY key;" 2>/dev/null | sha256sum | awk '{print $1}'
  else
    printf '' | sha256sum | awk '{print $1}'
  fi
}

fetch_remote_digest() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
db=""
for candidate in "$HOME/.hermes/state/state.db" "$HOME/.hermes/state.db"; do
  [[ -s "$candidate" ]] && { db="$candidate"; break; }
done
[[ -n "$db" ]] || exit 1
if sqlite3 "$db" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesh_consciousness';" | grep -qx 1; then
  sqlite3 -readonly "$db" "SELECT COALESCE(node_host,'') || char(9) || COALESCE(state_digest,'') || char(9) || COALESCE(updated_at,0) FROM mesh_consciousness ORDER BY node_host;" 2>/dev/null | sha256sum | awk '{print $1}'
elif sqlite3 "$db" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory';" | grep -qx 1; then
  sqlite3 -readonly "$db" "SELECT quote(key) || '=' || quote(value) || ':' || COALESCE(updated_at,0) || ':' || COALESCE(origin_node,'') FROM memory ORDER BY key;" 2>/dev/null | sha256sum | awk '{print $1}'
else
  printf '' | sha256sum | awk '{print $1}'
fi
REMOTE
}

fetch_remote_liveness() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
db=""
for candidate in "$HOME/.hermes/state/state.db" "$HOME/.hermes/state.db"; do
  [[ -s "$candidate" ]] && { db="$candidate"; break; }
done
[[ -n "$db" ]] || exit 1
if sqlite3 "$db" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesh_node_health';" | grep -qx 1; then
  sqlite3 -readonly "$db" "SELECT '{\"nodes_total\":' || COUNT(*) || ',\"nodes_reachable\":' || COALESCE(SUM(CASE WHEN COALESCE(reachable,0)=1 THEN 1 ELSE 0 END),0) || ',\"last_seen_max\":' || COALESCE(MAX(last_seen),0) || '}' FROM mesh_node_health;" 2>/dev/null
else
  printf '{"nodes_total":0,"nodes_reachable":0,"last_seen_max":0}\n'
fi
REMOTE
}

store_snapshot() {
  local peer_id="$1"
  local host="$2"
  local filter="$3"
  local digest="$4"
  local liveness="$5"
  local status="${6:-ok}"
  db "INSERT INTO mesh_peer_snapshots(peer_id,lead_host,snapshot_at,memory_digest,liveness_json,filter_rules,status) VALUES($(sql_quote "$peer_id"),$(sql_quote "$host"),datetime('now'),$(sql_quote "$digest"),$(sql_quote "$liveness"),$(sql_quote "$filter"),$(sql_quote "$status"));"
}

sync_peer_state() {
  local peer_id="$1"
  local row host filter local_digest remote_digest="" liveness="" status="ok"
  row="$(db -separator $'\t' "SELECT lead_host,filter_rules FROM mesh_peers WHERE peer_id=$(sql_quote "$peer_id") AND status='active' LIMIT 1;")"
  [[ -n "$row" ]] || { log WARN "no active peer found for $peer_id"; return 1; }
  IFS=$'\t' read -r host filter <<< "$row"
  local_digest="$(build_memory_digest)"
  if peer_filter_allows "$filter" "memory_digest"; then
    remote_digest="$(fetch_remote_digest "$host")" || { log WARN "memory digest fetch failed for $peer_id"; status="degraded"; remote_digest=""; }
    [[ -z "$remote_digest" || "$remote_digest" == "$local_digest" ]] || log INFO "peer $peer_id memory digest differs"
  fi
  if peer_filter_allows "$filter" "liveness"; then
    liveness="$(fetch_remote_liveness "$host")" || { log WARN "liveness fetch failed for $peer_id"; status="degraded"; liveness=""; }
  fi
  store_snapshot "$peer_id" "$host" "$filter" "$remote_digest" "$liveness" "$status"
  db "UPDATE mesh_peers SET last_contact=datetime('now'),status=CASE WHEN $(sql_quote "$status")='ok' THEN 'active' ELSE status END WHERE peer_id=$(sql_quote "$peer_id");"
}

peer_sync_all() {
  local peer_id
  while IFS= read -r peer_id || [[ -n "$peer_id" ]]; do
    [[ -n "$peer_id" ]] || continue
    sync_peer_state "$peer_id" || true
  done < <(db "SELECT peer_id FROM mesh_peers WHERE status='active' ORDER BY lead_host;")
}

peer_sync_loop() {
  while true; do
    peer_sync_all
    sleep "$SYNC_INTERVAL"
  done
}

table_has_column() {
  local table="$1"
  local column="$2"
  db "SELECT 1 FROM pragma_table_info($(sql_quote "$table")) WHERE name=$(sql_quote "$column") LIMIT 1;" | grep -qx 1
}

task_field() {
  local task_id="$1"
  local column="$2"
  db "SELECT COALESCE($column,'') FROM task_queue WHERE task_id=$(sql_quote "$task_id") LIMIT 1;"
}

remote_insert_and_offer() {
  local host="$1"
  local task_id="$2"
  local spec="$3"
  local task_type="$4"
  local created_at="$5"
  local sql sql_b64
  sql="PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  status TEXT,
  origin_node TEXT,
  worker_node TEXT,
  task_type TEXT,
  spec TEXT,
  created_at INTEGER,
  assigned_at INTEGER,
  completed_at INTEGER,
  exit_code INTEGER,
  result TEXT,
  error TEXT
);
INSERT INTO task_queue(task_id,status,origin_node,worker_node,task_type,spec,created_at,assigned_at,completed_at,exit_code,result,error)
VALUES($(sql_quote "$task_id"),'QUERY','peer-forward',NULL,$(sql_quote "$task_type"),$(sql_quote "$spec"),$created_at,NULL,NULL,NULL,NULL,NULL)
ON CONFLICT(task_id) DO UPDATE SET status='QUERY',task_type=excluded.task_type,spec=excluded.spec,error=NULL;"
  sql_b64="$(printf '%s' "$sql" | base64 -w 0)"
  ssh "${SSH_OPTS[@]}" "$host" 'bash -s' -- "$task_id" "$sql_b64" <<'REMOTE'
set -Eeuo pipefail
task_id="$1"
sql_b64="$2"
db=""
for candidate in "$HOME/.hermes/state/state.db" "$HOME/.hermes/state.db"; do
  [[ -e "$candidate" ]] && { db="$candidate"; break; }
done
[[ -n "$db" ]] || db="$HOME/.hermes/state/state.db"
mkdir -p "$(dirname "$db")"
printf '%s' "$sql_b64" | base64 -d | sqlite3 "$db"
HERMES_DB="$db" "$HOME/.hermes/scripts/task-routing-protocol.sh" --offer "$task_id"
REMOTE
}

forward_task() {
  local task_id="$1"
  local peer_mesh="$2"
  local host exists spec="" task_type="shell" created_at
  host="$(db "SELECT lead_host FROM mesh_peers WHERE (peer_id=$(sql_quote "$peer_mesh") OR lead_host=$(sql_quote "$peer_mesh")) AND status='active' LIMIT 1;")"
  [[ -n "$host" ]] || { log ERROR "unknown active peer: $peer_mesh"; return 1; }
  exists="$(db "SELECT 1 FROM task_queue WHERE task_id=$(sql_quote "$task_id") LIMIT 1;" 2>/dev/null || true)"
  [[ "$exists" == "1" ]] || { log ERROR "task not found: $task_id"; return 2; }

  if table_has_column task_queue spec; then
    spec="$(task_field "$task_id" spec)"
    table_has_column task_queue task_type && task_type="$(task_field "$task_id" task_type)"
  else
    table_has_column task_queue payload && spec="$(task_field "$task_id" payload)"
    table_has_column task_queue capability && task_type="$(task_field "$task_id" capability)"
  fi
  [[ -n "$spec" ]] || { log ERROR "task has no forwardable spec/payload: $task_id"; return 2; }
  [[ -n "$task_type" ]] || task_type="shell"
  created_at="$(date +%s)"

  remote_insert_and_offer "$host" "$task_id" "$spec" "$task_type" "$created_at" >/dev/null || { log ERROR "forward rejected by $host"; return 3; }

  if table_has_column task_queue status; then
    db "UPDATE task_queue SET status='forwarded',worker_node=$(sql_quote "$peer_mesh") WHERE task_id=$(sql_quote "$task_id");"
  elif table_has_column task_queue state; then
    db "UPDATE task_queue SET state='FORWARDED',assignee=$(sql_quote "$peer_mesh"),updated_at=$created_at WHERE task_id=$(sql_quote "$task_id");"
  fi
  log INFO "forwarded task $task_id to peer $peer_mesh"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    --peer)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      peer_with "$2"
      ;;
    --unpeer)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      peer_unpeer "$2"
      ;;
    --list-peers)
      [[ $# -eq 1 ]] || { usage; exit 1; }
      peer_list
      ;;
    --forward)
      [[ $# -eq 3 ]] || { usage; exit 1; }
      forward_task "$2" "$3"
      ;;
    --sync)
      [[ $# -le 2 ]] || { usage; exit 1; }
      if [[ $# -eq 2 ]]; then
        sync_peer_state "$2"
      else
        peer_sync_all
      fi
      ;;
    __sync-loop)
      peer_sync_loop
      ;;
    --help|-h|help|"")
      usage
      ;;
    *)
      log ERROR "unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

check_prereqs
acquire_lock
init_db
main "$@"
