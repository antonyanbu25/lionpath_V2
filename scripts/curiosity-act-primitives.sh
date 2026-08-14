#!/usr/bin/env bash
# Sourced by curiosity-act.sh. Each function executes one AUTO_ACT primitive.

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${DB:-$HERMES_HOME/state.db}"
AGENT_RADIO="${AGENT_RADIO:-$HERMES_HOME/scripts/agent-radio.sh}"

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

json_get() {
  local payload="$1"
  local path="$2"
  PAYLOAD_JSON="$payload" python3 - "$path" <<'PY'
import json
import os
import sys

path = sys.argv[1].split(".")
try:
    value = json.loads(os.environ.get("PAYLOAD_JSON", ""))
    for key in path:
        if isinstance(value, dict):
            value = value.get(key, "")
        else:
            value = ""
            break
    if isinstance(value, (dict, list)):
        print(json.dumps(value, separators=(",", ":")))
    elif value is None:
        print("")
    else:
        print(value)
except Exception:
    print("")
PY
}

json_set_number() {
  local payload="$1"
  local key="$2"
  local value="$3"
  PAYLOAD_JSON="$payload" python3 - "$key" "$value" <<'PY'
import json
import os
import sys

key = sys.argv[1]
value = int(sys.argv[2])
try:
    data = json.loads(os.environ.get("PAYLOAD_JSON", ""))
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}
data[key] = value
print(json.dumps(data, separators=(",", ":")))
PY
}

table_has_column() {
  local db="$1"
  local table="$2"
  local column="$3"
  sqlite3 "$db" "SELECT COUNT(*) FROM pragma_table_info($(sql_quote "$table")) WHERE name=$(sql_quote "$column");" 2>/dev/null
}

action_target() {
  local db="$1"
  local aid="$2"
  sqlite3 "$db" "SELECT COALESCE(target, '') FROM curiosity_actions WHERE id=$aid;" 2>/dev/null
}

_log_action() {
  local db="$1" aid="$2" etype="$3" detail="$4"
  sqlite3 "$db" \
    "INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
     VALUES ($aid, $(sql_quote "$etype"), datetime('now'), $(sql_quote "$detail"));" >/dev/null
}

_set_status() {
  local db="$1" aid="$2" status="$3" outcome="$4"
  sqlite3 "$db" \
    "UPDATE curiosity_actions
     SET status=$(sql_quote "$status"), outcome=$(sql_quote "$outcome")
     WHERE id=$aid;" >/dev/null
}

_fail_action() {
  local db="$1" aid="$2" outcome="$3" detail="${4:-$3}"
  _set_status "$db" "$aid" "failed" "$outcome"
  _log_action "$db" "$aid" "failed" "$detail"
}

_done_action() {
  local db="$1" aid="$2" outcome="$3" detail="${4:-$3}"
  _set_status "$db" "$aid" "done" "$outcome"
  _log_action "$db" "$aid" "executed" "$detail"
}

insert_event() {
  local db="$1" topic="$2" payload="$3"
  local has_topic has_type has_emitted has_ts has_consumed
  has_topic="$(table_has_column "$db" gideon_events topic)"
  has_type="$(table_has_column "$db" gideon_events type)"
  has_emitted="$(table_has_column "$db" gideon_events emitted_at)"
  has_ts="$(table_has_column "$db" gideon_events ts)"
  has_consumed="$(table_has_column "$db" gideon_events consumed)"

  if [[ "$has_topic" -gt 0 ]]; then
    if [[ "$has_emitted" -gt 0 ]]; then
      sqlite3 "$db" \
        "INSERT INTO gideon_events(topic, payload, emitted_at)
         VALUES ($(sql_quote "$topic"), $(sql_quote "$payload"), datetime('now'));" >/dev/null
    else
      sqlite3 "$db" \
        "INSERT INTO gideon_events(topic, payload)
         VALUES ($(sql_quote "$topic"), $(sql_quote "$payload"));" >/dev/null
    fi
    return 0
  fi

  if [[ "$has_type" -gt 0 && "$has_ts" -gt 0 ]]; then
    if [[ "$has_consumed" -gt 0 ]]; then
      sqlite3 "$db" \
        "INSERT INTO gideon_events(ts, type, payload, consumed)
         VALUES (strftime('%s','now'), $(sql_quote "$topic"), $(sql_quote "$payload"), 0);" >/dev/null
    else
      sqlite3 "$db" \
        "INSERT INTO gideon_events(ts, type, payload)
         VALUES (strftime('%s','now'), $(sql_quote "$topic"), $(sql_quote "$payload"));" >/dev/null
    fi
    return 0
  fi

  return 1
}

