#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HANDLERS_CONF="${EVENT_BUS_HANDLERS_CONF:-$HERMES_HOME/event-bus-handlers.conf}"
POLL_INTERVAL="${EVENT_BUS_INTERVAL:-3}"

log() {
  printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCRIPT_NAME" "$*" >&2
}

load_handlers() {
  declare -gA EVENT_BUS_HANDLERS=()
  if [[ -f "$HANDLERS_CONF" ]]; then
    # shellcheck source=/dev/null
    source "$HANDLERS_CONF"
  fi
}

dispatch_event() {
  local id="$1"
  local ts="$2"
  local type="$3"
  local payload="$4"
  declare -A EVENT_BUS_HANDLERS=()
  if [[ -f "${EVENT_BUS_HANDLERS_CONF:-}" ]]; then
    # shellcheck source=/dev/null
    source "$EVENT_BUS_HANDLERS_CONF"
  fi
  local handler="${EVENT_BUS_HANDLERS[$type]:-}"

  if [[ -z "$handler" ]]; then
    printf '%s\t%s\t%s\t%s\n' "$id" "$ts" "$type" "$payload"
    return 0
  fi
  if ! declare -F "$handler" >/dev/null 2>&1; then
    log "missing handler function for type '$type': $handler"
    return 1
  fi
  "$handler" "$id" "$ts" "$type" "$payload"
}

main() {
  export SCRIPT_NAME
  EVENT_BUS_HANDLERS_CONF="$HANDLERS_CONF"
  export EVENT_BUS_HANDLERS_CONF
  export -f dispatch_event log
  "$SCRIPT_DIR/event-bus.sh" init
  log "polling every ${POLL_INTERVAL}s using $HANDLERS_CONF"

  while true; do
    load_handlers
    "$SCRIPT_DIR/event-bus.sh" poll dispatch_event || log "poll failed"
    sleep "$POLL_INTERVAL"
  done
}

main "$@"
