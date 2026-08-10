#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${GIDEON_DB:-${HERMES_DB:-$HERMES_HOME/state.db}}"
RADIO_MESH="${GIDEON_MESH:-${RADIO_MESH:-$HERMES_HOME/scripts/agent-radio-mesh.sh}}"
TASK_SESSION="${TASK_ROUTING_SESSION:-${GIDEON_TASK_SESSION:-task-routing}}"
HOST_ID="$(hostname -f 2>/dev/null || hostname)"
NODE_ID="${GIDEON_AGENT_ID:-${MESH_NODE_ID:-${USER:-unknown}@${HOST_ID}}}"
DEFAULT_TASK_TYPE="${TASK_ROUTING_DEFAULT_TYPE:-shell}"
DEFAULT_TIMEOUT="${TASK_ROUTING_TIMEOUT:-300}"
RUN_DIR="$HERMES_HOME/run/task-routing"
LOG_DIR="$HERMES_HOME/logs"

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  task-routing-protocol.sh --query <task_spec>
  task-routing-protocol.sh --offer <task_id>
  task-routing-protocol.sh --assign <task_id> <worker|best|auto>
  task-routing-protocol.sh --result <task_id> <exit_code> [output]
  task-routing-protocol.sh --status [task_id]
  task-routing-protocol.sh --list
  task-routing-protocol.sh --help

Environment:
  HERMES_HOME                 Defaults to ~/.hermes
  HERMES_DB or GIDEON_DB      Defaults to ~/.hermes/state.db
  RADIO_MESH or GIDEON_MESH   Defaults to ~/.hermes/scripts/agent-radio-mesh.sh
  TASK_ROUTING_SESSION        Defaults to task-routing
  TASK_ROUTING_TIMEOUT        Worker timeout in seconds, defaults to 300
  TASK_ROUTING_CAPABILITY     Optional offer capability label
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  :
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 jq setsid date hostname awk wc; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -x "$RADIO_MESH" ]] || { log ERROR "missing executable radio mesh script: $RADIO_MESH"; missing=1; }
  [[ "$DEFAULT_TIMEOUT" =~ ^[0-9]+$ && "$DEFAULT_TIMEOUT" -gt 0 ]] || { log ERROR "invalid TASK_ROUTING_TIMEOUT: $DEFAULT_TIMEOUT"; missing=1; }
  (( missing == 0 )) || exit 2
}

now() {
  date +%s
}

epoch_ms() {
  date +%s%3N
}

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

db() {
  sqlite3 "$DB_PATH" "$@"
}

init_db() {
  mkdir -p "$(dirname "$DB_PATH")" "$RUN_DIR" "$LOG_DIR"
  sqlite3 "$DB_PATH" >/dev/null <<'SQL'
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  status TEXT,
  origin_node TEXT,
  worker_node TEXT,
  task_type TEXT,
  spec TEXT,
  created_at INTEGER,
  assigned_at INTEGER,
  completed_at INTEGER,
  exit_code INTEGER,
  result TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
CREATE INDEX IF NOT EXISTS idx_task_queue_worker ON task_queue(worker_node);
CREATE TABLE IF NOT EXISTS task_offers (
  task_id TEXT NOT NULL,
  worker_node TEXT NOT NULL,
  capability TEXT,
  load REAL,
  offered_at INTEGER,
  PRIMARY KEY (task_id, worker_node)
);
SQL
}

ensure_mesh_session() {
  "$RADIO_MESH" init "$TASK_SESSION" >/dev/null 2>&1 || true
}

mesh_broadcast() {
  local type="$1"
  local payload="$2"
  ensure_mesh_session
  "$RADIO_MESH" broadcast "$TASK_SESSION" "$type" "$payload" >/dev/null
}

task_type_from_spec() {
  local spec="$1"
  local value=""
  if jq -e . >/dev/null 2>&1 <<<"$spec"; then
    value="$(jq -r '.task_type // .capability // .type // empty' <<<"$spec")"
  fi
  printf '%s' "${value:-$DEFAULT_TASK_TYPE}"
}

