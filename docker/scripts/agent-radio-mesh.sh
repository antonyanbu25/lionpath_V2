#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
RADIO="${RADIO:-$HERMES_HOME/scripts/agent-radio.sh}"
BUS_BASE="$HERMES_HOME/agent-radio"
NODE_ID="${MESH_NODE_ID:-${USER}@$(hostname -f 2>/dev/null || hostname)}"
POLL_INTERVAL="${MESH_POLL_INTERVAL:-2}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)
TAILER_CHILD=""

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  agent-radio-mesh.sh init <sessionId>
  agent-radio-mesh.sh join <sessionId> <leadHost> [sshUser]
  agent-radio-mesh.sh broadcast <sessionId> <type> <content>
  agent-radio-mesh.sh participants <sessionId>
  agent-radio-mesh.sh leave <sessionId> [leadHost]
  agent-radio-mesh.sh --help

Ledger format:
  epoch_ms<TAB>origin_node<TAB>type<TAB>base64_content
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  if [[ -n "${TAILER_CHILD:-}" ]]; then
    kill "$TAILER_CHILD" >/dev/null 2>&1 || true
  fi
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

check_prereqs() {
  local missing=0 bin
  for bin in ssh flock base64; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -x "$RADIO" ]] || { log ERROR "missing executable radio script: $RADIO"; missing=1; }
  (( missing == 0 )) || exit 2
}

mesh_dir() {
  printf '%s/%s' "$BUS_BASE" "$1"
}

participants_file() {
  printf '%s/mesh.participants' "$(mesh_dir "$1")"
}

ledger_file() {
  printf '%s/mesh.ledger' "$(mesh_dir "$1")"
}

epoch_ms() {
  date +%s%3N
}

valid_radio_type() {
  case "${1:-}" in
    FYI|URGENT|QUERY|RESPONSE|STATUS) return 0 ;;
    *) return 1 ;;
  esac
}

radio_type_for() {
  if valid_radio_type "$1"; then
    printf '%s' "$1"
  else
    printf 'FYI'
  fi
}

ensure_radio_session() {
  local session_id="$1"
  if [[ ! -f "$(mesh_dir "$session_id")/state.json" ]]; then
    "$RADIO" init "$session_id" >/dev/null
  fi
  "$RADIO" thread "$session_id" mesh '*' >/dev/null 2>&1 || true
}

mesh_init() {
  local session_id="$1"
  local dir participants ledger
  dir="$(mesh_dir "$session_id")"
  ensure_radio_session "$session_id"
  mkdir -p "$dir"
  participants="$(participants_file "$session_id")"
  ledger="$(ledger_file "$session_id")"
  touch "$participants" "$ledger"
  (
    flock -w 5 9
    grep -Fxq "$NODE_ID" "$participants" 2>/dev/null || printf '%s\n' "$NODE_ID" >> "$participants"
  ) 9>"$participants.lock"
  (
    flock -w 5 9
    if ! grep -q '^# mesh-init ' "$ledger" 2>/dev/null; then
      printf '# mesh-init %s %s %s\n' "$session_id" "$NODE_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$ledger"
    fi
  ) 9>"$ledger.lock"
  printf '%s\n' "$dir"
}

target_for() {
  local host="$1"
  local user="${2:-}"
  if [[ "$host" == *@* ]]; then
    printf '%s' "$host"
  elif [[ -n "$user" ]]; then
    printf '%s@%s' "$user" "$host"
  else
    printf '%s' "$host"
  fi
}