latest_radio_session() {
  local radio_dir="$HERMES_HOME/agent-radio"
  [[ -d "$radio_dir" ]] || return 0
  find "$radio_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null \
    | sort -nr \
    | awk 'NR == 1 {print $2}'
}

first_radio_thread() {
  local session="$1"
  local state_file="$HERMES_HOME/agent-radio/$session/state.json"
  [[ -f "$state_file" ]] || return 0
  sed -n 's/.*"threads":\[{"id":"\([^"]*\)".*/\1/p' "$state_file" | head -1
}

radio_send_fyi() {
  local message="$1"
  local session thread
  [[ -x "$AGENT_RADIO" ]] || return 1
  session="$(latest_radio_session)"
  [[ -n "$session" ]] || return 1
  thread="$(first_radio_thread "$session")"
  thread="${thread:-curiosity}"
  "$AGENT_RADIO" send "$session" "$thread" FYI "$message" >/dev/null
}

act_memory_write() {
  local db="$1" aid="$2" payload="$3"
  local key value old_exists old_value
  key="$(json_get "$payload" key)"
  value="$(json_get "$payload" value)"

  if [[ -z "$key" ]]; then
    _fail_action "$db" "$aid" "missing_key" "memory_write requires payload.key"
    return 0
  fi

  if ! sqlite3 "$db" <<SQL
CREATE TABLE IF NOT EXISTS memory_value_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  replaced_at TEXT NOT NULL,
  action_id INTEGER
);
SQL
  then
    _fail_action "$db" "$aid" "history_create_failed" "could not create memory_value_history"
    return 0
  fi

  if ! old_exists="$(sqlite3 "$db" "SELECT COUNT(*) FROM memory WHERE key=$(sql_quote "$key");")"; then
    _fail_action "$db" "$aid" "memory_read_failed" "could not read memory row for $key"
    return 0
  fi
  if [[ "$old_exists" -gt 0 ]]; then
    if ! old_value="$(sqlite3 "$db" "SELECT value FROM memory WHERE key=$(sql_quote "$key") LIMIT 1;")"; then
      _fail_action "$db" "$aid" "memory_history_failed" "could not read old memory value for $key"
      return 0
    fi
    if ! sqlite3 "$db" \
      "INSERT INTO memory_value_history(key, old_value, replaced_at, action_id)
       VALUES ($(sql_quote "$key"), $(sql_quote "$old_value"), datetime('now'), $aid);" >/dev/null; then
      _fail_action "$db" "$aid" "memory_history_failed" "could not backup old memory value for $key"
      return 0
    fi
  fi

  if ! sqlite3 "$db" \
    "INSERT INTO memory(key, value, updated_at)
     VALUES ($(sql_quote "$key"), $(sql_quote "$value"), datetime('now'))
     ON CONFLICT(key) DO UPDATE
       SET value=excluded.value, updated_at=datetime('now');" >/dev/null; then
    _fail_action "$db" "$aid" "memory_write_failed" "could not upsert memory key $key"
    return 0
  fi

  _done_action "$db" "$aid" "success" "memory_write $key"
}

