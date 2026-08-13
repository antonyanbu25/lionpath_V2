#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
CURIOSITY_HOME="$HERMES_HOME/curiosity"
LOG_FILE="$CURIOSITY_HOME/daemon.log"

THROTTLE_SEC="${CURIOSITY_THROTTLE_SEC:-1800}"
MAX_DAILY="${CURIOSITY_MAX_DAILY:-12}"
DAILY_TOKEN_BUDGET="${CURIOSITY_DAILY_TOKEN_BUDGET:-20000}"
MAX_TOKENS="${CURIOSITY_MAX_TOKENS:-1200}"
TOKENS_PER_CYCLE="${CURIOSITY_TOKENS_PER_CYCLE:-$((MAX_TOKENS * 2))}"

STATE="$SCRIPT_DIR/curiosity-state.sh"
SENSE="$SCRIPT_DIR/curiosity-sense.sh"
FETCH="$SCRIPT_DIR/curiosity-fetch.sh"
SYNTHESIZE="$SCRIPT_DIR/curiosity-synthesize.py"
SURFACE="$SCRIPT_DIR/curiosity-surface.sh"
FEEDBACK="$SCRIPT_DIR/curiosity-feedback.py"

STOP_REQUESTED=0

log() {
  local level="$1"
  shift
  local line
  line="$(printf '[%s] [%s] [%s] %s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*")"
  mkdir -p "$CURIOSITY_HOME"
  printf '%s\n' "$line" >> "$LOG_FILE"
  printf '%s\n' "$line" >&2
}

cleanup() {
  rm -f "/tmp/curiosity.$$."*
}

request_stop() {
  STOP_REQUESTED=1
  log INFO "received termination signal, shutting down after current stage"
}

trap cleanup EXIT
trap request_stop TERM INT

require_positive_int() {
  local name="$1" value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ || "$value" -le 0 ]]; then
    log ERROR "invalid $name=$value"
    exit 2
  fi
}

check_prereqs() {
  local missing=0 path
  for path in "$STATE" "$SENSE" "$FETCH" "$SURFACE"; do
    if [[ ! -x "$path" ]]; then
      log ERROR "missing executable stage: $path"
      missing=1
    fi
  done
  for path in "$SYNTHESIZE" "$FEEDBACK"; do
    if [[ ! -f "$path" ]]; then
      log ERROR "missing stage: $path"
      missing=1
    fi
  done
  command -v python3 >/dev/null 2>&1 || { log ERROR "missing prerequisite: python3"; missing=1; }
  require_positive_int CURIOSITY_THROTTLE_SEC "$THROTTLE_SEC"
  require_positive_int CURIOSITY_MAX_DAILY "$MAX_DAILY"
  require_positive_int CURIOSITY_DAILY_TOKEN_BUDGET "$DAILY_TOKEN_BUDGET"
  require_positive_int CURIOSITY_TOKENS_PER_CYCLE "$TOKENS_PER_CYCLE"
  (( missing == 0 )) || exit 2
}

state_get() {
  "$STATE" get-kv "$1" 2>/dev/null || true
}

state_set() {
  local key="$1" value="$2"
  if ! "$STATE" set-kv "$key" "$value" >/dev/null 2>&1; then
    log ERROR "failed to persist curiosity state key=$key"
    return 1
  fi
}

state_int() {
  local value="${1:-0}"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    printf '0\n'
  fi
}

sleep_throttled() {
  local remaining="$THROTTLE_SEC"
  while (( remaining > 0 && STOP_REQUESTED == 0 )); do
    if (( remaining > 30 )); then
      sleep 30 &
      wait "$!" || true
      remaining=$((remaining - 30))
    else
      sleep "$remaining" &
      wait "$!" || true
      remaining=0
    fi
  done
}

run_stage_capture() {
  local stage="$1"
  shift
  local stdout="/tmp/curiosity.$$.$stage.stdout"
  local stderr="/tmp/curiosity.$$.$stage.stderr"
  local status=0

  log INFO "stage $stage started"
  set +e
  "$@" >"$stdout" 2>"$stderr"
  status=$?
  set -e

  if [[ -s "$stderr" ]]; then
    while IFS= read -r line; do
      log INFO "$stage: $line"
    done < "$stderr"
  fi

  if (( status != 0 )); then
    log ERROR "stage $stage exited with status $status"
    return "$status"
  fi

  log INFO "stage $stage completed"
  cat "$stdout"
}

decide_trigger() {
  local trigger_json="$1"
  python3 - "$trigger_json" <<'PY'
import json
import sys

raw = sys.argv[1].strip()
if not raw:
    sys.exit(0)

try:
    data = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(0)

valid_types = {"T_STALE_TOPIC", "T_SELF_REFLECT"}

def trigger_type(item):
    if not isinstance(item, dict):
        return None
    for key in ("trigger_type", "type", "trigger"):
        value = item.get(key)
        if value in valid_types:
            return value
    for value in item.values():
        if value in valid_types:
            return value
    return None

def is_ready(item):
    if not isinstance(item, dict):
        return False
    if item.get("should_run") is False or item.get("active") is False or item.get("ready") is False:
        return False
    if item.get("skip") is True:
        return False
    return trigger_type(item) is not None

items = []
if isinstance(data, list):
    items = data
elif isinstance(data, dict):
    for key in ("triggers", "trigger_vector", "ready"):
        value = data.get(key)
        if isinstance(value, list):
            items.extend(value)
    if not items:
        items = [data]

for item in items:
    if is_ready(item):
        normalized = dict(item)
        normalized["trigger_type"] = trigger_type(item)
        print(json.dumps(normalized, separators=(",", ":")))
        break
PY
}

