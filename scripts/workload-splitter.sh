#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
STATE_DIR="${WORKLOAD_SPLITTER_STATE_DIR:-$HERMES_HOME/workload-splitter}"
TASK_ROUTER="${TASK_ROUTER:-}"
SUBTASK_TIMEOUT="${SUBTASK_TIMEOUT:-300}"
MAX_RETRIES="${MAX_RETRIES:-3}"
BACKOFFS=(10 30 90)
ACTION=""
TASK_DESCRIPTION=""
PLAN_FILE=""
TMP_DIR=""

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  workload-splitter.sh --decompose <description>
  workload-splitter.sh --dispatch <plan_file>
  workload-splitter.sh --collect <plan_file>
  workload-splitter.sh --help

Environment:
  SUBTASK_TIMEOUT=300
  TASK_ROUTER=/path/to/task-routing-protocol.sh
  WORKLOAD_SPLITTER_STATE_DIR=~/.hermes/workload-splitter
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  return 0
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

check_prereqs() {
  local mode="${1:-all}"
  local missing=0 bin
  for bin in jq date mktemp sha256sum timeout; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  if [[ "$mode" == "dispatch" ]]; then
    resolve_router >/dev/null || missing=1
  fi
  (( missing == 0 )) || exit 2
}

resolve_router() {
  local candidate
  if [[ -n "$TASK_ROUTER" ]]; then
    [[ -x "$TASK_ROUTER" ]] || { log ERROR "TASK_ROUTER is not executable: $TASK_ROUTER"; return 1; }
    printf '%s\n' "$TASK_ROUTER"
    return 0
  fi
  for candidate in \
    "$HERMES_HOME/scripts/task-routing-protocol.sh" \
    "$(dirname "${BASH_SOURCE[0]}")/task-routing-protocol.sh" \
    "/usr/local/lib/gideon/task-routing-protocol.sh" \
    "/usr/local/bin/task-routing-protocol.sh"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  log ERROR "missing executable task-routing-protocol.sh; set TASK_ROUTER or install it under ~/.hermes/scripts"
  return 1
}

