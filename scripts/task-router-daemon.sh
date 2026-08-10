#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${HERMES_DB:-$HERMES_HOME/state.db}"
AGENT_ID="${GIDEON_AGENT_ID:-${MESH_NODE_ID:-${USER:-hermes}@$(hostname -f 2>/dev/null || hostname)}}"
INTERVAL="${TASK_ROUTER_INTERVAL:-3}"
MAX_CONCURRENT_TASKS="${MAX_CONCURRENT_TASKS:-3}"
LOAD_THRESHOLD="${LOAD_THRESHOLD:-80}"
PREFERRED_TASK_TYPES="${PREFERRED_TASK_TYPES:-}"
CONFIG_FILE="$HERMES_HOME/config/task-router.conf"
PID_FILE="$HERMES_HOME/run/task-router-daemon.pid"
LOCK_FILE="$HERMES_HOME/run/task-router-daemon.lock"
LAST_CYCLE_FILE="$HERMES_HOME/run/task-router-daemon.last-cycle"
LOG_FILE="$HERMES_HOME/logs/task-router.log"
TASK_LOG_DIR="$HERMES_HOME/logs/task-router-tasks"
RADIO_MESH="${RADIO_MESH:-$HERMES_HOME/scripts/agent-radio-mesh.sh}"
MESH_SESSION="${TASK_ROUTER_SESSION:-task-router}"
STOPPING=0

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  task-router-daemon.sh start [--config <key=value> ...]
  task-router-daemon.sh stop
  task-router-daemon.sh status
  task-router-daemon.sh --config <key=value> ...
  task-router-daemon.sh --help

Config keys:
  MAX_CONCURRENT_TASKS       Default: 3
  LOAD_THRESHOLD             Percent of CPU capacity, default: 80
  PREFERRED_TASK_TYPES       Comma-separated capabilities; empty means any
  TASK_ROUTER_INTERVAL       Poll interval seconds, default: 3

Environment:
  HERMES_HOME                Defaults to ~/.hermes
  HERMES_DB                  Defaults to ~/.hermes/state.db
  GIDEON_AGENT_ID            Defaults to MESH_NODE_ID or user@hostname
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  if [[ "${1:-}" == "daemon" ]]; then
    rm -f "$PID_FILE"
  fi
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

is_pid_alive() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1
}

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

now() {
  date +%s
}

load_config_file() {
  [[ -f "$CONFIG_FILE" ]] || return 0
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
}

validate_config() {
  [[ "$INTERVAL" =~ ^[0-9]+$ && "$INTERVAL" -gt 0 ]] || { log ERROR "invalid TASK_ROUTER_INTERVAL: $INTERVAL"; exit 1; }
  [[ "$MAX_CONCURRENT_TASKS" =~ ^[0-9]+$ && "$MAX_CONCURRENT_TASKS" -gt 0 ]] || { log ERROR "invalid MAX_CONCURRENT_TASKS: $MAX_CONCURRENT_TASKS"; exit 1; }
  [[ "$LOAD_THRESHOLD" =~ ^[0-9]+$ && "$LOAD_THRESHOLD" -gt 0 && "$LOAD_THRESHOLD" -le 100 ]] || { log ERROR "invalid LOAD_THRESHOLD: $LOAD_THRESHOLD"; exit 1; }
}

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 flock awk setsid jq nproc date; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  (( missing == 0 )) || exit 2
}

write_config_pair() {
  local pair="$1" key value tmp
  [[ "$pair" == *=* ]] || { log ERROR "--config requires key=value, got: $pair"; exit 1; }
  key="${pair%%=*}"
  value="${pair#*=}"
  case "$key" in
    MAX_CONCURRENT_TASKS|LOAD_THRESHOLD|PREFERRED_TASK_TYPES|TASK_ROUTER_INTERVAL) ;;
    *) log ERROR "unsupported config key: $key"; exit 1 ;;
  esac
  mkdir -p "$(dirname "$CONFIG_FILE")"
  touch "$CONFIG_FILE"
  tmp="$(mktemp "${CONFIG_FILE}.XXXXXX")"
  awk -F= -v key="$key" '$1 != key { print }' "$CONFIG_FILE" > "$tmp"
  printf '%s=%q\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$CONFIG_FILE"
  log INFO "configured $key"
}

parse_start_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --config)
        [[ $# -ge 2 ]] || { log ERROR "--config requires key=value"; exit 1; }
        write_config_pair "$2"
        shift 2
        ;;
      *)
        log ERROR "unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
  load_config_file
  INTERVAL="${TASK_ROUTER_INTERVAL:-$INTERVAL}"
  validate_config
}

