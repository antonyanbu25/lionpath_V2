#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
INTERVAL="${CONSCIOUSNESS_INTERVAL:-10}"
DB_PATH="${HERMES_DB:-$HERMES_HOME/state.db}"
HOOKS="${CONSCIOUSNESS_HOOKS:-$HERMES_HOME/scripts/consciousness-propagation-hooks.sh}"
PID_FILE="$HERMES_HOME/run/consciousness-daemon.pid"
LOCK_FILE="$HERMES_HOME/run/consciousness-daemon.lock"
LAST_CYCLE_FILE="$HERMES_HOME/run/consciousness-daemon.last-cycle"
LOCAL_STATE_FILE="$HERMES_HOME/run/consciousness-daemon.local-state"
PEER_STATE_FILE="$HERMES_HOME/run/consciousness-daemon.peer-state"
LOG_FILE="$HERMES_HOME/logs/consciousness-daemon.log"
STOPPING=0

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  consciousness-daemon.sh start [--interval <sec>]
  consciousness-daemon.sh stop
  consciousness-daemon.sh status
  consciousness-daemon.sh --help

Defaults:
  --interval  CONSCIOUSNESS_INTERVAL or 10 seconds

Environment:
  HERMES_HOME           Defaults to ~/.hermes
  HERMES_DB             Defaults to ~/.hermes/state.db
  CONSCIOUSNESS_HOOKS   Defaults to ~/.hermes/scripts/consciousness-propagation-hooks.sh
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  if [[ "${1:-}" == "daemon" ]]; then
    rm -f "$PID_FILE"
  fi
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 flock sha256sum awk; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -x "$HOOKS" ]] || { log ERROR "missing executable hooks script: $HOOKS"; missing=1; }
  [[ "$INTERVAL" =~ ^[0-9]+$ && "$INTERVAL" -gt 0 ]] || { log ERROR "invalid interval: $INTERVAL"; missing=1; }
  (( missing == 0 )) || exit 2
}

parse_common_flags() {
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
}

is_pid_alive() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1
}

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

init_db() {
  mkdir -p "$(dirname "$DB_PATH")"
  sqlite3 "$DB_PATH" <<'SQL'
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS mesh_consciousness (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  state_blob TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  received_at INTEGER NOT NULL,
  origin TEXT,
  UNIQUE(agent_id, epoch)
);
CREATE INDEX IF NOT EXISTS idx_mc_agent ON mesh_consciousness(agent_id, epoch);
CREATE TABLE IF NOT EXISTS mesh_node_health (
  hostname TEXT PRIMARY KEY,
  ip TEXT,
  last_seen INTEGER,
  reachable INTEGER,
  response_time_ms INTEGER,
  error_count INTEGER DEFAULT 0
);
SQL
}

health_state() {
  sqlite3 -separator $'\t' "$DB_PATH" <<'SQL' 2>/dev/null || true
SELECT hostname,
       COALESCE(ip, ''),
       COALESCE(last_seen, 0),
       COALESCE(reachable, 0),
       COALESCE(response_time_ms, 0),
       COALESCE(error_count, 0)
  FROM mesh_node_health
 ORDER BY hostname;
SQL
}

peer_state() {
  sqlite3 -separator $'\t' "$DB_PATH" <<'SQL' 2>/dev/null || true
WITH latest AS (
  SELECT agent_id, MAX(epoch) AS epoch
    FROM mesh_consciousness
   WHERE COALESCE(origin, '') != 'self'
   GROUP BY agent_id
)
SELECT m.agent_id,
       m.epoch,
       COALESCE(m.confidence, 0),
       LENGTH(COALESCE(m.state_blob, '')),
       COALESCE(m.state_blob, '')
  FROM mesh_consciousness m
  JOIN latest l ON l.agent_id = m.agent_id AND l.epoch = m.epoch
 ORDER BY m.agent_id;
SQL
}

hash_text() {
  sha256sum | awk '{print $1}'
}

local_signature() {
  local produced="$1"
  {
    printf '%s\n' "$produced"
    printf '%s\n' '__mesh_node_health__'
    health_state
  } | hash_text
}

peer_signature() {
  peer_state | hash_text
}

produce_local_state() {
  "$HOOKS" --produce
}

sync_peers() {
  "$HOOKS" --sync
}

broadcast_local_state() {
  local state="$1"
  "$HOOKS" --broadcast "$state"
}

log_peer_changes() {
  local before="$1"
  local after="$2"
  [[ "$before" != "$after" ]] || return 0
  log INFO "peer consciousness changed signature_before=$before signature_after=$after"
  peer_state | while IFS=$'\t' read -r agent epoch confidence state_len _state || [[ -n "${agent:-}" ]]; do
    [[ -n "${agent:-}" ]] || continue
    log INFO "peer state agent=$agent epoch=$epoch confidence=$confidence state_bytes=$state_len"
  done
}