command_from_spec() {
  local spec="$1"
  local command=""
  if jq -e . >/dev/null 2>&1 <<<"$spec"; then
    command="$(jq -r '.command // .cmd // empty' <<<"$spec")"
  fi
  printf '%s' "${command:-$spec}"
}

task_timeout_from_spec() {
  local spec="$1"
  local timeout="$DEFAULT_TIMEOUT"
  if jq -e . >/dev/null 2>&1 <<<"$spec"; then
    timeout="$(jq -r '.timeout // empty' <<<"$spec")"
  fi
  [[ "$timeout" =~ ^[0-9]+$ && "$timeout" -gt 0 ]] || timeout="$DEFAULT_TIMEOUT"
  printf '%s' "$timeout"
}

generate_task_id() {
  local digest
  digest="$(printf '%s%s%s' "$NODE_ID" "$(epoch_ms)" "${1-}" | sha1sum | awk '{print substr($1,1,12)}')"
  printf 'task-%s-%s' "$(epoch_ms)" "$digest"
}

local_load() {
  local jobs load
  jobs="$(find "$RUN_DIR" -maxdepth 1 -type f -name '*.pid' 2>/dev/null | wc -l | awk '{print $1}')"
  load="$(awk -v jobs="$jobs" 'BEGIN { printf "%.2f", jobs / 10 }')"
  printf '%s' "$load"
}

query_task() {
  local spec="$1"
  local task_id task_type ts payload
  task_id="$(generate_task_id "$spec")"
  task_type="$(task_type_from_spec "$spec")"
  ts="$(now)"

  db "INSERT INTO task_queue(task_id,status,origin_node,worker_node,task_type,spec,created_at,assigned_at,completed_at,exit_code,result,error) VALUES($(sql_quote "$task_id"),'QUERY',$(sql_quote "$NODE_ID"),NULL,$(sql_quote "$task_type"),$(sql_quote "$spec"),$ts,NULL,NULL,NULL,NULL,NULL);"

  payload="$(jq -nc --arg type "QUERY" --arg task_id "$task_id" --arg origin "$NODE_ID" --arg task_type "$task_type" --arg spec "$spec" --arg message "I need help with $task_type task" --argjson timeout "$DEFAULT_TIMEOUT" '{type:$type,task_id:$task_id,origin_node:$origin,task_type:$task_type,spec:$spec,message:$message,timeout:$timeout,created_at:now|floor}')"
  mesh_broadcast TASK_QUERY "$payload"
  printf '%s\n' "$task_id"
}

offer_task() {
  local task_id="$1"
  local task_type spec capability load ts payload
  task_type="$(db "SELECT COALESCE(task_type,'$DEFAULT_TASK_TYPE') FROM task_queue WHERE task_id=$(sql_quote "$task_id");")"
  spec="$(db "SELECT COALESCE(spec,'') FROM task_queue WHERE task_id=$(sql_quote "$task_id");")"
  [[ -n "$task_type" ]] || task_type="${TASK_ROUTING_CAPABILITY:-$DEFAULT_TASK_TYPE}"
  capability="${TASK_ROUTING_CAPABILITY:-$task_type}"
  load="$(local_load)"
  ts="$(now)"

  db "INSERT INTO task_offers(task_id,worker_node,capability,load,offered_at) VALUES($(sql_quote "$task_id"),$(sql_quote "$NODE_ID"),$(sql_quote "$capability"),$load,$ts) ON CONFLICT(task_id,worker_node) DO UPDATE SET capability=excluded.capability,load=excluded.load,offered_at=excluded.offered_at;"
  db "UPDATE task_queue SET status='OFFERED' WHERE task_id=$(sql_quote "$task_id") AND status='QUERY';"

  payload="$(jq -nc --arg type "OFFER" --arg task_id "$task_id" --arg worker "$NODE_ID" --arg capability "$capability" --arg spec "$spec" --argjson load "$load" '{type:$type,task_id:$task_id,worker_node:$worker,capability:$capability,load:$load,spec:$spec,message:"I can do it",offered_at:now|floor}')"
  mesh_broadcast TASK_OFFER "$payload"
  printf '%s\n' "$payload"
}

best_offer() {
  local task_id="$1"
  db "SELECT worker_node FROM task_offers WHERE task_id=$(sql_quote "$task_id") ORDER BY load ASC, offered_at ASC LIMIT 1;"
}