is_local_target() {
  local target="$1"
  local host="${target#*@}"
  [[ "$target" == "localhost" || "$target" == "127.0.0.1" || "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "$(hostname 2>/dev/null || true)" ]]
}

register_self_on_lead() {
  local lead="$1"
  local session_id="$2"
  local participants
  participants="$(participants_file "$session_id")"
  if is_local_target "$lead"; then
    mkdir -p "$(mesh_dir "$session_id")"
    touch "$participants"
    (
      flock -w 5 9
      grep -Fxq "$NODE_ID" "$participants" 2>/dev/null || printf '%s\n' "$NODE_ID" >> "$participants"
    ) 9>"$participants.lock"
  else
    ssh "${SSH_OPTS[@]}" "$lead" 'bash -s' -- "$session_id" "$NODE_ID" <<'REMOTE'
set -Eeuo pipefail
session_id="$1"
node_id="$2"
dir="$HOME/.hermes/agent-radio/$session_id"
participants="$dir/mesh.participants"
mkdir -p "$dir"
touch "$participants"
(
  flock -w 5 9
  grep -Fxq "$node_id" "$participants" 2>/dev/null || printf '%s\n' "$node_id" >> "$participants"
) 9>"$participants.lock"
REMOTE
  fi
}

remote_file_size() {
  local lead="$1"
  local session_id="$2"
  local ledger="$HOME/.hermes/agent-radio/$session_id/mesh.ledger"
  if is_local_target "$lead"; then
    stat -c %s "$(ledger_file "$session_id")" 2>/dev/null || printf '0\n'
  else
    ssh "${SSH_OPTS[@]}" "$lead" "stat -c %s $(printf '%q' "$ledger") 2>/dev/null || printf '0\n'"
  fi
}

remote_tail_from() {
  local lead="$1"
  local session_id="$2"
  local offset="$3"
  local ledger="$HOME/.hermes/agent-radio/$session_id/mesh.ledger"
  if is_local_target "$lead"; then
    tail -c +"$offset" "$(ledger_file "$session_id")" 2>/dev/null || true
  else
    ssh "${SSH_OPTS[@]}" "$lead" "tail -c +$offset $(printf '%q' "$ledger") 2>/dev/null || true"
  fi
}

decode_b64() {
  base64 -d 2>/dev/null || base64 --decode
}

process_ledger_line() {
  local session_id="$1"
  local line="$2"
  local ts origin type encoded content
  [[ -n "$line" && "${line:0:1}" != "#" ]] || return 0
  IFS=$'\t' read -r ts origin type encoded <<< "$line"
  [[ -n "${origin:-}" && -n "${type:-}" && -n "${encoded:-}" ]] || return 0
  [[ "$origin" != "$NODE_ID" ]] || return 0
  content="$(printf '%s' "$encoded" | decode_b64)"
  AGENT_ID="$origin" "$RADIO" send "$session_id" mesh "$(radio_type_for "$type")" "$content" >/dev/null
}

tailer_loop() {
  local session_id="$1"
  local lead="$2"
  local last_offset size delta line backoff=2
  trap 'exit 0' TERM INT
  ensure_radio_session "$session_id"
  size="$(remote_file_size "$lead" "$session_id")"
  last_offset=$(( ${size:-0} + 1 ))
  while true; do
    if delta="$(remote_tail_from "$lead" "$session_id" "$last_offset")"; then
      while IFS= read -r line || [[ -n "$line" ]]; do
        process_ledger_line "$session_id" "$line"
      done <<< "$delta"
      size="$(remote_file_size "$lead" "$session_id")"
      last_offset=$(( ${size:-0} + 1 ))
      backoff=2
    else
      log WARN "ledger tail failed for $lead; backing off ${backoff}s"
      sleep "$backoff"
      (( backoff < 30 )) && backoff=$(( backoff * 2 ))
      continue
    fi
    sleep "$POLL_INTERVAL"
  done
}

spawn_ledger_tailer() {
  local session_id="$1"
  local lead="$2"
  local dir pid_file old_pid
  dir="$(mesh_dir "$session_id")"
  pid_file="$dir/.tailer.pid"
  if [[ -f "$pid_file" ]]; then
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      printf 'tailer already running (pid %s)\n' "$old_pid"
      return 0
    fi
  fi
  "$0" __tailer "$session_id" "$lead" >>"$dir/tailer.log" 2>&1 &
  TAILER_CHILD="$!"
  printf '%s\n' "$TAILER_CHILD" > "$pid_file"
  printf 'tailer started (pid %s)\n' "$TAILER_CHILD"
  TAILER_CHILD=""
}

mesh_join() {
  local session_id="$1"
  local lead_host="$2"
  local ssh_user="${3:-}"
  local lead
  lead="$(target_for "$lead_host" "$ssh_user")"
  if ! is_local_target "$lead"; then
    ssh "${SSH_OPTS[@]}" "$lead" 'test -d ~/.hermes/scripts' || { log ERROR "lead unreachable: $lead"; exit 3; }
  fi
  ensure_radio_session "$session_id"
  register_self_on_lead "$lead" "$session_id"
  spawn_ledger_tailer "$session_id" "$lead"
  printf 'joined %s via %s\n' "$session_id" "$lead"
  mesh_participants "$session_id" | wc -l
}

write_ledger() {
  local session_id="$1"
  local type="$2"
  local content="$3"
  local origin="${4:-$NODE_ID}"
  local ledger encoded
  ledger="$(ledger_file "$session_id")"
  mkdir -p "$(dirname "$ledger")"
  touch "$ledger"
  encoded="$(printf '%s' "$content" | base64 -w 0)"
  (
    flock -w 5 9
    printf '%s\t%s\t%s\t%s\n' "$(epoch_ms)" "$origin" "$type" "$encoded" >> "$ledger"
  ) 9>"$ledger.lock"
}

fan_out_remote() {
  local session_id="$1"
  local type="$2"
  local content="$3"
  local participant="$4"
  if is_local_target "$participant"; then
    AGENT_ID="$NODE_ID" "$RADIO" send "$session_id" mesh "$(radio_type_for "$type")" "$content" >/dev/null || return 1
  else
    printf '%s' "$content" | ssh "${SSH_OPTS[@]}" "$participant" "AGENT_ID=$(printf '%q' "$NODE_ID") ~/.hermes/scripts/agent-radio.sh send $(printf '%q' "$session_id") mesh $(printf '%q' "$(radio_type_for "$type")")" >/dev/null
  fi
}

mesh_broadcast() {
  local session_id="$1"
  local type="$2"
  local content="$3"
  local participants participant
  ensure_radio_session "$session_id"
  write_ledger "$session_id" "$type" "$content" "$NODE_ID"
  AGENT_ID="$NODE_ID" "$RADIO" send "$session_id" mesh "$(radio_type_for "$type")" "$content" >/dev/null
  participants="$(participants_file "$session_id")"
  [[ -f "$participants" ]] || return 0
  while IFS= read -r participant || [[ -n "$participant" ]]; do
    [[ -n "$participant" && "$participant" != "$NODE_ID" ]] || continue
    fan_out_remote "$session_id" "$type" "$content" "$participant" || log WARN "remote fan-out failed: $participant"
  done < "$participants"
}

mesh_participants() {
  local session_id="$1"
  local participants
  participants="$(participants_file "$session_id")"
  [[ -f "$participants" ]] || return 0
  (
    flock -w 5 9
    sed '/^[[:space:]]*$/d' "$participants" | sort -u
  ) 9>"$participants.lock"
}

mesh_leave() {
  local session_id="$1"
  local lead="${2:-}"
  local participants pid_file pid
  participants="$(participants_file "$session_id")"
  if [[ -f "$participants" ]]; then
    (
      flock -w 5 9
      grep -Fxv "$NODE_ID" "$participants" > "$participants.tmp.$$" || true
      mv "$participants.tmp.$$" "$participants"
    ) 9>"$participants.lock"
  fi
  if [[ -n "$lead" ]] && ! is_local_target "$lead"; then
    ssh "${SSH_OPTS[@]}" "$lead" 'bash -s' -- "$session_id" "$NODE_ID" <<'REMOTE' || log WARN "remote leave failed"
set -Eeuo pipefail
session_id="$1"
node_id="$2"
participants="$HOME/.hermes/agent-radio/$session_id/mesh.participants"
[[ -f "$participants" ]] || exit 0
(
  flock -w 5 9
  grep -Fxv "$node_id" "$participants" > "$participants.tmp.$$" || true
  mv "$participants.tmp.$$" "$participants"
) 9>"$participants.lock"
REMOTE
  fi
  pid_file="$(mesh_dir "$session_id")/.tailer.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill "$pid" >/dev/null 2>&1 || true
    rm -f "$pid_file"
  fi
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    init)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      check_prereqs
      mesh_init "$2"
      ;;
    join)
      [[ $# -ge 3 && $# -le 4 ]] || { usage; exit 1; }
      check_prereqs
      mesh_join "$2" "$3" "${4:-}"
      ;;
    broadcast)
      [[ $# -eq 4 ]] || { usage; exit 1; }
      check_prereqs
      mesh_broadcast "$2" "$3" "$4"
      ;;
    participants)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      check_prereqs
      mesh_participants "$2"
      ;;
    leave)
      [[ $# -ge 2 && $# -le 3 ]] || { usage; exit 1; }
      check_prereqs
      mesh_leave "$2" "${3:-}"
      ;;
    __tailer)
      [[ $# -eq 3 ]] || exit 1
      check_prereqs
      tailer_loop "$2" "$3"
      ;;
    --help|-h|help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
