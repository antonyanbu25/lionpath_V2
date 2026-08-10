#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${CONSCIOUSNESS_DB:-$HERMES_HOME/state.db}"
REMOTE_DB_PATH="${CONSCIOUSNESS_REMOTE_DB:-$HERMES_HOME/state.db}"
RADIO_MESH="${CONSCIOUSNESS_RADIO_MESH:-$HERMES_HOME/scripts/agent-radio-mesh.sh}"
RADIO_SESSION="${MESH_RADIO_SESSION:-mesh}"
DISCOVERED_NODES="$HERMES_HOME/config/discovered-nodes.json"
MESH_NODES_CONF="$HERMES_HOME/config/mesh-nodes.conf"
SKILLS_DIR="${HERMES_SKILLS_DIR:-$HERMES_HOME/skills}"
CRON_DIR="${HERMES_CRON_DIR:-$HERMES_HOME/cron}"
NODE_HOST="${MESH_NODE_ID:-${USER}@$(hostname -f 2>/dev/null || hostname)}"
ACTION=""
VIEW_NODE=""
LOCK_FD=9
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  consciousness-propagation-hooks.sh --produce [--db <path>]
  consciousness-propagation-hooks.sh --broadcast [--db <path>]
  consciousness-propagation-hooks.sh --sync [--db <path>] [--remote-db <path>]
  consciousness-propagation-hooks.sh --view [node] [--db <path>]
  consciousness-propagation-hooks.sh --digest [--db <path>]
  consciousness-propagation-hooks.sh --help

Environment:
  HERMES_HOME                 Defaults to ~/.hermes
  HERMES_SKILLS_DIR           Defaults to ~/.hermes/skills
  HERMES_CRON_DIR             Defaults to ~/.hermes/cron
  MESH_NODE_ID                Defaults to user@hostname
  MESH_RADIO_SESSION          Defaults to mesh
  MESH_REMOTE_LOCAL           Set to 1 to force local execution for peer pulls
  CONSCIOUSNESS_DB            Defaults to ~/.hermes/state.db
  CONSCIOUSNESS_REMOTE_DB     Defaults to ~/.hermes/state.db
  CONSCIOUSNESS_RADIO_MESH    Defaults to ~/.hermes/scripts/agent-radio-mesh.sh
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

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

json_string() {
  jq -Rs .
}

sha256_text() {
  sha256sum | awk '{print $1}'
}

now() {
  date +%s
}

trim_ws() {
  local s="${1:-}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 jq sha256sum awk sed sort hostname flock base64; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  (( missing == 0 )) || exit 2
}

