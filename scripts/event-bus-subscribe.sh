#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HANDLERS_CONF="${EVENT_BUS_HANDLERS_CONF:-$HERMES_HOME/event-bus-handlers.conf}"

die() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  event-bus-subscribe.sh <type> <handler_function>

Registers a type -> handler function mapping in $HOME/.hermes/event-bus-handlers.conf.
The daemon sources that file and dispatches matching events to the named function.
USAGE
  exit 1
}

quote_bash() {
  printf '%q' "$1"
}

valid_function_name() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

main() {
  [[ $# -eq 2 ]] || usage
  local type="$1"
  local handler="$2"

  [[ -n "$type" ]] || die "type must not be empty"
  valid_function_name "$handler" || die "handler must be a bash function name"

  mkdir -p "$(dirname "$HANDLERS_CONF")"
  touch "$HANDLERS_CONF"

  local tmp
  tmp="$(mktemp "${HANDLERS_CONF}.XXXXXX")"
  {
    printf 'declare -Ag EVENT_BUS_HANDLERS\n'
    grep -v -F "EVENT_BUS_HANDLERS[$(quote_bash "$type")]=" "$HANDLERS_CONF" 2>/dev/null || true
    printf 'EVENT_BUS_HANDLERS[%s]=%s\n' "$(quote_bash "$type")" "$(quote_bash "$handler")"
  } > "$tmp"
  mv "$tmp" "$HANDLERS_CONF"
  printf '%s -> %s\n' "$type" "$handler"
}

main "$@"
