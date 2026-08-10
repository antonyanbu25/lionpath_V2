#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
INTERVAL="${NODE_HEALTH_INTERVAL:-30}"
DB_PATH="${HERMES_DB:-$HERMES_HOME/state.db}"
DISCOVERED_NODES_FILE="${DISCOVERED_NODES_FILE:-$HERMES_HOME/config/discovered-nodes.json}"
NODES_FILE="${MESH_NODES_FILE:-$HERMES_HOME/config/mesh-nodes.conf}"
PID_FILE="$HERMES_HOME/run/node-health-daemon.pid"
LOCK_FILE="$HERMES_HOME/run/node-health-daemon.lock"
LAST_CYCLE_FILE="$HERMES_HOME/run/node-health-daemon.last-cycle"
LOG_FILE="$HERMES_HOME/logs/node-health.log"
RADIO_MESH="${RADIO_MESH:-$HERMES_HOME/scripts/agent-radio-mesh.sh}"
HEALTH_SESSION="${MESH_HEALTH_SESSION:-mesh-health}"
NODE_SSH_TIMEOUT="${NODE_SSH_TIMEOUT:-5}"
STOPPING=0

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  node-health-daemon.sh start [--interval <sec>]
  node-health-daemon.sh stop
  node-health-daemon.sh status
  node-health-daemon.sh --help

Defaults:
  --interval  NODE_HEALTH_INTERVAL or 30 seconds

Environment:
  HERMES_HOME          Defaults to ~/.hermes
  HERMES_DB            Defaults to ~/.hermes/state.db
  NODE_SSH_TIMEOUT     Per-node SSH probe timeout, defaults to 5 seconds
  MESH_HEALTH_SESSION  agent-radio-mesh session, defaults to mesh-health
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
  for bin in sqlite3 flock timeout awk sort; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -x "$RADIO_MESH" ]] || log WARN "radio mesh script not executable: $RADIO_MESH"
  [[ "$NODE_SSH_TIMEOUT" =~ ^[0-9]+$ && "$NODE_SSH_TIMEOUT" -gt 0 ]] || { log ERROR "invalid NODE_SSH_TIMEOUT: $NODE_SSH_TIMEOUT"; missing=1; }
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

host_part() {
  local node="$1"
  node="${node#*@}"
  node="${node%%:*}"
  printf '%s' "$node"
}

