#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
POLL_INTERVAL=15
STOP_REQUESTED=0

log() {
  printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCRIPT_NAME" "$*" >&2
}

request_stop() {
  STOP_REQUESTED=1
}

trap request_stop TERM INT

main() {
  log "starting goal scheduler loop; polling every ${POLL_INTERVAL}s"

  while (( STOP_REQUESTED == 0 )); do
    set +e
    output="$("$SCRIPT_DIR/goal-schedule.sh" 2>&1)"
    status=$?
    set -e

    if [[ -n "$output" ]]; then
      while IFS= read -r line; do
        log "$line"
      done <<< "$output"
    fi

    if (( status == 1 )); then
      log "no actionable goal"
    elif (( status != 0 )); then
      log "goal-schedule.sh exited with status $status"
    fi

    if (( STOP_REQUESTED != 0 )); then
      break
    fi

    sleep "$POLL_INTERVAL" &
    wait "$!" || true
  done

  log "stopping goal scheduler loop"
}

main "$@"