act_skill_patch() {
  local db="$1" aid="$2" payload="$3"
  local skill file target content search replace patch rel root resolved backup tmp
  skill="$(json_get "$payload" skill)"
  file="$(json_get "$payload" file)"
  content="$(json_get "$payload" content)"
  search="$(json_get "$payload" search)"
  replace="$(json_get "$payload" replace)"
  patch="$(json_get "$payload" patch)"
  target="$(json_get "$payload" target)"
  target="${target:-$(action_target "$db" "$aid")}"

  if [[ -n "$skill" && -n "$file" ]]; then
    rel="$skill/content/$file"
  elif [[ "$target" == "$HERMES_HOME/skills/"* ]]; then
    rel="${target#"$HERMES_HOME/skills/"}"
  else
    rel="$target"
  fi

  root="$(readlink -f "$HERMES_HOME/skills" 2>/dev/null || true)"
  resolved="$(readlink -f "$HERMES_HOME/skills/$rel" 2>/dev/null || true)"
  if [[ -z "$root" || -z "$resolved" || "$resolved" != "$root/"*"/content/"* || ! -f "$resolved" ]]; then
    _fail_action "$db" "$aid" "invalid_skill_file" "skill_patch target must be an existing file under $HERMES_HOME/skills/<skill>/content/"
    return 0
  fi

  backup="${resolved}.bak.$(date +%Y%m%d%H%M%S)"
  if ! cp "$resolved" "$backup"; then
    _fail_action "$db" "$aid" "backup_failed" "could not backup $resolved"
    return 0
  fi

  if [[ -n "$content" ]]; then
    if ! printf '%s' "$content" > "$resolved"; then
      mv "$backup" "$resolved" 2>/dev/null || true
      _fail_action "$db" "$aid" "write_failed" "could not write $resolved"
      return 0
    fi
  elif [[ -n "$search" ]]; then
    tmp="$(mktemp)"
    python3 - "$resolved" "$search" "$replace" > "$tmp" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
search = sys.argv[2]
replace = sys.argv[3]
text = path.read_text()
if search not in text:
    raise SystemExit(2)
sys.stdout.write(text.replace(search, replace, 1))
PY
    if [[ $? -ne 0 ]]; then
      mv "$backup" "$resolved"
      rm -f "$tmp"
      _fail_action "$db" "$aid" "search_not_found" "skill_patch search text not found"
      return 0
    fi
    if ! mv "$tmp" "$resolved"; then
      mv "$backup" "$resolved" 2>/dev/null || true
      _fail_action "$db" "$aid" "write_failed" "could not replace $resolved"
      return 0
    fi
  elif [[ -n "$patch" ]]; then
    if ! command -v patch >/dev/null 2>&1; then
      mv "$backup" "$resolved"
      _fail_action "$db" "$aid" "patch_unavailable" "patch command unavailable"
      return 0
    fi
    if ! printf '%s' "$patch" | patch "$resolved" >/dev/null 2>&1; then
      mv "$backup" "$resolved"
      _fail_action "$db" "$aid" "patch_failed" "skill_patch patch did not apply"
      return 0
    fi
  else
    mv "$backup" "$resolved"
    _fail_action "$db" "$aid" "missing_patch_content" "skill_patch requires content, search/replace, or patch"
    return 0
  fi

  _done_action "$db" "$aid" "success" "patched $resolved backup $backup"
}

