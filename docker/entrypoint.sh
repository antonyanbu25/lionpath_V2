#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
LOG_FILE="$HERMES_HOME/logs/mesh-daemon.log"
DAEMON="$HERMES_HOME/scripts/mesh-memory-daemon.sh"
MESH_MEM="$HERMES_HOME/scripts/mesh-memory.sh"
TAIL_PID=""

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  entrypoint.sh [--help]

Starts the Gideon fringe memory node:
  1. Ensures ~/.hermes/state.db exists.
  2. Runs mesh-memory.sh --migrate.
  3. Starts mesh-memory-daemon.sh.
  4. Streams ~/.hermes/logs/mesh-daemon.log.
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  log INFO "stopping fringe node"
  "$DAEMON" stop >/dev/null 2>&1 || true
  if [[ -n "${TAIL_PID:-}" ]]; then
    kill "$TAIL_PID" >/dev/null 2>&1 || true
  fi
}

trap 'err_handler "$LINENO" "$?"' ERR
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

prepare_home() {
  mkdir -p "$HERMES_HOME/config" "$HERMES_HOME/logs" "$HERMES_HOME/run" "$HERMES_HOME/agent-radio"
  if [[ ! -f "$HERMES_HOME/state.db" ]]; then
    log WARN "state.db not mounted; creating empty database at $HERMES_HOME/state.db"
    sqlite3 "$HERMES_HOME/state.db" 'CREATE TABLE IF NOT EXISTS memory(key TEXT PRIMARY KEY, value TEXT);'
  fi
  if [[ -d "$HOME/.ssh" ]]; then
    chmod 700 "$HOME/.ssh" || true
    find "$HOME/.ssh" -type f -name 'id_*' -exec chmod 600 {} + 2>/dev/null || true
  else
    log WARN "no ~/.ssh mount found; remote sync will fail until keys are provided"
  fi
}

main() {
  case "${1:-}" in
    --help|-h|help)
      usage
      exit 0
      ;;
    "")
      ;;
    *)
      log ERROR "unknown argument: $1"
      usage
      exit 1
      ;;
  esac

  [[ -x "$MESH_MEM" ]] || { log ERROR "missing executable: $MESH_MEM"; exit 2; }
  [[ -x "$DAEMON" ]] || { log ERROR "missing executable: $DAEMON"; exit 2; }

  prepare_home
  "$MESH_MEM" --migrate
  touch "$LOG_FILE"
  "$DAEMON" start --interval "${MESH_INTERVAL:-30}"
  tail -F "$LOG_FILE" &
  TAIL_PID="$!"
  wait "$TAIL_PID"
}

main "$@"