ensure_schema() {
  mkdir -p "$(dirname "$DB_PATH")"
  local columns legacy_name
  columns="$(sqlite3 "$DB_PATH" "SELECT group_concat(name,' ') FROM pragma_table_info('mesh_consciousness');" 2>/dev/null || true)"
  if [[ -n "$columns" && "$columns" != *"node_host"* ]]; then
    legacy_name="mesh_consciousness_legacy_$(date +%s)"
    sqlite3 "$DB_PATH" "ALTER TABLE mesh_consciousness RENAME TO $legacy_name;" >/dev/null
    log WARN "renamed incompatible mesh_consciousness table to $legacy_name"
  fi
  sqlite3 "$DB_PATH" >/dev/null <<'SQL'
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS mesh_consciousness (
  node_host TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  state_digest TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
SQL
}

db() {
  sqlite3 "$DB_PATH" "$1"
}

is_local_node() {
  local node="${1:-}"
  local host="${node#*@}"
  local short fqdn
  short="$(hostname 2>/dev/null || true)"
  fqdn="$(hostname -f 2>/dev/null || true)"
  [[ "${MESH_REMOTE_LOCAL:-0}" == "1" || "$node" == "localhost" || "$node" == "127.0.0.1" || "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "$short" || "$host" == "$fqdn" || "$node" == "$NODE_HOST" ]]
}

remote_sql() {
  local node="$1"
  local sql="$2"
  if is_local_node "$node"; then
    sqlite3 "$REMOTE_DB_PATH" "$sql"
  else
    ssh "${SSH_OPTS[@]}" "$node" "sqlite3 $(printf '%q' "$REMOTE_DB_PATH") $(printf '%q' "$sql")"
  fi
}

load_known_nodes() {
  local node
  {
    printf '%s\n' "localhost"
    if [[ -x "$RADIO_MESH" ]]; then
      "$RADIO_MESH" participants "$RADIO_SESSION" 2>/dev/null || true
    fi
    if [[ -f "$DISCOVERED_NODES" ]]; then
      jq -r '
        def rows:
          if type == "array" then .
          else (.nodes // .known_nodes // .discovered // .items // [])
          end;
        rows[]?
        | select((.reachable // true) != false)
        | if (.ssh_target // .target // .node // .node_host // empty) != "" then
            (.ssh_target // .target // .node // .node_host)
          elif (.ssh_user // .user // empty) != "" and (.ip // .host // .hostname // empty) != "" then
            ((.ssh_user // .user) + "@" + (.ip // .host // .hostname))
          else
            (.host // .hostname // .ip // empty)
          end
      ' "$DISCOVERED_NODES" 2>/dev/null || true
    fi
    if [[ -f "$MESH_NODES_CONF" ]]; then
      while IFS= read -r node || [[ -n "$node" ]]; do
        node="${node%%#*}"
        node="$(trim_ws "$node")"
        [[ -n "$node" ]] && printf '%s\n' "$node"
      done < "$MESH_NODES_CONF"
    fi
  } | awk 'NF && !seen[$0]++'
}

memory_digest() {
  if sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory';" | grep -qx 1; then
    sqlite3 -readonly "$DB_PATH" "SELECT quote(key) || '=' || quote(value) || ':' || COALESCE(updated_at,0) || ':' || COALESCE(origin_node,'') FROM memory ORDER BY key;" 2>/dev/null | sha256_text
  else
    printf '' | sha256_text
  fi
}

skills_digest() {
  if [[ -d "$SKILLS_DIR" ]]; then
    find "$SKILLS_DIR" -type f -printf '%P\t%s\t%T@\n' 2>/dev/null | sort | sha256_text
  else
    printf '' | sha256_text
  fi
}

cron_jobs_json() {
  {
    crontab -l 2>/dev/null | sed '/^[[:space:]]*#/d;/^[[:space:]]*$/d' || true
    if [[ -d "$CRON_DIR" ]]; then
      find "$CRON_DIR" -maxdepth 2 -type f -print 2>/dev/null | sort | while IFS= read -r file; do
        printf '@file %s\n' "$file"
      done
    fi
  } | jq -Rsc 'split("\n") | map(select(length > 0))'
}

active_tasks_count() {
  if sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_queue';" | grep -qx 1; then
    sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM task_queue WHERE state NOT IN ('DONE','FAILED');" 2>/dev/null || printf '0\n'
  else
    printf '0\n'
  fi
}

load_average_json() {
  if [[ -r /proc/loadavg ]]; then
    awk '{printf "[%s,%s,%s]\n", $1, $2, $3}' /proc/loadavg
  else
    printf '[0,0,0]\n'
  fi
}

uptime_seconds() {
  if [[ -r /proc/uptime ]]; then
    awk '{printf "%d\n", $1}' /proc/uptime
  else
    printf '0\n'
  fi
}

has_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 || [[ -e /dev/nvidia0 ]]
}

cp_state_digest() {
  jq -cS . | sha256_text
}

cp_produce_state() {
  ensure_schema
  local mem_digest skill_digest cron_json tasks load_json uptime state digest ts
  mem_digest="$(memory_digest)"
  skill_digest="$(skills_digest)"
  cron_json="$(cron_jobs_json)"
  tasks="$(active_tasks_count)"
  load_json="$(load_average_json)"
  uptime="$(uptime_seconds)"
  state="$(jq -nc \
    --arg memory_digest "$mem_digest" \
    --arg skills_digest "$skill_digest" \
    --argjson cron_jobs "$cron_json" \
    --argjson has_docker "$(command -v docker >/dev/null 2>&1 && printf true || printf false)" \
    --argjson has_gpu "$(has_gpu && printf true || printf false)" \
    --argjson has_codex "$(command -v codex >/dev/null 2>&1 && printf true || printf false)" \
    --argjson uptime_seconds "$uptime" \
    --argjson active_tasks "$tasks" \
    --argjson load_average "$load_json" \
    '{memory_digest:$memory_digest,skills_digest:$skills_digest,cron_jobs:$cron_jobs,node_capabilities:{has_docker:$has_docker,has_gpu:$has_gpu,has_codex:$has_codex,uptime_seconds:$uptime_seconds},active_tasks:$active_tasks,load_average:$load_average}')"
  digest="$(printf '%s' "$state" | cp_state_digest)"
  ts="$(now)"
  cp_store_state "$NODE_HOST" "$state" "$digest" "$ts"
  printf '%s\n' "$state"
}

cp_store_state() {
  local node="$1"
  local state="$2"
  local digest="$3"
  local ts="${4:-$(now)}"
  sqlite3 "$DB_PATH" "PRAGMA journal_mode=WAL; INSERT INTO mesh_consciousness(node_host,state_json,state_digest,updated_at) VALUES($(sql_quote "$node"),$(sql_quote "$state"),$(sql_quote "$digest"),$ts) ON CONFLICT(node_host) DO UPDATE SET state_json=excluded.state_json,state_digest=excluded.state_digest,updated_at=excluded.updated_at WHERE excluded.updated_at >= mesh_consciousness.updated_at;" >/dev/null
}

cp_broadcast_state() {
  ensure_schema
  [[ -x "$RADIO_MESH" ]] || { log ERROR "missing executable: $RADIO_MESH"; exit 2; }
  local state digest ts message
  state="$(cp_produce_state)"
  digest="$(printf '%s' "$state" | cp_state_digest)"
  ts="$(now)"
  message="$(jq -nc --arg type CONSCIOUSNESS_STATE --arg node_host "$NODE_HOST" --argjson state "$state" --arg state_digest "$digest" --argjson updated_at "$ts" '{type:$type,node_host:$node_host,state_json:$state,state_digest:$state_digest,updated_at:$updated_at}')"
  "$RADIO_MESH" broadcast "$RADIO_SESSION" STATUS "$message" >/dev/null
  log INFO "broadcast consciousness state digest=$digest"
}

cp_ingest_message() {
  local message="$1"
  local type node state digest ts
  type="$(jq -r '.type // empty' <<<"$message")"
  [[ "$type" == "CONSCIOUSNESS_STATE" ]] || return 0
  node="$(jq -r '.node_host // empty' <<<"$message")"
  state="$(jq -c '.state_json' <<<"$message")"
  digest="$(jq -r '.state_digest // empty' <<<"$message")"
  ts="$(jq -r '.updated_at // 0' <<<"$message")"
  [[ -n "$node" && "$state" != "null" && -n "$digest" && "$ts" =~ ^[0-9]+$ ]] || return 1
  [[ "$(printf '%s' "$state" | cp_state_digest)" == "$digest" ]] || { log WARN "ignored bad consciousness digest from $node"; return 0; }
  cp_store_state "$node" "$state" "$digest" "$ts"
}

cp_ingest_radio_ledger() {
  local ledger="$HERMES_HOME/agent-radio/$RADIO_SESSION/mesh.ledger"
  local line _ts _origin _type encoded message
  [[ -f "$ledger" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" && "${line:0:1}" != "#" ]] || continue
    IFS=$'\t' read -r _ts _origin _type encoded <<<"$line"
    [[ -n "${encoded:-}" ]] || continue
    message="$(printf '%s' "$encoded" | base64 -d 2>/dev/null || true)"
    [[ -n "$message" ]] || continue
    jq -e . >/dev/null 2>&1 <<<"$message" || continue
    cp_ingest_message "$message" || true
  done < "$ledger"
}

cp_pull_node() {
  local node="$1"
  local sql rows row node_host state digest updated_at
  sql="SELECT json_object('node_host',node_host,'state_json',json(state_json),'state_digest',state_digest,'updated_at',updated_at) FROM mesh_consciousness;"
  rows="$(remote_sql "$node" "$sql" 2>/dev/null || true)"
  [[ -n "$rows" ]] || return 0
  while IFS= read -r row || [[ -n "$row" ]]; do
    [[ -n "$row" ]] || continue
    node_host="$(jq -r '.node_host // empty' <<<"$row")"
    state="$(jq -c '.state_json' <<<"$row")"
    digest="$(jq -r '.state_digest // empty' <<<"$row")"
    updated_at="$(jq -r '.updated_at // 0' <<<"$row")"
    [[ -n "$node_host" && "$state" != "null" && -n "$digest" && "$updated_at" =~ ^[0-9]+$ ]] || continue
    if [[ "$(printf '%s' "$state" | cp_state_digest)" == "$digest" ]]; then
      cp_store_state "$node_host" "$state" "$digest" "$updated_at"
    else
      log WARN "ignored bad consciousness digest from $node_host via $node"
    fi
  done <<<"$rows"
}

cp_sync() {
  ensure_schema
  cp_produce_state >/dev/null
  cp_ingest_radio_ledger
  local node
  while IFS= read -r node || [[ -n "$node" ]]; do
    [[ -n "$node" ]] || continue
    cp_pull_node "$node" || log WARN "pull failed: $node"
  done < <(load_known_nodes)
}

cp_view() {
  ensure_schema
  local node="${1:-}"
  if [[ -n "$node" ]]; then
    sqlite3 "$DB_PATH" "SELECT json_set(state_json,'$.node_host',node_host,'$.state_digest',state_digest,'$.updated_at',updated_at) FROM mesh_consciousness WHERE node_host=$(sql_quote "$node");" | jq .
  else
    sqlite3 "$DB_PATH" "SELECT json_group_array(json_set(state_json,'$.node_host',node_host,'$.state_digest',state_digest,'$.updated_at',updated_at)) FROM mesh_consciousness ORDER BY node_host;" | jq .
  fi
}

cp_mesh_digest() {
  ensure_schema
  sqlite3 "$DB_PATH" "SELECT node_host || char(9) || state_digest || char(9) || updated_at FROM mesh_consciousness ORDER BY node_host;" | sha256_text
}

cp_hook_on_memory_sync() {
  cp_broadcast_state
}

cp_hook_on_event() {
  local event="${1:-}"
  case "$event" in
    memory_sync|memory_changed|task_assigned|task_done|task_failed|idle|shutdown)
      cp_broadcast_state
      ;;
    *)
      cp_produce_state >/dev/null
      ;;
  esac
}

parse_args() {
  [[ $# -gt 0 ]] || { usage; exit 1; }
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --produce|--broadcast|--sync|--digest)
        ACTION="$1"
        shift
        ;;
      --view)
        ACTION="$1"
        if [[ $# -ge 2 && "${2:0:1}" != "-" ]]; then
          VIEW_NODE="$2"
          shift 2
        else
          shift
        fi
        ;;
      --db)
        [[ $# -ge 2 ]] || { log ERROR "--db requires a value"; exit 1; }
        DB_PATH="$2"
        shift 2
        ;;
      --remote-db)
        [[ $# -ge 2 ]] || { log ERROR "--remote-db requires a value"; exit 1; }
        REMOTE_DB_PATH="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        log ERROR "unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  check_prereqs
  mkdir -p "$(dirname "$DB_PATH")"
  exec {LOCK_FD}>"$DB_PATH.consciousness.lock"
  flock -w 10 "$LOCK_FD"
  case "$ACTION" in
    --produce)
      cp_produce_state
      ;;
    --broadcast)
      cp_broadcast_state
      ;;
    --sync)
      cp_sync
      ;;
    --view)
      cp_view "$VIEW_NODE"
      ;;
    --digest)
      cp_mesh_digest
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