act_goal_register() {
  local db="$1" aid="$2" payload="$3"
  local title description goal_id updated_payload
  title="$(json_get "$payload" title)"
  description="$(json_get "$payload" description)"
  [[ -n "$title" ]] || title="$(json_get "$payload" goal)"

  if [[ -z "$title" ]]; then
    _fail_action "$db" "$aid" "missing_title" "goal_register requires payload.title"
    return 0
  fi

  if ! sqlite3 "$db" \
    "INSERT INTO gideon_goals(title, description, source, status, created_at, last_progress_at)
     VALUES ($(sql_quote "$title"), $(sql_quote "$description"), 'curiosity', 'proposed', datetime('now'), datetime('now'));" >/dev/null; then
    _fail_action "$db" "$aid" "goal_insert_failed" "could not insert gideon_goals row"
    return 0
  fi
  if ! goal_id="$(sqlite3 "$db" "SELECT last_insert_rowid();")"; then
    _fail_action "$db" "$aid" "goal_id_failed" "could not read inserted goal id"
    return 0
  fi
  updated_payload="$(json_set_number "$payload" goal_id "$goal_id")"
  if ! sqlite3 "$db" \
    "UPDATE curiosity_actions SET payload=$(sql_quote "$updated_payload") WHERE id=$aid;" >/dev/null; then
    _fail_action "$db" "$aid" "payload_update_failed" "could not stash goal_id $goal_id"
    return 0
  fi

  _done_action "$db" "$aid" "success" "registered goal $goal_id"
}

act_radio_broadcast() {
  local db="$1" aid="$2" payload="$3"
  local requested_topic topic message event_payload outcome
  requested_topic="$(json_get "$payload" topic)"
  message="$(json_get "$payload" message)"
  [[ -n "$message" ]] || message="$(json_get "$payload" content)"
  topic="curiosity.act.broadcast"

  if [[ -n "$requested_topic" && "$requested_topic" != curiosity.* ]]; then
    _fail_action "$db" "$aid" "invalid_topic" "radio_broadcast topic must start with curiosity."
    return 0
  fi

  event_payload="$(
    TOPIC="$topic" REQUESTED_TOPIC="$requested_topic" MESSAGE="$message" ACTION_ID="$aid" python3 - <<'PY'
import json
import os

print(json.dumps({
    "topic": os.environ["TOPIC"],
    "requested_topic": os.environ["REQUESTED_TOPIC"],
    "message": os.environ["MESSAGE"],
    "action_id": int(os.environ["ACTION_ID"]),
}, separators=(",", ":")))
PY
  )"
  outcome="success"
  radio_send_fyi "[$topic] $message" || outcome="radio_unavailable"
  insert_event "$db" "$topic" "$event_payload" || {
    _fail_action "$db" "$aid" "event_insert_failed" "radio_broadcast could not write audit event"
    return 0
  }

  _done_action "$db" "$aid" "$outcome" "broadcast $topic"
}

act_event_emit() {
  local db="$1" aid="$2" payload="$3"
  local topic event_payload
  topic="$(json_get "$payload" topic)"
  event_payload="$(json_get "$payload" payload)"
  [[ -n "$topic" ]] || topic="curiosity.event"
  [[ -n "$event_payload" ]] || event_payload="{}"

  if [[ "$topic" != curiosity.* ]]; then
    _fail_action "$db" "$aid" "invalid_topic" "event_emit topic must start with curiosity."
    return 0
  fi

  if ! insert_event "$db" "$topic" "$event_payload"; then
    _fail_action "$db" "$aid" "event_insert_failed" "could not insert gideon_events row"
    return 0
  fi

  _done_action "$db" "$aid" "success" "emitted $topic"
}

