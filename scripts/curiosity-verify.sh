#!/usr/bin/env bash
set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${DB:-$HERMES_HOME/state.db}"
BRIEF_ID=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  curiosity-verify.sh --brief-id <id>

Environment:
  HERMES_HOME  Defaults to /root/.hermes
  DB           Defaults to $HERMES_HOME/state.db
USAGE
  exit 1
}

log() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
}

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

json_quote() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${1-}"
}

json_field() {
  local payload="${1-}"
  local field="$2"
  python3 -c '
import json, sys
try:
    data = json.loads(sys.argv[1] or "{}")
except Exception:
    data = {}
value = data.get(sys.argv[2], "")
if value is None:
    value = ""
print(value)
' "$payload" "$field"
}

json_payload() {
  python3 - "$@" <<'PY'
import json
import sys

items = {}
for arg in sys.argv[1:]:
    key, _, value = arg.partition("=")
    if value == "true":
        items[key] = True
    elif value == "false":
        items[key] = False
    elif value.isdigit():
        items[key] = int(value)
    else:
        items[key] = value
print(json.dumps(items, separators=(",", ":")))
PY
}

decode_b64() {
  python3 -c 'import base64,sys; print(base64.b64decode(sys.argv[1]).decode())' "${1-}"
}

sqlite_scalar() {
  local sql="$1"
  sqlite3 -noheader "$DB" "$sql"
}

table_exists() {
  local table="$1"
  local count
  count="$(sqlite_scalar "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=$(sql_quote "$table");" 2>/dev/null)" || return 1
  [[ "${count:-0}" -gt 0 ]]
}

column_exists() {
  local table="$1"
  local column="$2"
  local count
  count="$(sqlite_scalar "SELECT count(*) FROM pragma_table_info($(sql_quote "$table")) WHERE name=$(sql_quote "$column");" 2>/dev/null)" || return 1
  [[ "${count:-0}" -gt 0 ]]
}

update_verification() {
  local action_id="$1"
  local outcome="$2"
  local verification_payload="$3"

  sqlite3 "$DB" \
    "UPDATE curiosity_actions
        SET verified_at = datetime('now'),
            outcome = $(sql_quote "$outcome"),
            verification_payload = $(sql_quote "$verification_payload")
      WHERE id = $action_id;"
  sqlite3 "$DB" \
    "INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
     VALUES ($action_id, 'verified', datetime('now'), $(sql_quote "$outcome"));"
}

verify_memory_write() {
  local target="$1"
  local payload="$2"
  local key count

  key="$(json_field "$payload" key)"
  [[ -n "$key" ]] || key="$target"
  if [[ -z "$key" ]]; then
    OUTCOME="failure"
    VERIFY_JSON="$(json_payload primitive=memory_write error=missing_key)"
    return
  fi

  count="$(sqlite_scalar "SELECT count(*) FROM memory WHERE key = $(sql_quote "$key");")"
  [[ "${count:-0}" -gt 0 ]] && OUTCOME="success" || OUTCOME="failure"
  VERIFY_JSON="$(json_payload primitive=memory_write key="$key" rows="${count:-0}")"
}

verify_skill_patch() {
  local target="$1"
  local payload="$2"
  local path exists

  path="$(json_field "$payload" path)"
  [[ -n "$path" ]] || path="$(json_field "$payload" file)"
  [[ -n "$path" ]] || path="$target"

  if [[ -n "$path" && -f "$path" ]]; then
    OUTCOME="success"
    exists="true"
  else
    OUTCOME="failure"
    exists="false"
  fi
  VERIFY_JSON="$(json_payload primitive=skill_patch path="$path" exists="$exists")"
}

verify_goal_register() {
  local target="$1"
  local payload="$2"
  local goal_id goal_text count goal_col

  goal_id="$(json_field "$payload" goal_id)"
  if [[ "$goal_id" =~ ^[0-9]+$ ]]; then
    count="$(sqlite_scalar "SELECT count(*) FROM gideon_goals WHERE id = $goal_id;")"
    [[ "${count:-0}" -gt 0 ]] && OUTCOME="success" || OUTCOME="failure"
    VERIFY_JSON="$(json_payload primitive=goal_register goal_id="$goal_id" rows="${count:-0}")"
    return
  fi

  goal_text="$(json_field "$payload" goal)"
  [[ -n "$goal_text" ]] || goal_text="$(json_field "$payload" title)"
  [[ -n "$goal_text" ]] || goal_text="$target"
  if column_exists gideon_goals goal; then
    goal_col="goal"
  elif column_exists gideon_goals title; then
    goal_col="title"
  else
    OUTCOME="failure"
    VERIFY_JSON="$(json_payload primitive=goal_register error=missing_goal_column)"
    return
  fi

  count="$(sqlite_scalar "SELECT count(*) FROM gideon_goals WHERE $goal_col = $(sql_quote "$goal_text");")"
  [[ "${count:-0}" -gt 0 ]] && OUTCOME="success" || OUTCOME="failure"
  VERIFY_JSON="$(json_payload primitive=goal_register goal="$goal_text" column="$goal_col" rows="${count:-0}")"
}