load_known_nodes() {
  if [[ -s "$DISCOVERED_NODES_FILE" ]]; then
    awk '
      BEGIN { RS="}"; FS="\n" }
      {
        record=$0
        host=""; ip=""
        if (match(record, /"hostname"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
          host=substr(record, RSTART, RLENGTH)
          sub(/^.*"hostname"[[:space:]]*:[[:space:]]*"/, "", host)
          sub(/"$/, "", host)
        }
        if (match(record, /"ip"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
          ip=substr(record, RSTART, RLENGTH)
          sub(/^.*"ip"[[:space:]]*:[[:space:]]*"/, "", ip)
          sub(/"$/, "", ip)
        }
        if (ip != "") {
          if (host == "") host=ip
          print host "\t" ip
        }
      }
    ' "$DISCOVERED_NODES_FILE" | sort -u
    return 0
  fi

  if [[ -s "$NODES_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%%#*}"
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [[ -n "$line" ]] || continue
      read -r first second _ <<< "$line"
      if [[ -n "${second:-}" ]]; then
        printf '%s\t%s\n' "$first" "$(host_part "$second")"
      else
        printf '%s\t%s\n' "$(host_part "$first")" "$(host_part "$first")"
      fi
    done < "$NODES_FILE" | sort -u
  fi
}

probe_node() {
  local ip="$1"
  local start end
  start="$(date +%s%3N)"
  if timeout "$NODE_SSH_TIMEOUT" bash -c 'exec 3<>/dev/tcp/$1/22' _ "$ip" >/dev/null 2>&1; then
    end="$(date +%s%3N)"
    printf '1\t%d\n' "$(( end - start ))"
  else
    end="$(date +%s%3N)"
    printf '0\t%d\n' "$(( end - start ))"
  fi
}

previous_reachable() {
  local hostname="$1"
  sqlite3 "$DB_PATH" "SELECT reachable FROM mesh_node_health WHERE hostname=$(sql_quote "$hostname");"
}

upsert_health() {
  local hostname="$1"
  local ip="$2"
  local reachable="$3"
  local response_time_ms="$4"
  local now="$5"
  local qhost qip
  qhost="$(sql_quote "$hostname")"
  qip="$(sql_quote "$ip")"
  sqlite3 "$DB_PATH" "INSERT INTO mesh_node_health(hostname,ip,last_seen,reachable,response_time_ms,error_count) VALUES($qhost,$qip,$now,$reachable,$response_time_ms,CASE WHEN $reachable=1 THEN 0 ELSE 1 END) ON CONFLICT(hostname) DO UPDATE SET ip=excluded.ip,last_seen=excluded.last_seen,reachable=excluded.reachable,response_time_ms=excluded.response_time_ms,error_count=CASE WHEN excluded.reachable=1 THEN 0 ELSE mesh_node_health.error_count + 1 END;"
}

broadcast_transition() {
  local type="$1"
  local message="$2"
  if [[ ! -x "$RADIO_MESH" ]]; then
    log WARN "transition broadcast skipped; missing $RADIO_MESH"
    return 0
  fi
  "$RADIO_MESH" init "$HEALTH_SESSION" >/dev/null 2>&1 || true
  if ! "$RADIO_MESH" broadcast "$HEALTH_SESSION" "$type" "$message" >/dev/null 2>&1; then
    log WARN "transition broadcast failed: type=$type message=$message"
  fi
}

handle_transition() {
  local hostname="$1"
  local ip="$2"
  local previous="$3"
  local reachable="$4"
  local response_time_ms="$5"
  local message
  [[ "$previous" == "0" || "$previous" == "1" ]] || return 0
  [[ "$previous" != "$reachable" ]] || return 0
  if [[ "$reachable" == "0" ]]; then
    message="node unreachable hostname=$hostname ip=$ip response_time_ms=$response_time_ms"
    log URGENT "$message"
    broadcast_transition URGENT "$message"
  else
    message="node reachable hostname=$hostname ip=$ip response_time_ms=$response_time_ms"
    log FYI "$message"
    broadcast_transition FYI "$message"
  fi
}

check_all_nodes() {
  local hostname ip result reachable response_time_ms previous now count=0
  while IFS=$'\t' read -r hostname ip || [[ -n "${hostname:-}" ]]; do
    [[ -n "${hostname:-}" && -n "${ip:-}" ]] || continue
    previous="$(previous_reachable "$hostname")"
    result="$(probe_node "$ip")"
    IFS=$'\t' read -r reachable response_time_ms <<< "$result"
    now="$(date +%s)"
    upsert_health "$hostname" "$ip" "$reachable" "$response_time_ms" "$now"
    handle_transition "$hostname" "$ip" "$previous" "$reachable" "$response_time_ms"
    count=$(( count + 1 ))
  done < <(load_known_nodes)
  log INFO "health cycle checked $count nodes"
}

handle_signal() {
  STOPPING=1
  log INFO "received termination signal, shutting down"
}

daemon_loop() {
  trap handle_signal TERM INT
  log INFO "daemon started pid=$$ interval=$INTERVAL db=$DB_PATH"
  while (( STOPPING == 0 )); do
    date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_CYCLE_FILE"
    check_all_nodes
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
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$HERMES_HOME/config"
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
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$HERMES_HOME/config"
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
  local pid last="never" rows="unavailable"
  [[ -f "$LAST_CYCLE_FILE" ]] && last="$(cat "$LAST_CYCLE_FILE")"
  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    rows="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM mesh_node_health;" 2>/dev/null || printf unavailable)"
  fi
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if is_pid_alive "$pid"; then
      printf 'status: running\npid: %s\nlast_cycle: %s\nhealth_rows: %s\nlog: %s\ndb: %s\n' "$pid" "$last" "$rows" "$LOG_FILE" "$DB_PATH"
      return 0
    fi
    printf 'status: stale\npid: %s\nlast_cycle: %s\nhealth_rows: %s\n' "$pid" "$last" "$rows"
    return 1
  fi
  printf 'status: stopped\nlast_cycle: %s\nhealth_rows: %s\nlog: %s\ndb: %s\n' "$last" "$rows" "$LOG_FILE" "$DB_PATH"
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