act_delegate_task() {
  local db="$1" aid="$2" payload="$3"
  local task_spec task_id brief_id dispatch_payload outcome updated_payload
  task_spec="$(json_get "$payload" task_spec)"
  [[ -n "$task_spec" ]] || task_spec="$(json_get "$payload" task)"

  if [[ -z "$task_spec" ]]; then
    _fail_action "$db" "$aid" "missing_task_spec" "delegate_task requires payload.task_spec"
    return 0
  fi

  if ! sqlite3 "$db" <<'SQL'
CREATE TABLE IF NOT EXISTS curiosity_delegated_tasks (
  task_id TEXT PRIMARY KEY,
  brief_id TEXT,
  task_spec TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
SQL
  then
    _fail_action "$db" "$aid" "delegate_table_failed" "could not create curiosity_delegated_tasks"
    return 0
  fi

  task_id="curiosity-${aid}-$(date +%s)"
  if ! brief_id="$(sqlite3 "$db" "SELECT COALESCE(brief_id, '') FROM curiosity_actions WHERE id=$aid;")"; then
    _fail_action "$db" "$aid" "delegate_brief_failed" "could not read action brief_id"
    return 0
  fi
  if ! sqlite3 "$db" \
    "INSERT INTO curiosity_delegated_tasks(task_id, brief_id, task_spec, status, created_at, updated_at)
     VALUES ($(sql_quote "$task_id"), $(sql_quote "$brief_id"), $(sql_quote "$task_spec"), 'pending', datetime('now'), datetime('now'));" >/dev/null; then
    _fail_action "$db" "$aid" "delegate_insert_failed" "could not store delegated task $task_id"
    return 0
  fi

  dispatch_payload="$(
    TASK_ID="$task_id" ACTION_ID="$aid" TASK_SPEC="$task_spec" python3 - <<'PY'
import json
import os

try:
    task_spec = json.loads(os.environ["TASK_SPEC"])
except Exception:
    task_spec = os.environ["TASK_SPEC"]
print(json.dumps({
    "task_id": os.environ["TASK_ID"],
    "action_id": int(os.environ["ACTION_ID"]),
    "task_spec": task_spec,
}, separators=(",", ":")))
PY
  )"
  outcome="dispatched"
  radio_send_fyi "[curiosity.delegate_task] $dispatch_payload" || outcome="radio_unavailable"
  if ! sqlite3 "$db" \
    "UPDATE curiosity_delegated_tasks
     SET status=$(sql_quote "$outcome"), updated_at=datetime('now')
     WHERE task_id=$(sql_quote "$task_id");" >/dev/null; then
    _fail_action "$db" "$aid" "delegate_status_failed" "could not update delegated task $task_id"
    return 0
  fi

  updated_payload="$(PAYLOAD_JSON="$payload" python3 - "$task_id" <<'PY'
import json
import os
import sys

task_id = sys.argv[1]
try:
    data = json.loads(os.environ.get("PAYLOAD_JSON", ""))
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}
data["task_id"] = task_id
print(json.dumps(data, separators=(",", ":")))
PY
)"
  if ! sqlite3 "$db" \
    "UPDATE curiosity_actions SET payload=$(sql_quote "$updated_payload") WHERE id=$aid;" >/dev/null; then
    _fail_action "$db" "$aid" "payload_update_failed" "could not stash task_id $task_id"
    return 0
  fi

  _done_action "$db" "$aid" "$outcome" "delegated task $task_id"
}

# ---------------------------------------------------------------------------
# Goal-dispatcher primitives (dispatch_now, subagent_dispatch)
# ---------------------------------------------------------------------------

# Extract the goal_id from a payload JSON.  Falls back to reading it from
# the action's own payload (which may have been enriched by goal_register).
_dispatch_goal_id() {
  local db="$1" aid="$2" payload="$3"
  local goal_id

  goal_id="$(json_get "$payload" goal_id)"
  if [[ -z "$goal_id" ]]; then
    goal_id="$(json_get "$payload" goal)"
  fi
  if [[ -z "$goal_id" ]] && [[ -n "$aid" ]]; then
    # Try reading goal_id from the action payload (goal_register stashes it).
    local stored
    stored="$(sqlite3 -noheader "$db" \
      "SELECT COALESCE(payload,'') FROM curiosity_actions WHERE id=$aid;" 2>/dev/null || true)"
    if [[ -n "$stored" ]]; then
      goal_id="$(json_get "$stored" goal_id)"
      [[ -z "$goal_id" ]] && goal_id="$(json_get "$stored" goal)"
    fi
  fi
  printf '%s' "$goal_id"
}

