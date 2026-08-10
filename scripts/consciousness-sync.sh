#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
NODES_FILE="${MESH_NODES_FILE:-$HERMES_HOME/config/mesh-nodes.conf}"
MESH_MEM="$HERMES_HOME/scripts/mesh-memory.sh"
LOG_FILE="$HERMES_HOME/logs/mesh-cron.log"

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  consciousness-sync.sh [--node <user@host>] [--nodes <file>] [--help]

Runs mesh-memory.sh --sync for one explicit node or each non-comment node in
~/.hermes/config/mesh-nodes.conf. Logs to ~/.hermes/logs/mesh-cron.log.
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

sync_node() {
  local node="$1"
  log INFO "sync node start: $node"
  if "$MESH_MEM" --sync --node "$node"; then
    log INFO "sync node ok: $node"
  else
    log ERROR "sync node failed: $node"
    return 1
  fi
}

main() {
  local node="" raw failures=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --node)
        [[ $# -ge 2 ]] || { log ERROR "--node requires a value"; exit 1; }
        node="$2"
        shift 2
        ;;
      --nodes)
        [[ $# -ge 2 ]] || { log ERROR "--nodes requires a value"; exit 1; }
        NODES_FILE="$2"
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

  mkdir -p "$(dirname "$LOG_FILE")"
  exec >>"$LOG_FILE" 2>&1
  [[ -x "$MESH_MEM" ]] || { log ERROR "missing executable: $MESH_MEM"; exit 2; }

  if [[ -n "$node" ]]; then
    sync_node "$node"
    return $?
  fi

  if [[ ! -f "$NODES_FILE" ]]; then
    log WARN "nodes file missing: $NODES_FILE"
    return 0
  fi

  while IFS= read -r raw || [[ -n "$raw" ]]; do
    raw="${raw%%#*}"
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    [[ -n "$raw" ]] || continue
    sync_node "$raw" || failures=$((failures + 1))
  done < "$NODES_FILE"
  (( failures == 0 )) || return 1
}

main "$@"