db() {
  sqlite3 "$DB_PATH" "$@"
}

init_db() {
  mkdir -p "$(dirname "$DB_PATH")"
  sqlite3 "$DB_PATH" <<'SQL'
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  originator TEXT NOT NULL,
  assignee TEXT,
  payload TEXT NOT NULL,
  capability TEXT,
  state TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  chunk_seq INTEGER,
  chunk_total INTEGER,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deadline INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tq_state ON task_queue(state);
CREATE INDEX IF NOT EXISTS idx_tq_parent ON task_queue(parent_task_id);
CREATE TABLE IF NOT EXISTS task_offers (
  offer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  capacity REAL NOT NULL,
  eta_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE(task_id, agent_id)
);
SQL
}

current_load_percent() {
  local one_min cpus
  one_min="$(awk '{print $1}' /proc/loadavg)"
  cpus="$(nproc)"
  awk -v load="$one_min" -v cpus="$cpus" 'BEGIN { if (cpus < 1) cpus=1; printf "%.0f", (load / cpus) * 100 }'
}

running_task_count() {
  db "SELECT COUNT(*) FROM task_queue WHERE state='RUNNING' AND assignee=$(sql_quote "$AGENT_ID");"
}

capability_preferred() {
  local capability="${1:-}"
  [[ -z "$PREFERRED_TASK_TYPES" ]] && return 0
  [[ -n "$capability" ]] || return 1
  local item
  IFS=',' read -r -a preferred_items <<< "$PREFERRED_TASK_TYPES"
  for item in "${preferred_items[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [[ "$item" == "$capability" ]] && return 0
  done
  return 1
}

required_tools_available() {
  local payload="$1" tool
  jq -e . >/dev/null 2>&1 <<< "$payload" || return 0
  while IFS= read -r tool; do
    [[ -n "$tool" && "$tool" != "null" ]] || continue
    if ! command -v "$tool" >/dev/null 2>&1; then
      log INFO "reject missing_tool=$tool"
      return 1
    fi
  done < <(jq -r '(.required_tools // .tools // [])[]?' <<< "$payload")
  return 0
}

capacity_fraction() {
  local running load_pct free_slots load_room
  running="$(running_task_count)"
  load_pct="$(current_load_percent)"
  free_slots=$(( MAX_CONCURRENT_TASKS - running ))
  load_room=$(( LOAD_THRESHOLD - load_pct ))
  if (( free_slots <= 0 || load_room <= 0 )); then
    printf '0'
    return 0
  fi
  awk -v slots="$free_slots" -v max="$MAX_CONCURRENT_TASKS" -v room="$load_room" -v threshold="$LOAD_THRESHOLD" 'BEGIN {
    by_slots = slots / max
    by_load = room / threshold
    cap = by_slots < by_load ? by_slots : by_load
    if (cap < 0) cap = 0
    if (cap > 1) cap = 1
    printf "%.2f", cap
  }'
}

local_can_handle() {
  local capability="$1" payload="$2" running load_pct
  running="$(running_task_count)"
  load_pct="$(current_load_percent)"
  if (( running >= MAX_CONCURRENT_TASKS )); then
    log INFO "reject capability=$capability reason=max_concurrent running=$running limit=$MAX_CONCURRENT_TASKS"
    return 1
  fi
  if (( load_pct >= LOAD_THRESHOLD )); then
    log INFO "reject capability=$capability reason=load load_percent=$load_pct threshold=$LOAD_THRESHOLD"
    return 1
  fi
  if ! capability_preferred "$capability"; then
    log INFO "reject capability=$capability reason=not_preferred preferred=$PREFERRED_TASK_TYPES"
    return 1
  fi
  if ! required_tools_available "$payload"; then
    log INFO "reject capability=$capability reason=missing_required_tools"
    return 1
  fi
  return 0
}

offer_task() {
  local task_id="$1" capability="$2" payload="$3" ts capacity eta offer_id offer_payload
  ts="$(now)"
  capacity="$(capacity_fraction)"
  eta="$(awk -v c="$capacity" 'BEGIN { if (c <= 0) print 60000; else printf "%.0f", 1000 / c }')"
  offer_id="${task_id}#offer#${AGENT_ID}"
  offer_payload="$(jq -nc --arg task_id "$task_id" --arg agent_id "$AGENT_ID" --argjson capacity "$capacity" --argjson eta_ms "$eta" '{type:"OFFER", task_id:$task_id, agent_id:$agent_id, capacity:$capacity, eta_ms:$eta_ms}')"
  db "PRAGMA journal_mode=WAL; INSERT OR REPLACE INTO task_offers(task_id,agent_id,capacity,eta_ms,received_at) VALUES($(sql_quote "$task_id"),$(sql_quote "$AGENT_ID"),$capacity,$eta,$ts);"
  db "PRAGMA journal_mode=WAL; INSERT OR REPLACE INTO task_queue(task_id,parent_task_id,originator,assignee,payload,capability,state,priority,created_at,updated_at) VALUES($(sql_quote "$offer_id"),$(sql_quote "$task_id"),$(sql_quote "$AGENT_ID"),$(sql_quote "$AGENT_ID"),$(sql_quote "$offer_payload"),$(sql_quote "$capability"),'OFFERED',5,$ts,$ts);"
  log INFO "offer task_id=$task_id capability=$capability capacity=$capacity eta_ms=$eta"
}