# dispatch_now: immediately invoke goal-dispatcher.sh for a specific goal.
act_dispatch_now() {
  local db="$1" aid="$2" payload="$3"
  local goal_id

  goal_id="$(_dispatch_goal_id "$db" "$aid" "$payload")"

  if [[ -z "$goal_id" ]]; then
    _fail_action "$db" "$aid" "missing_goal_id" "dispatch_now requires payload.goal_id"
    return 0
  fi

  # Record a dispatch row (if the table exists from migration 003).
  sqlite3 "$db" \
    "INSERT INTO gideon_goal_dispatches(goal_id, agent, status, started_at)
     VALUES($goal_id, 'curiosity-act', 'pending', datetime('now'));" \
    >/dev/null 2>/dev/null || true

  # Invoke do_dispatch_now (defined in curiosity-act.sh's scope).
  # We call goal-dispatcher directly here so the function is self-contained.
  local dispatcher="${GOAL_DISPATCHER:-$HERMES_HOME/scripts/goal-dispatcher.sh}"
  local outcome="dispatched"
  local detail="dispatch_now goal_id=$goal_id"

  if [[ -x "$dispatcher" ]]; then
    "$dispatcher" --goal-id "$goal_id" || outcome="dispatch_failed"
  else
    outcome="dispatcher_missing"
    detail="$detail (goal-dispatcher not found at $dispatcher)"
  fi

  sqlite3 "$db" \
    "UPDATE gideon_goal_dispatches
     SET status=$(sql_quote "$outcome"), completed_at=datetime('now')
     WHERE goal_id=$goal_id AND agent='curiosity-act'
     ORDER BY id DESC LIMIT 1;" \
    >/dev/null 2>/dev/null || true

  if [[ "$outcome" == "dispatched" ]]; then
    _done_action "$db" "$aid" "$outcome" "$detail"
  else
    _fail_action "$db" "$aid" "$outcome" "$detail"
  fi
}

# subagent_dispatch: dispatch a goal to a subagent.
# This is an alias of dispatch_now with goal routing — it immediately
# invokes goal-dispatcher.sh for the specified goal_id.
act_subagent_dispatch() {
  local db="$1" aid="$2" payload="$3"
  local goal_id agent_name

  goal_id="$(_dispatch_goal_id "$db" "$aid" "$payload")"
  agent_name="$(json_get "$payload" agent)"
  [[ -n "$agent_name" ]] || agent_name="subagent"

  if [[ -z "$goal_id" ]]; then
    _fail_action "$db" "$aid" "missing_goal_id" "subagent_dispatch requires payload.goal_id"
    return 0
  fi

  # Record a dispatch row with the agent name.
  sqlite3 "$db" \
    "INSERT INTO gideon_goal_dispatches(goal_id, agent, status, started_at)
     VALUES($goal_id, $(sql_quote "$agent_name"), 'pending', datetime('now'));" \
    >/dev/null 2>/dev/null || true

  local dispatcher="${GOAL_DISPATCHER:-$HERMES_HOME/scripts/goal-dispatcher.sh}"
  local outcome="dispatched"
  local detail="subagent_dispatch goal_id=$goal_id agent=$agent_name"

  if [[ -x "$dispatcher" ]]; then
    "$dispatcher" --goal-id "$goal_id" || outcome="dispatch_failed"
  else
    outcome="dispatcher_missing"
    detail="$detail (goal-dispatcher not found at $dispatcher)"
  fi

  sqlite3 "$db" \
    "UPDATE gideon_goal_dispatches
     SET status=$(sql_quote "$outcome"), completed_at=datetime('now')
     WHERE goal_id=$goal_id AND agent=$(sql_quote "$agent_name")
     ORDER BY id DESC LIMIT 1;" \
    >/dev/null 2>/dev/null || true

  if [[ "$outcome" == "dispatched" ]]; then
    _done_action "$db" "$aid" "$outcome" "$detail"
  else
    _fail_action "$db" "$aid" "$outcome" "$detail"
  fi
}
