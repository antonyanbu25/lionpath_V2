#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB="${HERMES_DB:-$HERMES_HOME/state.db}"
LOCK="$HERMES_HOME/run/scale-test.lock"
LOG="$HERMES_HOME/logs/scale-test.log"
RESULT_TIMEOUT="${RESULT_TIMEOUT:-120}"
SSH_TIMEOUT="${SSH_TIMEOUT:-8}"
RESULTS_ROOT="$HERMES_HOME/state/scale-test"
RUN_ID=""
RESULTS_DIR=""

log() {
  local level="$1"
  shift
  mkdir -p "$(dirname "$LOG")"
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" | tee -a "$LOG" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  scale-test.sh --run <primes|sha256|fib|sleep>
  scale-test.sh --status [run_id]
  scale-test.sh --nodes
  scale-test.sh --help

Environment:
  HERMES_HOME      Defaults to ~/.hermes
  HERMES_DB        Defaults to ~/.hermes/state.db
  RESULT_TIMEOUT  Seconds to wait for node results, defaults to 120
  SSH_TIMEOUT     SSH connect timeout in seconds, defaults to 8
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

trap 'err_handler "$LINENO" "$?"' ERR

check_prereqs() {
  local missing=0 bin
  for bin in bash sqlite3 flock ssh sha256sum awk sort date hostname; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ "$RESULT_TIMEOUT" =~ ^[0-9]+$ && "$RESULT_TIMEOUT" -gt 0 ]] || { log ERROR "invalid RESULT_TIMEOUT: $RESULT_TIMEOUT"; missing=1; }
  [[ "$SSH_TIMEOUT" =~ ^[0-9]+$ && "$SSH_TIMEOUT" -gt 0 ]] || { log ERROR "invalid SSH_TIMEOUT: $SSH_TIMEOUT"; missing=1; }
  (( missing == 0 )) || exit 2
}

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
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

now_ms() {
  local value
  value="$(date +%s%3N)"
  if [[ "$value" == *%3N ]]; then
    printf '%s000\n' "$(date +%s)"
  else
    printf '%s\n' "$value"
  fi
}

new_run_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    printf 'run-%s-%s\n' "$(date +%s)" "$$"
  fi
}

local_node_id() {
  if [[ -r "$HERMES_HOME/state/node.uuid" ]]; then
    head -n 1 "$HERMES_HOME/state/node.uuid"
  else
    printf 'local-%s\n' "$(hostname 2>/dev/null || printf localhost)"
  fi
}

init_db() {
  mkdir -p "$(dirname "$DB")" "$RESULTS_ROOT" "$HERMES_HOME/run" "$HERMES_HOME/logs"
  sqlite3 "$DB" "PRAGMA journal_mode=WAL;" >/dev/null
  sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS mesh_scale_runs (
  run_id TEXT PRIMARY KEY,
  workload TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  nodes_total INTEGER,
  nodes_online INTEGER,
  nodes_offline INTEGER,
  total_work_units INTEGER,
  avg_duration_ms INTEGER,
  fastest_node TEXT,
  slowest_node TEXT
);
CREATE TABLE IF NOT EXISTS mesh_scale_results (
  run_id TEXT NOT NULL,
  node_uuid TEXT NOT NULL,
  node_host TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  rc INTEGER,
  duration_ms INTEGER,
  work_units INTEGER DEFAULT 0,
  output TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (run_id, node_uuid),
  FOREIGN KEY (run_id) REFERENCES mesh_scale_runs(run_id)
);
SQL
}

workload_primes() {
  cat <<'SNIPPET'
n=100000
declare -a composite
for ((i=2; i*i<=n; i++)); do
  if [[ -z "${composite[$i]:-}" ]]; then
    for ((j=i*i; j<=n; j+=i)); do
      composite[$j]=1
    done
  fi
done
count=0
for ((i=2; i<=n; i++)); do
  [[ -z "${composite[$i]:-}" ]] && ((count++))
done
printf 'work_units=%d\nprimes=%d\n' "$count" "$count"
SNIPPET
}

