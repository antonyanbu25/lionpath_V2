#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${EVENT_BUS_DB:-${HERMES_DB:-$HERMES_HOME/state.db}}"

die() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  session-heartbeat.sh emit --goal <text> --status <working|blocked|done|waiting> [options]

Options:
  --last-action <text>   Last completed action
  --blocked-on <text>    Current blocker, if any
  --topics <a,b,c>       Comma-separated topic list
  --eta <text>           Estimated time to completion

Environment:
  HERMES_SESSION_ID      Existing session id, otherwise generated
  HERMES_AGENT_ID        Agent id, otherwise hostname
  HERMES_HOME            Defaults to ~/.hermes
  EVENT_BUS_DB/HERMES_DB Defaults to $HERMES_HOME/state.db
USAGE
  exit 1
}

json_escape() {
  local s="${1-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\b'/\\b}"
  s="${s//$'\f'/\\f}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

json_string() {
  printf '"%s"' "$(json_escape "${1-}")"
}

generate_session_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    printf '%s-%s-%s\n' "$(hostname 2>/dev/null || printf unknown)" "$(date +%s)" "$RANDOM"
  fi
}

topics_json() {
  local raw="${1-}"
  local out="["
  local first=1
  local topic

  IFS=',' read -r -a topics <<< "$raw"
  for topic in "${topics[@]}"; do
    topic="${topic#"${topic%%[![:space:]]*}"}"
    topic="${topic%"${topic##*[![:space:]]}"}"
    [[ -n "$topic" ]] || continue
    if [[ "$first" -eq 0 ]]; then
      out+=","
    fi
    out+="$(json_string "$topic")"
    first=0
  done

  out+="]"
  printf '%s' "$out"
}

agent_id() {
  if [[ -n "${HERMES_AGENT_ID:-}" ]]; then
    printf '%s' "$HERMES_AGENT_ID"
  else
    hostname -s 2>/dev/null || hostname 2>/dev/null || printf unknown
  fi
}

emit() {
  local goal=""
  local status=""
  local last_action=""
  local blocked_on=""
  local topics=""
  local eta=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --goal) [[ $# -ge 2 ]] || die "--goal requires a value"; goal="$2"; shift 2 ;;
      --status) [[ $# -ge 2 ]] || die "--status requires a value"; status="$2"; shift 2 ;;
      --last-action) [[ $# -ge 2 ]] || die "--last-action requires a value"; last_action="$2"; shift 2 ;;
      --blocked-on) [[ $# -ge 2 ]] || die "--blocked-on requires a value"; blocked_on="$2"; shift 2 ;;
      --topics) [[ $# -ge 2 ]] || die "--topics requires a value"; topics="$2"; shift 2 ;;
      --eta) [[ $# -ge 2 ]] || die "--eta requires a value"; eta="$2"; shift 2 ;;
      -h|--help|help) usage ;;
      *) die "unknown option: $1" ;;
    esac
  done

  [[ -n "$goal" ]] || die "--goal is required"
  case "$status" in
    working|blocked|done|waiting) ;;
    "") die "--status is required" ;;
    *) die "--status must be one of: working, blocked, done, waiting" ;;
  esac

  local session_id="${HERMES_SESSION_ID:-}"
  [[ -n "$session_id" ]] || session_id="$(generate_session_id)"

  local ts
  ts="$(date +%s)"

  local payload
  payload="{\"type\":\"session_heartbeat\""
  payload+=",\"session_id\":$(json_string "$session_id")"
  payload+=",\"agent_id\":$(json_string "$(agent_id)")"
  payload+=",\"goal\":$(json_string "$goal")"
  payload+=",\"status\":$(json_string "$status")"
  payload+=",\"last_action\":$(json_string "$last_action")"
  payload+=",\"blocked_on\":$(json_string "$blocked_on")"
  payload+=",\"topics\":$(topics_json "$topics")"
  payload+=",\"eta\":$(json_string "$eta")"
  payload+=",\"ts\":$ts}"

  [[ -x "$HERMES_HOME/scripts/event-bus.sh" || -f "$HERMES_HOME/scripts/event-bus.sh" ]] \
    || die "event-bus script not found: $HERMES_HOME/scripts/event-bus.sh"

  EVENT_BUS_DB="$DB_PATH" bash "$HERMES_HOME/scripts/event-bus.sh" publish gideon_events "$payload"
}

main() {
  [[ $# -ge 1 ]] || usage

  local cmd="$1"
  shift
  case "$cmd" in
    emit) emit "$@" ;;
    -h|--help|help) usage ;;
    *) usage ;;
  esac
}

main "$@"