assign_task() {
  local task_id="$1"
  local worker="$2"
  local selected spec task_type timeout ts payload
  if [[ "$worker" == "best" || "$worker" == "auto" ]]; then
    selected="$(best_offer "$task_id")"
    [[ -n "$selected" ]] || { log ERROR "no offers for task: $task_id"; exit 4; }
  else
    selected="$worker"
  fi

  spec="$(db "SELECT COALESCE(spec,'') FROM task_queue WHERE task_id=$(sql_quote "$task_id");")"
  [[ -n "$spec" ]] || { log ERROR "unknown task: $task_id"; exit 4; }
  task_type="$(task_type_from_spec "$spec")"
  timeout="$(task_timeout_from_spec "$spec")"
  ts="$(now)"

  db "UPDATE task_queue SET status='ASSIGNED',worker_node=$(sql_quote "$selected"),task_type=$(sql_quote "$task_type"),assigned_at=$ts,error=NULL WHERE task_id=$(sql_quote "$task_id") AND status IN ('QUERY','OFFERED','ASSIGNED');"

  payload="$(jq -nc --arg type "ASSIGN" --arg task_id "$task_id" --arg origin "$NODE_ID" --arg worker "$selected" --arg task_type "$task_type" --arg spec "$spec" --argjson timeout "$timeout" '{type:$type,task_id:$task_id,origin_node:$origin,worker_node:$worker,task_type:$task_type,spec:$spec,timeout:$timeout,assigned_at:now|floor}')"
  mesh_broadcast TASK_ASSIGN "$payload"
  if [[ "$selected" == "$NODE_ID" ]]; then
    spawn_worker "$task_id" "$spec" "$timeout"
  fi
  printf '%s\n' "$payload"
}

record_result() {
  local task_id="$1"
  local exit_code="$2"
  local output="${3:-}"
  local ts status result error duration_ms payload
  [[ "$exit_code" =~ ^-?[0-9]+$ ]] || { log ERROR "exit code must be numeric: $exit_code"; exit 1; }
  ts="$(now)"
  status="DONE"
  (( exit_code == 0 )) || status="FAILED"

  if jq -e . >/dev/null 2>&1 <<<"$output"; then
    result="$(jq -r 'if type == "object" and has("stdout") then .stdout elif type == "object" and has("result") then .result else tostring end' <<<"$output")"
    error="$(jq -r 'if type == "object" then (.stderr // .error // empty) else empty end' <<<"$output")"
    duration_ms="$(jq -r 'if type == "object" then (.duration_ms // empty) else empty end' <<<"$output")"
  else
    result="$output"
    error=""
    duration_ms=""
  fi
  [[ "$duration_ms" =~ ^[0-9]+$ ]] || duration_ms=0

  db "INSERT INTO task_queue(task_id,status,origin_node,worker_node,task_type,spec,created_at,assigned_at,completed_at,exit_code,result,error) VALUES($(sql_quote "$task_id"),$(sql_quote "$status"),NULL,$(sql_quote "$NODE_ID"),NULL,NULL,$ts,NULL,$ts,$exit_code,$(sql_quote "$result"),$(sql_quote "$error")) ON CONFLICT(task_id) DO UPDATE SET status=excluded.status,worker_node=COALESCE(task_queue.worker_node,excluded.worker_node),completed_at=excluded.completed_at,exit_code=excluded.exit_code,result=excluded.result,error=excluded.error;"
  payload="$(jq -nc --arg type "RESULT" --arg task_id "$task_id" --arg worker "$NODE_ID" --arg status "$status" --arg stdout "$result" --arg stderr "$error" --argjson exit_code "$exit_code" --argjson duration_ms "$duration_ms" '{type:$type,task_id:$task_id,worker_node:$worker,status:$status,exit_code:$exit_code,stdout:$stdout,stderr:$stderr,duration_ms:$duration_ms,result:$stdout,error:$stderr,completed_at:now|floor}')"
  mesh_broadcast TASK_RESULT "$payload"
  printf '%s\n' "$payload"
}

