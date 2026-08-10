#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
INTERVAL="${MESH_INTERVAL:-30}"
NODES_FILE="$HERMES_HOME/config/mesh-nodes.conf"
PID_FILE="$HERMES_HOME/run/mesh-daemon.pid"
LOG_FILE="$HERMES_HOME/logs/mesh-daemon.log"
MESH_MEM="$HERMES_HOME/scripts/mesh-memory.sh"
LOCK_FILE="$HERMES_HOME/run/mesh-daemon.lock"
STOPPING=0

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  mesh-memory-daemon.sh start [--interval <sec>] [--nodes <file>]
  mesh-memory-daemon.sh stop
  mesh-memory-daemon.sh status
  mesh-memory-daemon.sh --help

Defaults:
  --interval  MESH_INTERVAL or 30 seconds
  --nodes     ~/.hermes/config/mesh-nodes.conf
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
  for bin in flock timeout; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -x "$MESH_MEM" ]] || { log ERROR "missing executable: $MESH_MEM"; missing=1; }
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
      --nodes)
        [[ $# -ge 2 ]] || { log ERROR "--nodes requires a value"; exit 1; }
        NODES_FILE="$2"
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

handle_signal() {
  STOPPING=1
  log INFO "received termination signal, shutting down"
}

log_lines() {
  local level="$1"
  local line
  while IFS= read -r line; do
    log "$level" "$line"
  done
}

sync_all_nodes() {
  local node
  if [[ ! -f "$NODES_FILE" ]]; then
    log WARN "nodes file missing: $NODES_FILE"
    return 0
  fi
  while IFS= read -r node || [[ -n "$node" ]]; do
    node="${node%%#*}"
    node="${node#"${node%%[![:space:]]*}"}"
    node="${node%"${node##*[![:space:]]}"}"
    [[ -n "$node" ]] || continue
    log INFO "sync node start: $node"
    if timeout 60 "$MESH_MEM" --sync --node "$node" 2>&1 | log_lines INFO; then
      log INFO "sync node ok: $node"
    else
      log ERROR "sync node failed: $node"
    fi
  done < "$NODES_FILE"
}

daemon_loop() {
  trap handle_signal TERM INT
  log INFO "daemon started pid=$$ interval=$INTERVAL nodes=$NODES_FILE"
  while (( STOPPING == 0 )); do
    date -u +%Y-%m-%dT%H:%M:%SZ > "$HERMES_HOME/run/mesh-daemon.last-cycle"
    log INFO "sync cycle start"
    sync_all_nodes
    log INFO "sync cycle done; sleeping $INTERVAL"
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
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$NODES_FILE")"
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
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$NODES_FILE")"
  if [[ -f "$PID_FILE" ]] && is_pid_alive "$(cat "$PID_FILE" 2>/dev/null || true)"; then
    printf 'already running (pid %s)\n' "$(cat "$PID_FILE")" >&2
    exit 7
  fi
  "$0" __run --interval "$INTERVAL" --nodes "$NODES_FILE" >/dev/null 2>&1 &
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
  local pid last="never"
  [[ -f "$HERMES_HOME/run/mesh-daemon.last-cycle" ]] && last="$(cat "$HERMES_HOME/run/mesh-daemon.last-cycle")"
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if is_pid_alive "$pid"; then
      printf 'status: running\npid: %s\nlast_cycle: %s\nlog: %s\nnodes: %s\n' "$pid" "$last" "$LOG_FILE" "$NODES_FILE"
      return 0
    fi
    printf 'status: stale\npid: %s\nlast_cycle: %s\n' "$pid" "$last"
    return 1
  fi
  printf 'status: stopped\nlast_cycle: %s\nlog: %s\nnodes: %s\n' "$last" "$LOG_FILE" "$NODES_FILE"
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