watch_queries() {
  local task_id capability payload originator
  while IFS=$'\t' read -r task_id capability payload originator || [[ -n "${task_id:-}" ]]; do
    [[ -n "${task_id:-}" ]] || continue
    if [[ "$originator" == "$AGENT_ID" ]]; then
      log INFO "skip own query task_id=$task_id capability=$capability"
      continue
    fi
    if db "SELECT 1 FROM task_offers WHERE task_id=$(sql_quote "$task_id") AND agent_id=$(sql_quote "$AGENT_ID") LIMIT 1;" | grep -q '^1$'; then
      continue
    fi
    if local_can_handle "$capability" "$payload"; then
      offer_task "$task_id" "$capability" "$payload"
    fi
  done < <(db -separator $'\t' "SELECT task_id, COALESCE(capability,''), payload, originator FROM task_queue WHERE state='QUERY';")
}

extract_task_command() {
  local payload="$1" command
  if jq -e . >/dev/null 2>&1 <<< "$payload"; then
    command="$(jq -r '.script // .script_path // .command // .cmd // empty' <<< "$payload")"
    [[ -n "$command" ]] && { printf '%s' "$command"; return 0; }
  fi
  printf '%s' "$payload"
}

mark_result() {
  local task_id="$1" status="$2" result="$3" ts
  ts="$(now)"
  db "PRAGMA journal_mode=WAL; UPDATE task_queue SET state='RESULT', result=$(sql_quote "$result"), updated_at=$ts WHERE task_id=$(sql_quote "$task_id") AND assignee=$(sql_quote "$AGENT_ID");"
  log INFO "result task_id=$task_id status=$status"
}

run_task_worker() {
  local task_id="$1" payload="$2" command task_log status result start_ts end_ts exit_code
  trap - ERR
  command="$(extract_task_command "$payload")"
  task_log="$TASK_LOG_DIR/${task_id//[^A-Za-z0-9_.-]/_}.log"
  start_ts="$(now)"
  log INFO "worker start task_id=$task_id command=$command"
  if bash -lc "$command" >"$task_log" 2>&1; then
    exit_code=0
    status="OK"
  else
    exit_code="$?"
    status="FAILED"
  fi
  end_ts="$(now)"
  result="$(jq -Rs --arg status "$status" --argjson exit_code "$exit_code" --arg task_log "$task_log" --argjson started_at "$start_ts" --argjson finished_at "$end_ts" '{status:$status, exit_code:$exit_code, log:$task_log, started_at:$started_at, finished_at:$finished_at, output:.}' < "$task_log")"
  mark_result "$task_id" "$status" "$result"
}

start_assigned_tasks() {
  local task_id capability payload ts
  while IFS=$'\t' read -r task_id capability payload || [[ -n "${task_id:-}" ]]; do
    [[ -n "${task_id:-}" ]] || continue
    if ! local_can_handle "$capability" "$payload"; then
      continue
    fi
    ts="$(now)"
    db "PRAGMA journal_mode=WAL; UPDATE task_queue SET state='RUNNING', updated_at=$ts WHERE task_id=$(sql_quote "$task_id") AND assignee=$(sql_quote "$AGENT_ID") AND state='ASSIGNED';"
    if [[ "$(db "SELECT state FROM task_queue WHERE task_id=$(sql_quote "$task_id");")" != "RUNNING" ]]; then
      continue
    fi
    mkdir -p "$TASK_LOG_DIR"
    setsid "$0" __worker "$task_id" "$payload" >/dev/null 2>&1 &
    log INFO "assigned task started task_id=$task_id worker_pid=$!"
  done < <(db -separator $'\t' "SELECT task_id, COALESCE(capability,''), payload FROM task_queue WHERE state='ASSIGNED' AND assignee=$(sql_quote "$AGENT_ID") ORDER BY priority DESC, created_at ASC;")
}

handle_signal() {
  STOPPING=1
  log INFO "received termination signal, shutting down"
}

