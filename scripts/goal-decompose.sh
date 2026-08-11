#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOAL_QUEUE="${SCRIPT_DIR}/goal-queue.sh"
DB="${HOME}/.hermes/state.db"

usage() {
  echo 'Usage: goal-decompose.sh "<high-level goal>"' >&2
}

sql_quote() {
  local value=${1//\'/\'\'}
  printf "'%s'" "$value"
}

json_quote() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '"%s"' "$value"
}

parent_id_for_goal() {
  local goal=$1
  sqlite3 "$DB" \
    "SELECT id
     FROM gideon_goals
     WHERE goal = $(sql_quote "$goal")
     ORDER BY id DESC
     LIMIT 1;"
}

fallback_subgoals() {
  local goal=$1
  printf 'Clarify success criteria for %s\n' "$goal"
  printf 'Identify dependencies for %s\n' "$goal"
  printf 'Execute the first concrete step for %s\n' "$goal"
}

glm_subgoals() {
  local goal=$1
  local response
  response=$(curl -fsS \
    -H "Authorization: Bearer ${GLM_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"goal\":$(json_quote "$goal"),\"task\":\"decompose\",\"format\":\"one_subgoal_per_line\",\"count\":3}" \
    "$GLM_API_URL")

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$response" | jq -r '
      if type == "array" then .[]
      elif has("subgoals") then .subgoals[]
      elif has("choices") then .choices[0].message.content
      elif has("content") then .content
      else .
      end
    '
  else
    printf '%s\n' "$response"
  fi | sed 's/^[[:space:]]*[-*0-9.)][[:space:]]*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | awk 'NF'
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 1
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 is required" >&2
    exit 1
  fi

  local goal=$1
  local parent_id
  "$GOAL_QUEUE" list >/dev/null
  parent_id=$(parent_id_for_goal "$goal")
  if [[ -z "$parent_id" ]]; then
    parent_id=$("$GOAL_QUEUE" add "$goal")
  fi

  local subgoals
  if [[ -n "${GLM_API_URL:-}" && -n "${GLM_API_KEY:-}" ]]; then
    if ! subgoals=$(glm_subgoals "$goal"); then
      subgoals=$(fallback_subgoals "$goal")
    fi
  else
    subgoals=$(fallback_subgoals "$goal")
  fi

  while IFS= read -r subgoal; do
    [[ -n "$subgoal" ]] || continue
    "$GOAL_QUEUE" add "$subgoal" "$parent_id"
  done <<<"$subgoals"
}

main "$@"