workload_sha256() {
  cat <<'SNIPPET'
count=0
if compgen -G '/usr/bin/*.sh' >/dev/null; then
  for f in /usr/bin/*.sh; do
    [[ -f "$f" ]] || continue
    while IFS= read -r _line; do
      ((count++))
    done < <(sha256sum "$f")
  done
fi
printf 'work_units=%d\nlines=%d\n' "$count" "$count"
SNIPPET
}

workload_fib() {
  cat <<'SNIPPET'
a=0
b=1
for ((i=0; i<35; i++)); do
  next=$((a + b))
  a=$b
  b=$next
done
printf 'work_units=1\nfib35=%d\n' "$a"
SNIPPET
}

workload_sleep() {
  cat <<'SNIPPET'
sleep 2
printf 'work_units=1\nsleep=2\n'
SNIPPET
}

workload_select() {
  case "${1:-}" in
    primes) workload_primes ;;
    sha256) workload_sha256 ;;
    fib) workload_fib ;;
    sleep) workload_sleep ;;
    *) return 1 ;;
  esac
}

get_all_nodes() {
  printf '%s|localhost|local\n' "$(local_node_id)"
  if sqlite3 "$DB" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesh_spawned_nodes';" | grep -q 1; then
    sqlite3 -separator '|' "$DB" \
      "SELECT uuid, host, 'spawned' FROM mesh_spawned_nodes WHERE status='online' ORDER BY uuid;" || true
  fi
  if sqlite3 "$DB" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesh_peers';" | grep -q 1; then
    sqlite3 -separator '|' "$DB" \
      "SELECT peer_id, lead_host, 'peer' FROM mesh_peers WHERE status='active' ORDER BY peer_id;" || true
  fi
}

extract_work_units() {
  local output="$1" units
  units="$(awk -F= '$1 == "work_units" && $2 ~ /^[0-9]+$/ { print $2; exit }' <<<"$output")"
  printf '%s\n' "${units:-0}"
}

write_result_file() {
  local node_uuid="$1" host="$2" kind="$3" status="$4" rc="$5" duration_ms="$6" work_units="$7" output="$8" error="$9"
  local out="$RESULTS_DIR/$node_uuid.tsv"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$node_uuid" "$host" "$kind" "$status" "$rc" "$duration_ms" "$work_units" \
    "$(printf '%s' "$output" | tr '\t\r\n' '   ')" \
    "$(printf '%s' "$error" | tr '\t\r\n' '   ')" > "$out"
}

dispatch_to_node() {
  local node_uuid="$1" host="$2" kind="$3" snippet="$4"
  local t0 t1 rc output status work_units duration
  t0="$(now_ms)"
  if [[ "$kind" == "local" || "$host" == "localhost" ]]; then
    set +e
    output="$(eval "$snippet" 2>&1)"
    rc=$?
    set -e
  else
    set +e
    output="$(ssh -o BatchMode=yes -o ConnectTimeout="$SSH_TIMEOUT" "$host" "bash -s" <<<"$snippet" 2>&1)"
    rc=$?
    set -e
  fi
  t1="$(now_ms)"
  duration=$(( t1 - t0 ))
  (( duration < 0 )) && duration=0
  if (( rc == 0 )); then
    status="online"
    work_units="$(extract_work_units "$output")"
    write_result_file "$node_uuid" "$host" "$kind" "$status" "$rc" "$duration" "$work_units" "$output" ""
  else
    status="offline"
    write_result_file "$node_uuid" "$host" "$kind" "$status" "$rc" "$duration" 0 "" "$output"
  fi
}

wait_for_dispatches() {
  local deadline="$1"
  shift
  local pids=("$@") alive pid
  while ((${#pids[@]} > 0)); do
    alive=()
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        alive+=("$pid")
      else
        wait "$pid" || true
      fi
    done
    pids=("${alive[@]}")
    ((${#pids[@]} == 0)) && break
    if (( $(date +%s) >= deadline )); then
      for pid in "${pids[@]}"; do
        kill "$pid" >/dev/null 2>&1 || true
      done
      sleep 1
      for pid in "${pids[@]}"; do
        kill -9 "$pid" >/dev/null 2>&1 || true
        wait "$pid" 2>/dev/null || true
      done
      return 124
    fi
    sleep 1
  done
}

insert_result_row() {
  local node_uuid="$1" host="$2" kind="$3" status="$4" rc="$5" duration_ms="$6" work_units="$7" output="$8" error="$9"
  sqlite3 "$DB" <<SQL
INSERT OR REPLACE INTO mesh_scale_results
  (run_id,node_uuid,node_host,node_kind,status,rc,duration_ms,work_units,output,error,started_at,finished_at)
VALUES
  ($(sql_quote "$RUN_ID"),$(sql_quote "$node_uuid"),$(sql_quote "$host"),$(sql_quote "$kind"),$(sql_quote "$status"),
   $rc,$duration_ms,$work_units,$(sql_quote "$output"),$(sql_quote "$error"),datetime('now'),datetime('now'));
SQL
}

collect_results() {
  local known="$1" node_uuid host kind status rc duration_ms work_units output error
  while IFS='|' read -r node_uuid host kind; do
    [[ -n "$node_uuid" ]] || continue
    if [[ -r "$RESULTS_DIR/$node_uuid.tsv" ]]; then
      IFS=$'\t' read -r node_uuid host kind status rc duration_ms work_units output error < "$RESULTS_DIR/$node_uuid.tsv"
      insert_result_row "$node_uuid" "$host" "$kind" "$status" "$rc" "$duration_ms" "$work_units" "$output" "$error"
    else
      insert_result_row "$node_uuid" "$host" "$kind" "offline" 124 "$(( RESULT_TIMEOUT * 1000 ))" 0 "" "result timeout"
    fi
  done < "$known"
}

compute_metrics() {
  local metrics total online offline total_units avg fastest slowest
  metrics="$(sqlite3 -separator '|' "$DB" <<SQL
WITH base AS (
  SELECT *
  FROM mesh_scale_results
  WHERE run_id = $(sql_quote "$RUN_ID")
),
online AS (
  SELECT *
  FROM base
  WHERE status = 'online' AND rc = 0
)
SELECT
  (SELECT COUNT(*) FROM base),
  (SELECT COUNT(*) FROM online),
  (SELECT COUNT(*) FROM base WHERE NOT (status = 'online' AND rc = 0)),
  COALESCE((SELECT SUM(work_units) FROM online), 0),
  COALESCE((SELECT CAST(AVG(duration_ms) AS INTEGER) FROM online), 0),
  COALESCE((SELECT node_uuid FROM online ORDER BY duration_ms ASC, node_uuid ASC LIMIT 1), ''),
  COALESCE((SELECT node_uuid FROM online ORDER BY duration_ms DESC, node_uuid ASC LIMIT 1), '');
SQL
)"
  IFS='|' read -r total online offline total_units avg fastest slowest <<<"$metrics"
  sqlite3 "$DB" <<SQL
UPDATE mesh_scale_runs
SET finished_at = datetime('now'),
    nodes_total = $total,
    nodes_online = $online,
    nodes_offline = $offline,
    total_work_units = $total_units,
    avg_duration_ms = $avg,
    fastest_node = $(sql_quote "$fastest"),
    slowest_node = $(sql_quote "$slowest")
WHERE run_id = $(sql_quote "$RUN_ID");
SQL
  printf 'run_id=%s\nnodes_total=%s\nnodes_online=%s\nnodes_offline=%s\ntotal_work_units=%s\navg_duration_ms=%s\nfastest_node=%s\nslowest_node=%s\n' \
    "$RUN_ID" "$total" "$online" "$offline" "$total_units" "$avg" "$fastest" "$slowest"
  (( online > 0 ))
}

run_workload() {
  local workload="$1" snippet nodes_file pids=() node_uuid host kind deadline rc=0
  snippet="$(workload_select "$workload")" || { log ERROR "unknown workload: $workload"; return 1; }
  RUN_ID="$(new_run_id)"
  RESULTS_DIR="$RESULTS_ROOT/$RUN_ID"
  mkdir -p "$RESULTS_DIR"
  nodes_file="$RESULTS_DIR/nodes.tsv"
  get_all_nodes | sort -t '|' -k1,1 -u > "$nodes_file"
  sqlite3 "$DB" <<SQL
INSERT INTO mesh_scale_runs (run_id, workload, started_at)
VALUES ($(sql_quote "$RUN_ID"), $(sql_quote "$workload"), datetime('now'));
SQL
  while IFS='|' read -r node_uuid host kind; do
    [[ -n "$node_uuid" ]] || continue
    ( dispatch_to_node "$node_uuid" "$host" "$kind" "$snippet" ) &
    pids+=("$!")
  done < "$nodes_file"
  deadline=$(( $(date +%s) + RESULT_TIMEOUT ))
  wait_for_dispatches "$deadline" "${pids[@]}" || rc=$?
  (( rc == 124 )) && log WARN "deadline reached after ${RESULT_TIMEOUT}s; missing node results will be marked offline"
  collect_results "$nodes_file"
  printf 'workload=%s\n' "$workload"
  compute_metrics
}

show_status() {
  local run_id="${1:-}"
  if [[ -n "$run_id" ]]; then
    sqlite3 -header -column "$DB" \
      "SELECT run_id, workload, started_at, finished_at, nodes_total, nodes_online, nodes_offline, total_work_units, avg_duration_ms, fastest_node, slowest_node FROM mesh_scale_runs WHERE run_id=$(sql_quote "$run_id");"
    printf '\n'
    sqlite3 -header -column "$DB" \
      "SELECT node_uuid, node_host, node_kind, status, rc, duration_ms, work_units FROM mesh_scale_results WHERE run_id=$(sql_quote "$run_id") ORDER BY node_kind, node_uuid;"
  else
    sqlite3 -header -column "$DB" \
      "SELECT run_id, workload, started_at, finished_at, nodes_total, nodes_online, nodes_offline, total_work_units, avg_duration_ms, fastest_node, slowest_node FROM mesh_scale_runs ORDER BY started_at DESC LIMIT 10;"
  fi
}

show_nodes() {
  printf 'NODE_UUID|HOST|KIND\n'
  get_all_nodes
}

main() {
  local cmd="${1:-}" arg="${2:-}"
  check_prereqs
  init_db
  case "$cmd" in
    --run)
      [[ -n "$arg" ]] || { log ERROR "--run requires a workload"; usage; exit 1; }
      shift 2
      (($# == 0)) || { log ERROR "unexpected arguments: $*"; exit 1; }
      exec 9>"$LOCK"
      flock -n 9 || { log ERROR "scale-test already running"; exit 1; }
      run_workload "$arg"
      ;;
    --status)
      shift
      (($# <= 1)) || { log ERROR "unexpected arguments: ${*:2}"; exit 1; }
      show_status "${1:-}"
      ;;
    --nodes)
      shift
      (($# == 0)) || { log ERROR "unexpected arguments: $*"; exit 1; }
      show_nodes
      ;;
    --help|-h|"")
      usage
      ;;
    *)
      log ERROR "unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
