#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
CURIOSITY_DIR="$HERMES_HOME/curiosity"
ARCHIVE_DIR="$CURIOSITY_DIR/archive"
EVENT_BUS="$HERMES_HOME/scripts/event-bus.sh"
AGENT_RADIO="$HERMES_HOME/scripts/agent-radio.sh"

tmp_files=()

cleanup() {
  local tmp
  for tmp in "${tmp_files[@]}"; do
    [[ -n "$tmp" ]] && rm -f "$tmp"
  done
}
trap cleanup EXIT

die() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

usage() {
  die "usage: $SCRIPT_NAME <brief_path> <topic> <tokens>"
}

track_tmp() {
  tmp_files+=("$1")
}

json_escape() {
  local s="${1-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

latest_radio_session() {
  local radio_dir="$HERMES_HOME/agent-radio"
  [[ -d "$radio_dir" ]] || return 0

  find "$radio_dir" -mindepth 1 -maxdepth 1 -type d -name '*' -printf '%T@ %f\n' 2>/dev/null \
    | sort -nr \
    | awk 'NR == 1 {print $2}'
}

first_radio_thread() {
  local session="$1"
  local state_file="$HERMES_HOME/agent-radio/$session/state.json"
  [[ -f "$state_file" ]] || return 0

  sed -n 's/.*"threads":\[{"id":"\([^"]*\)".*/\1/p' "$state_file" | head -1
}

publish_event() {
  local topic="$1"
  local archive_name="$2"
  local tokens="$3"
  local payload

  payload='{"topic":"'"$(json_escape "$topic")"'","brief":"'"$archive_name"'","tokens":'"$tokens"'}'
  "$EVENT_BUS" publish curiosity_cycle "$payload" || true
}

notify_radio() {
  local topic="$1"
  local session thread message

  session="$(latest_radio_session)"
  [[ -n "$session" ]] || return 0

  thread="$(first_radio_thread "$session")"
  thread="${thread:-curiosity}"
  message="curiosity: $topic brief at $HERMES_HOME/curiosity/LATEST.md"

  "$AGENT_RADIO" send "$session" "$thread" FYI "$message" || true
}

main() {
  [[ $# -eq 3 ]] || usage

  local brief_path="$1"
  local topic="$2"
  local tokens="$3"
  local epoch archive_name archive_path archive_tmp latest_tmp

  [[ -f "$brief_path" ]] || die "brief does not exist: $brief_path"
  [[ "$tokens" =~ ^[0-9]+$ ]] || die "tokens must be a non-negative integer"

  mkdir -p "$ARCHIVE_DIR"

  epoch="$(date +%s)"
  archive_name="archive/$epoch.md"
  archive_path="$CURIOSITY_DIR/$archive_name"
  archive_tmp="$archive_path.tmp.$$"
  latest_tmp="$CURIOSITY_DIR/LATEST.md.tmp.$$"
  track_tmp "$archive_tmp"
  track_tmp "$latest_tmp"

  cp "$brief_path" "$archive_tmp"
  mv "$archive_tmp" "$archive_path"

  cp "$brief_path" "$latest_tmp"
  mv "$latest_tmp" "$CURIOSITY_DIR/LATEST.md"

  publish_event "$topic" "$archive_name" "$tokens"
  notify_radio "$topic"

  printf '%s\n' "$CURIOSITY_DIR/LATEST.md"
}

main "$@"
