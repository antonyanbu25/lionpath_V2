#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
BUS_BASE="$(cd "$SCRIPT_DIR/.." && pwd -P)/agent-radio"

die() {
  printf 'agent-radio: %s\n' "$*" >&2
  exit 1
}

usage() {
  die "usage: $0 {init|thread|send|wait|read|end} ..."
}

epoch_ms() {
  date +%s%3N
}

sender_id() {
  printf '%s' "${AGENT_ID:-$(hostname)}"
}

session_dir() {
  local session_id="${1:-}"
  [[ -n "$session_id" ]] || die "missing sessionId"
  printf '%s/%s' "$BUS_BASE" "$session_id"
}

require_session() {
  local dir
  dir="$(session_dir "$1")"
  [[ -d "$dir" ]] || die "session does not exist: $1"
  [[ -f "$dir/state.json" ]] || die "missing state.json for session: $1"
  [[ -f "$dir/next-id" ]] || die "missing next-id for session: $1"
  printf '%s' "$dir"
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

json_array_from_csv() {
  local csv="${1-}"
  local out="" item escaped
  IFS=',' read -r -a items <<< "$csv"
  for item in "${items[@]}"; do
    [[ -n "$item" ]] || continue
    escaped="$(json_escape "$item")"
    if [[ -n "$out" ]]; then
      out="$out,\"$escaped\""
    else
      out="\"$escaped\""
    fi
  done
  printf '[%s]' "$out"
}

join_csv_args() {
  local out="" arg
  for arg in "$@"; do
    [[ -n "$arg" ]] || continue
    if [[ -n "$out" ]]; then
      out="$out,$arg"
    else
      out="$arg"
    fi
  done
  printf '%s' "$out"
}

valid_type() {
  case "${1:-}" in
    FYI|URGENT|QUERY|RESPONSE|STATUS) return 0 ;;
    *) return 1 ;;
  esac
}

sanitize_filename_part() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

update_last_msg_id() {
  local state_file="$1"
  local id="$2"
  local tmp
  tmp="$(mktemp "${state_file}.XXXXXX")"
  sed -E 's/"lastMsgId":[0-9]+/"lastMsgId":'"$id"'/' "$state_file" > "$tmp"
  mv "$tmp" "$state_file"
}

message_matches_agent() {
  local mentions="$1"
  local agent="${2:-}"
  local item

  [[ -z "$agent" ]] && return 0
  [[ -z "$mentions" ]] && return 0

  IFS=',' read -r -a mention_items <<< "$mentions"
  for item in "${mention_items[@]}"; do
    [[ "$item" == "$agent" || "$item" == "*" ]] && return 0
  done
  return 1
}

emit_msg_json() {
  local file="$1"
  local since="${2:-0}"
  local agent="${3:-}"
  local id="" epoch="" sender="" type="" thread="" mentions="" content=""
  local in_body=0 line

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$in_body" -eq 0 ]]; then
      if [[ -z "$line" ]]; then
        in_body=1
        continue
      fi
      case "$line" in
        id:*) id="${line#id:}" ;;
        epoch:*) epoch="${line#epoch:}" ;;
        sender:*) sender="${line#sender:}" ;;
        type:*) type="${line#type:}" ;;
        thread:*) thread="${line#thread:}" ;;
        mentions:*) mentions="${line#mentions:}" ;;
      esac
    else
      if [[ -n "$content" ]]; then
        content="${content}"$'\n'"$line"
      else
        content="$line"
      fi
    fi
  done < "$file"

  [[ "$id" =~ ^[0-9]+$ ]] || return 0
  (( id > since )) || return 0
  if [[ -n "$agent" ]]; then
    [[ "$sender" != "$agent" ]] || return 0
    message_matches_agent "$mentions" "$agent" || return 0
  fi

  printf '{"id":%s,"epoch":%s,"sender":"%s","type":"%s","thread":"%s","mentions":"%s","content":"%s"}\n' \
    "$id" \
    "${epoch:-0}" \
    "$(json_escape "$sender")" \
    "$(json_escape "$type")" \
    "$(json_escape "$thread")" \
    "$(json_escape "$mentions")" \
    "$(json_escape "$content")"
}