spawn_worker() {
  local task_id="$1"
  local spec="$2"
  local timeout="$3"
  local safe_task log_file pid_file
  safe_task="$(printf '%s' "$task_id" | tr -c 'A-Za-z0-9_.-' '_')"
  log_file="$LOG_DIR/task-routing-$safe_task.log"
  pid_file="$RUN_DIR/$safe_task.pid"

  db "INSERT INTO task_queue(task_id,status,origin_node,worker_node,task_type,spec,created_at,assigned_at,completed_at,exit_code,result,error) VALUES($(sql_quote "$task_id"),'RUNNING',NULL,$(sql_quote "$NODE_ID"),$(sql_quote "$(task_type_from_spec "$spec")"),$(sql_quote "$spec"),$(now),$(now),NULL,NULL,NULL,NULL) ON CONFLICT(task_id) DO UPDATE SET status='RUNNING',worker_node=excluded.worker_node,task_type=COALESCE(task_queue.task_type,excluded.task_type),spec=COALESCE(task_queue.spec,excluded.spec),assigned_at=COALESCE(task_queue.assigned_at,excluded.assigned_at);"
  setsid "$0" __run-worker "$task_id" "$timeout" "$spec" >>"$log_file" 2>&1 < /dev/null &
  printf '%s\n' "$!" > "$pid_file"
  log INFO "worker started: task_id=$task_id pid=$(<"$pid_file") timeout=${timeout}s"
}

run_worker() {
  local task_id="$1"
  local timeout="$2"
  local spec="$3"
  local command start end duration stdout_file stderr_file result_json exit_code=0 safe_task
  safe_task="$(printf '%s' "$task_id" | tr -c 'A-Za-z0-9_.-' '_')"
  stdout_file="$(mktemp "$RUN_DIR/$safe_task.stdout.XXXXXX")"
  stderr_file="$(mktemp "$RUN_DIR/$safe_task.stderr.XXXXXX")"
  command="$(command_from_spec "$spec")"
  start="$(epoch_ms)"

  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout" bash -lc "$command" >"$stdout_file" 2>"$stderr_file" || exit_code=$?
  else
    bash -lc "$command" >"$stdout_file" 2>"$stderr_file" || exit_code=$?
  fi

  end="$(epoch_ms)"
  duration=$(( end - start ))
  result_json="$(jq -Rs --rawfile stderr "$stderr_file" --argjson duration_ms "$duration" '{stdout:.,stderr:$stderr,duration_ms:$duration_ms}' < "$stdout_file")"
  record_result "$task_id" "$exit_code" "$result_json" >/dev/null
  rm -f "$stdout_file" "$stderr_file" "$RUN_DIR/$safe_task.pid"
}

status_task() {
  local task_id="${1:-}"
  if [[ -n "$task_id" ]]; then
    sqlite3 -header -column "$DB_PATH" "SELECT task_id,status,origin_node,worker_node,task_type,created_at,assigned_at,completed_at,exit_code,result,error FROM task_queue WHERE task_id=$(sql_quote "$task_id");"
  else
    sqlite3 -header -column "$DB_PATH" "SELECT status,COUNT(*) AS count FROM task_queue GROUP BY status ORDER BY status;"
  fi
}

list_tasks() {
  sqlite3 -header -column "$DB_PATH" "SELECT task_id,status,origin_node,worker_node,task_type,created_at,completed_at,exit_code FROM task_queue ORDER BY created_at DESC, task_id DESC;"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    --query)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      shift
      query_task "$*"
      ;;
    --offer)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      offer_task "$2"
      ;;
    --assign)
      [[ $# -eq 3 ]] || { usage; exit 1; }
      assign_task "$2" "$3"
      ;;
    --result)
      [[ $# -ge 3 ]] || { usage; exit 1; }
      record_result "$2" "$3" "${4:-}"
      ;;
    --status)
      [[ $# -le 2 ]] || { usage; exit 1; }
      status_task "${2:-}"
      ;;
    --list)
      [[ $# -eq 1 ]] || { usage; exit 1; }
      list_tasks
      ;;
    --help|-h|help)
      usage
      ;;
    __run-worker)
      [[ $# -eq 4 ]] || exit 1
      run_worker "$2" "$3" "$4"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

check_prereqs
init_db
main "$@"