parse_args() {
  if (($# == 0)); then
    usage
    exit 1
  fi
  while (($# > 0)); do
    case "$1" in
      --decompose)
        ACTION="decompose"
        shift
        [[ $# -gt 0 ]] || { log ERROR "--decompose requires a description"; exit 1; }
        TASK_DESCRIPTION="$1"
        ;;
      --dispatch)
        ACTION="dispatch"
        shift
        [[ $# -gt 0 ]] || { log ERROR "--dispatch requires a plan file"; exit 1; }
        PLAN_FILE="$1"
        ;;
      --collect)
        ACTION="collect"
        shift
        [[ $# -gt 0 ]] || { log ERROR "--collect requires a plan file"; exit 1; }
        PLAN_FILE="$1"
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        log ERROR "unknown argument: $1"
        usage
        exit 1
        ;;
    esac
    shift
  done
  [[ -n "$ACTION" ]] || { log ERROR "no command supplied"; exit 1; }
}

trim() {
  local s="${1-}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s\n' "$s"
}

strategy_for() {
  local desc="$1"
  if grep -Eiq '\b(then|after|before|depends?|dependency|sequential|in order|once|first|next|finally)\b' <<<"$desc"; then
    printf 'sequential\n'
  else
    printf 'parallel\n'
  fi
}

normalize_plan() {
  jq -e '
    (.strategy == "parallel" or .strategy == "sequential")
    and (.tasks | type == "array")
    and ((.tasks | length) > 0)
    and all(.tasks[]; (.id | type == "string") and (.description | type == "string"))
  ' "$1" >/dev/null
}

decompose() {
  local desc="$1"
  local strategy raw line words count i start chunk dep
  strategy="$(strategy_for "$desc")"
  TMP_DIR="$(mktemp -d)"
  raw="$TMP_DIR/tasks.raw"

  if [[ "$desc" == *$'\n'* ]] || grep -Eq ';|•|^[-*][[:space:]]' <<<"$desc"; then
    printf '%s\n' "$desc" |
      sed -E 's/[;•]/\n/g; s/^[[:space:]]*[-*][[:space:]]+//' |
      while IFS= read -r line || [[ -n "$line" ]]; do
        line="$(trim "$line")"
        [[ -n "$line" ]] && printf '%s\n' "$line"
      done > "$raw"
  elif grep -Eiq '\bthen\b' <<<"$desc"; then
    sed -E 's/[[:space:]]+[Tt]hen[[:space:]]+/\n/g' <<<"$desc" > "$raw"
  else
    words=$(wc -w <<<"$desc")
    if (( words > 80 )); then
      count=0
      : > "$raw"
      for word in $desc; do
        printf '%s ' "$word" >> "$raw"
        ((count++))
        (( count % 40 == 0 )) && printf '\n' >> "$raw"
      done
      printf '\n' >> "$raw"
    else
      printf '%s\n' "$desc" > "$raw"
    fi
  fi

  jq -R -s --arg strategy "$strategy" '
    split("\n")
    | map(gsub("^\\s+|\\s+$"; ""))
    | map(select(length > 0))
    | to_entries
    | {
        tasks: map({
          id: ("sub-" + ((.key + 1) | tostring)),
          description: .value,
          estimated_effort: (((((.value | split(" ") | length) / 12) | ceil) | if . < 1 then 1 else . end | tostring) + " min"),
          dependencies: []
        }),
        strategy: $strategy
      }
  ' "$raw" |
    if [[ "$strategy" == "sequential" ]]; then
      jq '.tasks |= to_entries | .tasks |= map(.value.dependencies = (if .key == 0 then [] else ["sub-" + (.key | tostring)] end) | .value)'
    else
      cat
    fi
}

plan_key() {
  local plan_file="$1"
  local abs
  abs="$(cd "$(dirname "$plan_file")" && pwd)/$(basename "$plan_file")"
  printf '%s' "$abs" | sha256sum | awk '{print $1}'
}

run_dir_for() {
  printf '%s/%s' "$STATE_DIR" "$(plan_key "$1")"
}

write_json_atomic() {
  local target="$1"
  local tmp="${target}.$$"
  cat > "$tmp"
  mv "$tmp" "$target"
}

run_subtask() {
  local router="$1"
  local run_dir="$2"
  local task_id="$3"
  local description="$4"
  local attempt=1
  local max_attempts=$((MAX_RETRIES + 1))
  local out err status started ended
  out="$run_dir/$task_id.stdout"
  err="$run_dir/$task_id.stderr"

  while (( attempt <= max_attempts )); do
    : > "$out"
    : > "$err"
    started="$(date +%s)"
    log INFO "dispatching $task_id attempt $attempt/$max_attempts"
    set +e
    timeout "$SUBTASK_TIMEOUT" "$router" --query "$description" >"$out" 2>"$err"
    status=$?
    set -e
    ended="$(date +%s)"
    if (( status == 0 )); then
      jq -nc \
        --arg id "$task_id" \
        --arg status "success" \
        --argjson attempts "$attempt" \
        --argjson started "$started" \
        --argjson ended "$ended" \
        --rawfile stdout "$out" \
        --rawfile stderr "$err" \
        '{id:$id,status:$status,attempts:$attempts,started_at:$started,ended_at:$ended,stdout:$stdout,stderr:$stderr}' |
        write_json_atomic "$run_dir/$task_id.json"
      return 0
    fi

    jq -nc \
      --arg id "$task_id" \
      --arg status "failed" \
      --argjson attempts "$attempt" \
      --argjson exit_code "$status" \
      --argjson started "$started" \
      --argjson ended "$ended" \
      --rawfile stdout "$out" \
      --rawfile stderr "$err" \
      '{id:$id,status:$status,attempts:$attempts,exit_code:$exit_code,started_at:$started,ended_at:$ended,stdout:$stdout,stderr:$stderr}' |
      write_json_atomic "$run_dir/$task_id.json"

    (( attempt > MAX_RETRIES )) && return "$status"
    log WARN "$task_id failed with exit code $status; retrying after ${BACKOFFS[$((attempt - 1))]}s"
    sleep "${BACKOFFS[$((attempt - 1))]}"
    ((attempt++))
  done
}

dispatch_parallel() {
  local plan_file="$1"
  local router="$2"
  local run_dir="$3"
  local pid status=0
  local pids=()

  while IFS=$'\t' read -r task_id description; do
    run_subtask "$router" "$run_dir" "$task_id" "$description" &
    pids+=("$!")
  done < <(jq -r '.tasks[] | [.id, .description] | @tsv' "$plan_file")

  for pid in "${pids[@]}"; do
    wait "$pid" || status=1
  done
  return "$status"
}

dispatch_sequential() {
  local plan_file="$1"
  local router="$2"
  local run_dir="$3"
  local task_id description

  while IFS=$'\t' read -r task_id description; do
    run_subtask "$router" "$run_dir" "$task_id" "$description" || return 1
  done < <(jq -r '.tasks[] | [.id, .description] | @tsv' "$plan_file")
}

dispatch_plan() {
  local plan_file="$1"
  local router run_dir strategy status=0
  [[ -f "$plan_file" ]] || { log ERROR "plan file not found: $plan_file"; exit 1; }
  normalize_plan "$plan_file"
  router="$(resolve_router)"
  run_dir="$(run_dir_for "$plan_file")"
  strategy="$(jq -r '.strategy' "$plan_file")"
  mkdir -p "$run_dir"
  cp "$plan_file" "$run_dir/plan.json"
  jq -nc --arg plan "$plan_file" --arg strategy "$strategy" --arg started_at "$(date +%s)" \
    '{plan_file:$plan,strategy:$strategy,started_at:$started_at}' > "$run_dir/run.json"

  if [[ "$strategy" == "parallel" ]]; then
    dispatch_parallel "$plan_file" "$router" "$run_dir" || status=1
  else
    dispatch_sequential "$plan_file" "$router" "$run_dir" || status=1
  fi

  collect_plan "$plan_file"
  return "$status"
}

collect_plan() {
  local plan_file="$1"
  local run_dir
  [[ -f "$plan_file" ]] || { log ERROR "plan file not found: $plan_file"; exit 1; }
  normalize_plan "$plan_file"
  run_dir="$(run_dir_for "$plan_file")"
  mkdir -p "$run_dir"

  jq -n --slurpfile plan "$plan_file" --slurpfile results <(
    jq -s '.' "$run_dir"/*.json 2>/dev/null || printf '[]\n'
  ) '
    ($plan[0]) as $plan
    |
    ($results[0] // []) as $raw_results
    | ($raw_results | map(select(.id != null))) as $task_results
    | (reduce $task_results[] as $result ({}; .[$result.id] = $result)) as $result_by_id
    | {
        strategy: $plan.strategy,
        total: ($plan.tasks | length),
        succeeded: ($task_results | map(select(.status == "success")) | length),
        failed: ($task_results | map(select(.status != "success")) | length),
        pending: (($plan.tasks | length) - ($task_results | length)),
        success: (($task_results | length) == ($plan.tasks | length) and all($task_results[]; .status == "success")),
        tasks: ($plan.tasks | map(. as $task | $task + {result: ($result_by_id[$task.id] // {status:"pending"})}))
      }
  '
}

main() {
  parse_args "$@"
  case "$ACTION" in
    decompose)
      check_prereqs decompose
      decompose "$TASK_DESCRIPTION"
      ;;
    dispatch)
      check_prereqs dispatch
      dispatch_plan "$PLAN_FILE"
      ;;
    collect)
      check_prereqs collect
      collect_plan "$PLAN_FILE"
      ;;
  esac
}

main "$@"