daemon_loop() {
  trap handle_signal TERM INT
  log INFO "daemon started pid=$$ interval=$INTERVAL db=$DB_PATH agent_id=$AGENT_ID max_concurrent=$MAX_CONCURRENT_TASKS load_threshold=$LOAD_THRESHOLD preferred=${PREFERRED_TASK_TYPES:-any}"
  while (( STOPPING == 0 )); do
    date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_CYCLE_FILE"
    watch_queries
    start_assigned_tasks
    local i
    for ((i=0; i<INTERVAL && STOPPING == 0; i++)); do
      sleep 1
    done
  done
  cleanup daemon
  log INFO "daemon stopped"
}

run_daemon() {
  parse_start_flags "$@"
  check_prereqs
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$TASK_LOG_DIR"
  init_db
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    local pid="unknown"
    [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || printf unknown)"
    printf 'already running (pid %s)\n' "$pid" >&2
    exit 7
  fi
  printf '%s\n' "$$" > "$PID_FILE"
  exec >>"$LOG_FILE" 2>&1
  daemon_loop
}

start_daemon() {
  parse_start_flags "$@"
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
  if [[ -f "$PID_FILE" ]] && is_pid_alive "$(cat "$PID_FILE" 2>/dev/null || true)"; then
    printf 'already running (pid %s)\n' "$(cat "$PID_FILE")" >&2
    exit 7
  fi
  "$0" __run >/dev/null 2>&1 &
  local child="$!"
  local i
  for ((i=0; i<20; i++)); do
    if [[ -f "$PID_FILE" ]] && is_pid_alive "$(cat "$PID_FILE" 2>/dev/null || true)"; then
      printf 'started (pid %s)\n' "$(cat "$PID_FILE")"
      return 0
    fi
    if ! is_pid_alive "$child"; then
      printf 'failed to start; see %s\n' "$LOG_FILE" >&2
      exit 1
    fi
    sleep 0.1
  done
  printf 'start pending (pid %s)\n' "$child"
}

stop_daemon() {
  local pid i
  if [[ ! -f "$PID_FILE" ]]; then
    printf 'not running\n'
    return 0
  fi
  pid="$(cat "$PID_FILE")"
  if ! is_pid_alive "$pid"; then
    rm -f "$PID_FILE"
    printf 'not running (removed stale pid)\n'
    return 0
  fi
  kill -TERM "$pid"
  for ((i=0; i<5; i++)); do
    if ! is_pid_alive "$pid"; then
      rm -f "$PID_FILE"
      printf 'stopped\n'
      return 0
    fi
    sleep 1
  done
  printf 'still running (pid %s)\n' "$pid" >&2
  exit 1
}

status_daemon() {
  local pid last="never" running load_pct
  [[ -f "$LAST_CYCLE_FILE" ]] && last="$(cat "$LAST_CYCLE_FILE")"
  running="$(running_task_count 2>/dev/null || printf 0)"
  load_pct="$(current_load_percent 2>/dev/null || printf unknown)"
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if is_pid_alive "$pid"; then
      printf 'status: running\npid: %s\nagent_id: %s\nrunning_tasks: %s\nload_percent: %s\nlast_cycle: %s\nlog: %s\n' "$pid" "$AGENT_ID" "$running" "$load_pct" "$last" "$LOG_FILE"
      return 0
    fi
    printf 'status: stale\npid: %s\nlast_cycle: %s\n' "$pid" "$last"
    return 1
  fi
  printf 'status: stopped\nagent_id: %s\nrunning_tasks: %s\nload_percent: %s\nlast_cycle: %s\nlog: %s\n' "$AGENT_ID" "$running" "$load_pct" "$last" "$LOG_FILE"
}

main() {
  local cmd="${1:-start}"
  case "$cmd" in
    start)
      shift || true
      start_daemon "$@"
      ;;
    __run)
      shift || true
      run_daemon "$@"
      ;;
    __worker)
      shift || true
      [[ $# -eq 2 ]] || exit 1
      load_config_file
      check_prereqs
      init_db
      mkdir -p "$TASK_LOG_DIR"
      run_task_worker "$1" "$2"
      ;;
    stop)
      shift || true
      stop_daemon "$@"
      ;;
    status)
      shift || true
      load_config_file
      status_daemon "$@"
      ;;
    --config)
      shift || true
      [[ $# -ge 1 ]] || { log ERROR "--config requires key=value"; exit 1; }
      while [[ $# -gt 0 ]]; do
        write_config_pair "$1"
        shift
      done
      ;;
    --help|-h|help)
      usage
      ;;
    *)
      log ERROR "unknown subcommand: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
