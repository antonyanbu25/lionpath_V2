#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
RADIO_SCRIPT="$SCRIPT_DIR/agent-radio.sh"

die() {
  printf 'agent-radio-init: %s\n' "$*" >&2
  exit 1
}

quote_export() {
  local s="${1-}"
  s="${s//\'/\'\\\'\'}"
  printf "'%s'" "$s"
}

[[ $# -ge 2 ]] || die "usage: bash agent-radio-init.sh <sessionId> <agentId1> [agentId2...]"
[[ -f "$RADIO_SCRIPT" ]] || die "missing agent-radio.sh at: $RADIO_SCRIPT"

session_id="$1"
shift
agents_csv=""
for agent_id in "$@"; do
  if [[ -n "$agents_csv" ]]; then
    agents_csv="$agents_csv,$agent_id"
  else
    agents_csv="$agent_id"
  fi
done

bash "$RADIO_SCRIPT" init "$session_id" "$agents_csv" >/dev/null

printf 'export AGENT_RADIO_SESSION_ID=%s\n' "$(quote_export "$session_id")"
printf 'export AGENT_RADIO_SCRIPT=%s\n' "$(quote_export "$RADIO_SCRIPT")"
printf 'export AGENT_RADIO_AGENTS=%s\n' "$(quote_export "$agents_csv")"
printf 'export AGENT_ID=%s\n' "$(quote_export "$1")"