verify_radio_broadcast() {
  local target="$1"
  local payload="$2"
  local event_col count filter

  if column_exists gideon_events topic; then
    event_col="topic"
  elif column_exists gideon_events type; then
    event_col="type"
  else
    OUTCOME="pending"
    VERIFY_JSON="$(json_payload primitive=radio_broadcast error=missing_event_column)"
    return
  fi

  filter="$event_col LIKE 'curiosity.%'"
  if [[ -n "$BRIEF_ID" ]]; then
    filter="$filter AND (payload LIKE $(sql_quote "%$BRIEF_ID%")"
    if [[ -n "$target" ]]; then
      filter="$filter OR payload LIKE $(sql_quote "%$target%") OR $event_col = $(sql_quote "$target")"
    fi
    filter="$filter)"
  fi

  count="$(sqlite_scalar "SELECT count(*) FROM gideon_events WHERE $filter;")"
  [[ "${count:-0}" -gt 0 ]] && OUTCOME="success" || OUTCOME="pending"
  VERIFY_JSON="$(json_payload primitive=radio_broadcast event_column="$event_col" rows="${count:-0}" target="$target")"
}

verify_delegate_task() {
  local target="$1"
  local payload="$2"
  local task_id status

  task_id="$(json_field "$payload" task_id)"
  [[ -n "$task_id" ]] || task_id="$target"
  if [[ -z "$task_id" ]]; then
    OUTCOME="pending"
    VERIFY_JSON="$(json_payload primitive=delegate_task error=missing_task_id)"
    return
  fi

  status="$(sqlite_scalar "SELECT COALESCE(status, '') FROM curiosity_delegated_tasks WHERE task_id = $(sql_quote "$task_id") LIMIT 1;")"
  case "$status" in
    accepted|running|done) OUTCOME="success" ;;
    *) OUTCOME="pending" ;;
  esac
  VERIFY_JSON="$(json_payload primitive=delegate_task task_id="$task_id" status="$status")"
}

verify_action() {
  local action_id="$1"
  local primitive="$2"
  local target="$3"
  local payload="$4"

  OUTCOME="unknown"
  VERIFY_JSON="{}"

  case "$primitive" in
    memory_write) verify_memory_write "$target" "$payload" ;;
    skill_patch) verify_skill_patch "$target" "$payload" ;;
    goal_register) verify_goal_register "$target" "$payload" ;;
    radio_broadcast) verify_radio_broadcast "$target" "$payload" ;;
    event_emit)
      OUTCOME="success"
      VERIFY_JSON="$(json_payload primitive=event_emit)"
      ;;
    delegate_task) verify_delegate_task "$target" "$payload" ;;
    *)
      OUTCOME="unknown_primitive"
      VERIFY_JSON="$(json_payload primitive="$primitive")"
      ;;
  esac

  update_verification "$action_id" "$OUTCOME" "$VERIFY_JSON"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief-id)
      [[ $# -ge 2 ]] || usage
      BRIEF_ID="$2"
      shift 2
      ;;
    --db)
      [[ $# -ge 2 ]] || usage
      DB="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      log "unknown argument: $1"
      usage
      ;;
  esac
done

[[ -n "$BRIEF_ID" ]] || usage

if ! command -v sqlite3 >/dev/null 2>&1; then
  log "sqlite3 is required"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  log "python3 is required"
  exit 1
fi

if [[ ! -f "$DB" ]]; then
  log "database not found: $DB"
  exit 0
fi

if ! table_exists curiosity_actions; then
  log "curiosity_actions table not found"
  exit 0
fi

if ! table_exists curiosity_action_log; then
  log "curiosity_action_log table not found"
  exit 0
fi

while IFS=$'\t' read -r action_id primitive_b64 target_b64 payload_b64; do
  [[ -n "${action_id:-}" ]] || continue
  primitive="$(decode_b64 "$primitive_b64")"
  target="$(decode_b64 "$target_b64")"
  payload="$(decode_b64 "$payload_b64")"
  if ! verify_action "$action_id" "${primitive:-}" "${target:-}" "${payload:-}"; then
    log "verification failed for action $action_id"
  fi
done < <(
  sqlite3 -json "$DB" \
    "SELECT id,
            COALESCE(primitive, '') AS primitive,
            COALESCE(target, '') AS target,
            COALESCE(payload, '{}') AS payload
       FROM curiosity_actions
      WHERE brief_id = $(sql_quote "$BRIEF_ID")
        AND status = 'done'
      ORDER BY id;" 2> >(while read -r line; do log "$line"; done) |
    python3 -c '
import base64
import json
import sys

try:
    rows = json.load(sys.stdin)
except Exception as exc:
    print(f"failed to parse action rows: {exc}", file=sys.stderr)
    sys.exit(0)

def enc(value):
    if value is None:
        value = ""
    return base64.b64encode(str(value).encode()).decode()

for row in rows:
    print("\t".join([
        str(row.get("id", "")),
        enc(row.get("primitive", "")),
        enc(row.get("target", "")),
        enc(row.get("payload", "{}")),
    ]))
'
)