noop() {
  log INFO "NOOP reason=$1"
}

run_cycle() {
  local now day last_cycle daily_cycles daily_tokens
  local cycles_key tokens_key decision_json trigger_json
  local TOPIC TRIGGER_TYPE fetch_path synth_result surface_result
  local synth_status brief_path synth_topic tokens_used changes_proposed_json
  local cycle_status=0

  now="$(date -u +%s)"
  day="$(date -u +%Y%m%d)"
  cycles_key="daily_cycles_$day"
  tokens_key="daily_tokens_$day"

  trigger_json="$(run_stage_capture SENSE "$SENSE")" || {
    noop "sense_failed"
    return 0
  }

  decision_json="$(decide_trigger "$trigger_json")"
  if [[ -z "$decision_json" ]]; then
    noop "no_trigger"
    return 0
  fi

  last_cycle="$(state_int "$(state_get last_cycle_at)")"
  if (( last_cycle > 0 && now - last_cycle < THROTTLE_SEC )); then
    noop "throttle_active wait_sec=$((THROTTLE_SEC - (now - last_cycle)))"
    return 0
  fi

  daily_cycles="$(state_int "$(state_get "$cycles_key")")"
  if (( daily_cycles >= MAX_DAILY )); then
    noop "max_daily_cycles_reached cycles=$daily_cycles max=$MAX_DAILY"
    return 0
  fi

  daily_tokens="$(state_int "$(state_get "$tokens_key")")"
  if (( daily_tokens + TOKENS_PER_CYCLE > DAILY_TOKEN_BUDGET )); then
    noop "daily_token_budget_exceeded tokens=$daily_tokens reserve=$TOKENS_PER_CYCLE budget=$DAILY_TOKEN_BUDGET"
    return 0
  fi

  export CURIOSITY_TRIGGER_JSON="$decision_json"
  log INFO "cycle started trigger=$decision_json"

  TOPIC="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); value=data.get("topic", ""); print("" if value is None else value)' "$decision_json")"
  TRIGGER_TYPE="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); value=data.get("trigger_type") or data.get("id") or data.get("type") or data.get("trigger") or ""; print(value)' "$decision_json")"

  if [[ -z "$TOPIC" || -z "$TRIGGER_TYPE" ]]; then
    log ERROR "invalid trigger decision topic=$TOPIC trigger_type=$TRIGGER_TYPE"
    cycle_status=1
  fi

  if (( cycle_status == 0 )) && fetch_path="$(run_stage_capture FETCH "$FETCH" "$TOPIC")"; then
    export CURIOSITY_FETCH_PATH="$fetch_path"
  else
    cycle_status=1
  fi

  if (( cycle_status == 0 )) && synth_result="$(run_stage_capture SYNTHESIZE python3 "$SYNTHESIZE" "$TOPIC" "$TRIGGER_TYPE" "$fetch_path")"; then
    export CURIOSITY_SYNTHESIZE_RESULT="$synth_result"
  else
    cycle_status=1
  fi

  if (( cycle_status == 0 )); then
    synth_status="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); print(data.get("status", ""))' "$synth_result")"
    if [[ "$synth_status" == "skipped" ]]; then
      log INFO "synthesize skipped trigger_type=$TRIGGER_TYPE topic=$TOPIC"
    else
      brief_path="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); value=data.get("brief_path", ""); print("" if value is None else value)' "$synth_result")"
      synth_topic="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); value=data.get("topic", ""); print("" if value is None else value)' "$synth_result")"
      tokens_used="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); value=data.get("tokens_used", 0); print(0 if value is None else value)' "$synth_result")"
      changes_proposed_json="$(python3 -c 'import json, sys; data=json.loads(sys.argv[1]); print(json.dumps(data.get("changes_proposed", {}), separators=(",", ":")))' "$synth_result")"
      [[ -n "$synth_topic" ]] || synth_topic="$TOPIC"

      if [[ -z "$brief_path" ]]; then
        log ERROR "synthesize result missing brief_path topic=$TOPIC trigger_type=$TRIGGER_TYPE"
        cycle_status=1
      fi

      if (( cycle_status == 0 )) && surface_result="$(run_stage_capture SURFACE "$SURFACE" "$brief_path" "$TOPIC" "$tokens_used")"; then
        export CURIOSITY_SURFACE_RESULT="$surface_result"
      else
        cycle_status=1
      fi

      if (( cycle_status == 0 )); then
        run_stage_capture FEEDBACK python3 "$FEEDBACK" "$brief_path" "$changes_proposed_json" >/dev/null || cycle_status=1
      fi
    fi
  fi

  state_set last_cycle_at "$now" || true
  state_set "$cycles_key" "$((daily_cycles + 1))" || true
  state_set "$tokens_key" "$((daily_tokens + TOKENS_PER_CYCLE))" || true

  if (( cycle_status == 0 )); then
    log INFO "cycle completed tokens_reserved=$TOKENS_PER_CYCLE"
  else
    log ERROR "cycle completed with errors tokens_reserved=$TOKENS_PER_CYCLE"
  fi
}

main() {
  mkdir -p "$CURIOSITY_HOME"
  check_prereqs
  log INFO "daemon started throttle_sec=$THROTTLE_SEC max_daily=$MAX_DAILY daily_token_budget=$DAILY_TOKEN_BUDGET"

  while (( STOP_REQUESTED == 0 )); do
    run_cycle
    if (( STOP_REQUESTED == 0 )); then
      sleep_throttled
    fi
  done

  log INFO "daemon stopped"
}

main "$@"