cmd_init() {
  [[ $# -ge 1 ]] || die "init requires <sessionId> [agentIds]"
  local session_id="$1"
  shift
  local dir agents_csv agents_json created
  dir="$(session_dir "$session_id")"
  agents_csv="$(join_csv_args "$@")"
  agents_json="$(json_array_from_csv "$agents_csv")"
  created="$(epoch_ms)"

  mkdir -p "$dir/messages"
  printf '1\n' > "$dir/next-id"
  : > "$dir/next-id.lock"
  printf '{"sessionId":"%s","agents":%s,"threads":[],"created":%s,"lastMsgId":0,"status":"active"}\n' \
    "$(json_escape "$session_id")" "$agents_json" "$created" > "$dir/state.json"
  printf '%s\n' "$dir"
}

cmd_thread() {
  [[ $# -ge 2 ]] || die "thread requires <sessionId> <threadName> [participantsCSV]"
  local session_id="$1"
  local thread_name="$2"
  local participants_csv="${3:-}"
  local dir state_file created thread_json state prefix suffix tmp
  dir="$(require_session "$session_id")"
  state_file="$dir/state.json"
  created="$(epoch_ms)"
  thread_json='{"id":"'"$(json_escape "$thread_name")"'","name":"'"$(json_escape "$thread_name")"'","participants":'"$(json_array_from_csv "$participants_csv")"',"created":'"$created"'}'

  exec 9>"$dir/next-id.lock"
  flock -w 5 9 || die "could not acquire lock for session: $session_id"
  state="$(< "$state_file")"
  [[ "$state" == *'"threads":['* && "$state" == *'],"created":'* ]] || die "invalid state.json for session: $session_id"
  prefix="${state%],\"created\":*}"
  suffix="${state##*],\"created\":}"
  if [[ "$prefix" == *'"threads":[' ]]; then
    state="${prefix}${thread_json}],\"created\":${suffix}"
  else
    state="${prefix},${thread_json}],\"created\":${suffix}"
  fi
  tmp="$(mktemp "${state_file}.XXXXXX")"
  printf '%s\n' "$state" > "$tmp"
  mv "$tmp" "$state_file"
  flock -u 9
  printf '%s\n' "$thread_name"
}

cmd_send() {
  [[ $# -ge 3 ]] || die "send requires <sessionId> <threadId> <type> <content> [mentionsCSV]"
  local session_id="$1"
  local thread_id="$2"
  local type="$3"
  shift 3
  valid_type "$type" || die "invalid message type: $type"

  local stdin_content="" content_arg="${1:-}" mentions="${2:-}" content
  if [[ ! -t 0 ]]; then
    stdin_content="$(cat || true)"
  fi
  if [[ -n "$stdin_content" ]]; then
    content="$stdin_content"
  else
    [[ $# -ge 1 ]] || die "send requires content when stdin is empty"
    content="$content_arg"
  fi

  local dir id next epoch sender hash safe_sender safe_type msg_tmp msg_file
  dir="$(require_session "$session_id")"
  mkdir -p "$dir/messages"
  sender="$(sender_id)"

  exec 9>"$dir/next-id.lock"
  flock -w 5 9 || die "could not acquire lock for session: $session_id"
  id="$(< "$dir/next-id")"
  [[ "$id" =~ ^[0-9]+$ ]] || die "invalid next-id for session: $session_id"
  next=$((id + 1))
  printf '%s\n' "$next" > "$dir/next-id"
  epoch="$(epoch_ms)"
  hash="$(printf '%s' "$id$epoch$sender$type$thread_id$mentions$content" | sha1sum | awk '{print substr($1,1,12)}')"
  safe_sender="$(sanitize_filename_part "$sender")"
  safe_type="$(sanitize_filename_part "$type")"
  msg_file="$dir/messages/${id}-${epoch}-${safe_sender}-${safe_type}-${hash}.msg"
  msg_tmp="${msg_file}.tmp.$$"
  {
    printf 'id:%s\n' "$id"
    printf 'epoch:%s\n' "$epoch"
    printf 'sender:%s\n' "$sender"
    printf 'type:%s\n' "$type"
    printf 'thread:%s\n' "$thread_id"
    printf 'mentions:%s\n' "$mentions"
    printf '\n'
    printf '%s\n' "$content"
  } > "$msg_tmp"
  mv "$msg_tmp" "$msg_file"
  update_last_msg_id "$dir/state.json" "$id"
  flock -u 9
  printf '%s\n' "$id"
}

cmd_read() {
  [[ $# -ge 1 ]] || die "read requires <sessionId>"
  local session_id="$1"
  shift
  local since=0 agent="" dir arg
  while [[ $# -gt 0 ]]; do
    arg="$1"
    case "$arg" in
      --since)
        [[ $# -ge 2 ]] || die "--since requires <msgId>"
        since="$2"
        shift 2
        ;;
      --agent)
        [[ $# -ge 2 ]] || die "--agent requires <agentId>"
        agent="$2"
        shift 2
        ;;
      *)
        die "unknown read option: $arg"
        ;;
    esac
  done
  [[ "$since" =~ ^[0-9]+$ ]] || die "invalid --since value: $since"
  dir="$(require_session "$session_id")"
  if [[ -d "$dir/messages" ]]; then
    while IFS= read -r file; do
      emit_msg_json "$dir/messages/$file" "$since" "$agent"
    done < <(find "$dir/messages" -maxdepth 1 -type f -name '*.msg' -printf '%f\n' | sort -n)
  fi
}

cmd_wait() {
  [[ $# -ge 2 ]] || die "wait requires <sessionId> <agentId> [pollMs]"
  local session_id="$1"
  local agent="$2"
  local poll_ms="${3:-5000}"
  [[ "$poll_ms" =~ ^[0-9]+$ ]] || die "invalid poll interval: $poll_ms"
  local dir next_id last_seen_id signal sec ms
  dir="$(require_session "$session_id")"
  next_id="$(< "$dir/next-id")"
  [[ "$next_id" =~ ^[0-9]+$ ]] || die "invalid next-id for session: $session_id"
  last_seen_id=$((next_id - 1))

  handle_signal() {
    signal="$1"
    AGENT_ID="$agent" "$0" send "$session_id" status STATUS "DEAF" >/dev/null 2>&1 || true
    printf '{"signal":"%s"}\n' "$signal"
    exit 0
  }
  trap 'handle_signal SIGTERM' TERM
  trap 'handle_signal SIGINT' INT

  while true; do
    if [[ -d "$dir/messages" ]]; then
      while IFS= read -r file; do
        local msg_id="${file%%-*}"
        [[ "$msg_id" =~ ^[0-9]+$ ]] || continue
        (( msg_id > last_seen_id )) || continue
        emit_msg_json "$dir/messages/$file" 0 "$agent"
        if (( msg_id > last_seen_id )); then
          last_seen_id="$msg_id"
        fi
      done < <(find "$dir/messages" -maxdepth 1 -type f -name '*.msg' -printf '%f\n' | sort -n)
    fi
    sec=$((poll_ms / 1000))
    ms=$((poll_ms % 1000))
    sleep "${sec}.$(printf '%03d' "$ms")"
  done
}

cmd_end() {
  [[ $# -ge 1 ]] || die "end requires <sessionId>"
  local session_id="$1"
  shift
  local remove_messages=0 arg dir state_file tmp
  for arg in "$@"; do
    case "$arg" in
      --remove-messages) remove_messages=1 ;;
      *) die "unknown end option: $arg" ;;
    esac
  done
  dir="$(require_session "$session_id")"
  state_file="$dir/state.json"
  tmp="$(mktemp "${state_file}.XXXXXX")"
  sed -E 's/"status":"[^"]*"/"status":"ended"/' "$state_file" > "$tmp"
  mv "$tmp" "$state_file"
  if [[ "$remove_messages" -eq 1 && -d "$dir/messages" ]]; then
    find "$dir/messages" -maxdepth 1 -type f -name '*.msg' -delete
  fi
  printf '%s\n' "$dir"
}

[[ $# -ge 1 ]] || usage
subcommand="$1"
shift

case "$subcommand" in
  init) cmd_init "$@" ;;
  thread) cmd_thread "$@" ;;
  send) cmd_send "$@" ;;
  wait) cmd_wait "$@" ;;
  read) cmd_read "$@" ;;
  end) cmd_end "$@" ;;
  *) usage ;;
esac