daemon_tick() {
  local produced local_sig previous_local peer_before peer_after
  date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_CYCLE_FILE"

  produced="$(produce_local_state)"
  local_sig="$(local_signature "$produced")"
  previous_local="$(cat "$LOCAL_STATE_FILE" 2>/dev/null || true)"
  peer_before="$(cat "$PEER_STATE_FILE" 2>/dev/null || peer_signature)"

  if ! sync_peers; then
    log ERROR "peer consciousness sync failed"
  fi
  peer_after="$(peer_signature)"
  log_peer_changes "$peer_before" "$peer_after"
  printf '%s\n' "$peer_after" > "$PEER_STATE_FILE"

  if [[ "$local_sig" != "$previous_local" ]]; then
    log INFO "local consciousness changed signature=$local_sig"
    if broadcast_local_state "$produced"; then
      printf '%s\n' "$local_sig" > "$LOCAL_STATE_FILE"
      log INFO "local consciousness broadcast complete"
    else
      log ERROR "local consciousness broadcast failed"
    fi
  fi
}

handle_signal() {
  STOPPING=1
  log INFO "received termination signal, shutting down"
}

daemon_loop() {
  trap handle_signal TERM INT
  log INFO "daemon started pid=$$ interval=$INTERVAL db=$DB_PATH hooks=$HOOKS"
  while (( STOPPING == 0 )); do
    daemon_tick || log ERROR "cycle failed"
    local i
    for ((i=0; i<INTERVAL && STOPPING == 0; i++)); do
      sleep 1
    done
  done
  cleanup daemon
  log INFO "daemon stopped"
}

run_daemon() {
  parse_common_flags "$@"
  check_prereqs
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
  init_db
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    local pid="unknown"
    [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || printf unknown)"
    printf 'already running (pid %s)\n' "$pid" >&2
    exit 7
  fi
  printf '%s\n' "$$" > "$PID_FILE"
  exec >>"$LOG_FILE" 2>&1
  daemon_loop
}

start_daemon() {
  parse_common_flags "$@"
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
  if [[ -f "$PID_FILE" ]] && is_pid_alive "$(cat "$PID_FILE" 2>/dev/null || true)"; then
    printf 'already running (pid %s)\n' "$(cat "$PID_FILE")" >&2
    exit 7
  fi
  "$0" __run --interval "$INTERVAL" >/dev/null 2>&1 &
  local child="$!"
  local i
  for ((i=0; i<20; i++)); do
    if [[ -f "$PID_FILE" ]] && is_pid_alive "$(cat "$PID_FILE" 2>/dev/null || true)"; then
      printf 'started (pid %s)\n' "$(cat "$PID_FILE")"
      return 0
    fi
    if ! is_pid_alive "$child"; then
      printf 'failed to start; see %s\n' "$LOG_FILE" >&2
      exit 1
    fi
    sleep 0.1
  done
  printf 'start pending (pid %s)\n' "$child"
}

stop_daemon() {
  local pid i
  if [[ ! -f "$PID_FILE" ]]; then
    printf 'not running\n'
    return 0
  fi
  pid="$(cat "$PID_FILE")"
  if ! is_pid_alive "$pid"; then
    rm -f "$PID_FILE"
    printf 'not running (removed stale pid)\n'
    return 0
  fi
  kill -TERM "$pid"
  for ((i=0; i<5; i++)); do
    if ! is_pid_alive "$pid"; then
      rm -f "$PID_FILE"
      printf 'stopped\n'
      return 0
    fi
    sleep 1
  done
  printf 'still running (pid %s)\n' "$pid" >&2
  exit 1
}

status_daemon() {
  local pid last="never" peers="unavailable" health_rows="unavailable"
  [[ -f "$LAST_CYCLE_FILE" ]] && last="$(cat "$LAST_CYCLE_FILE")"
  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    peers="$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT agent_id) FROM mesh_consciousness WHERE COALESCE(origin, '') != 'self';" 2>/dev/null || printf unavailable)"
    health_rows="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM mesh_node_health;" 2>/dev/null || printf unavailable)"
  fi
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if is_pid_alive "$pid"; then
      printf 'status: running\npid: %s\nlast_cycle: %s\npeer_agents: %s\nhealth_rows: %s\nlog: %s\ndb: %s\nhooks: %s\n' "$pid" "$last" "$peers" "$health_rows" "$LOG_FILE" "$DB_PATH" "$HOOKS"
      return 0
    fi
    printf 'status: stale\npid: %s\nlast_cycle: %s\npeer_agents: %s\nhealth_rows: %s\n' "$pid" "$last" "$peers" "$health_rows"
    return 1
  fi
  printf 'status: stopped\nlast_cycle: %s\npeer_agents: %s\nhealth_rows: %s\nlog: %s\ndb: %s\nhooks: %s\n' "$last" "$peers" "$health_rows" "$LOG_FILE" "$DB_PATH" "$HOOKS"
}

main() {
  local cmd="${1:-start}"
  case "$cmd" in
    start)
      shift || true
      start_daemon "$@"
      ;;
    __run)
      shift || true
      run_daemon "$@"
      ;;
    stop)
      shift || true
      stop_daemon "$@"
      ;;
    status)
      shift || true
      status_daemon "$@"
      ;;
    --help|-h|help)
      usage
      ;;
    *)
      log ERROR "unknown subcommand: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
