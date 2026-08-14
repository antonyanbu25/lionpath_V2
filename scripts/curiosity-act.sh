#!/usr/bin/env bash
# Executes proposed AUTO_ACT curiosity actions for one brief.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${HERMES_DB:-$HERMES_HOME/state.db}"

usage() {
  cat >&2 <<EOF
Usage:
  $SCRIPT_NAME --brief-id <id> [--db <path>]
EOF
}

die() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

log_action() {
  local aid="$1" event_type="$2" detail="$3"
  sqlite3 "$DB" \
    "INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
     VALUES ($aid, $(sql_quote "$event_type"), datetime('now'), $(sql_quote "$detail"));" >/dev/null
}

mark_failed() {
  local aid="$1" outcome="$2" detail="${3:-$2}"
  sqlite3 "$DB" \
    "UPDATE curiosity_actions
     SET status='failed', outcome=$(sql_quote "$outcome")
     WHERE id=$aid;" >/dev/null || true
  log_action "$aid" "failed" "$detail" || true
}

# --- Goal-dispatcher integration ---------------------------------------------

# Path to the installed goal-dispatcher.  May not exist on all systems yet;
# callers guard with [[ -x ]] before invoking.
GOAL_DISPATCHER="${GOAL_DISPATCHER:-$HERMES_HOME/scripts/goal-dispatcher.sh}"

# Dispatch a single goal immediately (synchronous, non-fatal on failure).
# Called by the dispatch_now / subagent_dispatch primitives.
do_dispatch_now() {
  local goal_id="${1:-}"
  if [[ -z "$goal_id" ]]; then
    log_action "${ACTION_ID:-0}" "dispatch_skipped" "do_dispatch_now called with empty goal_id" || true
    return 0
  fi
  if [[ ! -x "$GOAL_DISPATCHER" ]]; then
    log_action "${ACTION_ID:-0}" "dispatch_skipped" "goal-dispatcher not found at $GOAL_DISPATCHER" || true
    return 0
  fi
  log_action "${ACTION_ID:-0}" "dispatch_now" "dispatching goal $goal_id immediately" || true
  # Synchronous dispatch; failures are non-fatal to the act loop.
  "$GOAL_DISPATCHER" --goal-id "$goal_id" || true
}

BRIEF_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief-id)
      [[ $# -ge 2 ]] || die "--brief-id requires a value"
      BRIEF_ID="$2"
      shift 2
      ;;
    --db)
      [[ $# -ge 2 ]] || die "--db requires a value"
      DB="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$BRIEF_ID" ]] || { usage; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
[[ -f "$DB" ]] || die "database not found: $DB"
[[ -f "$SCRIPT_DIR/curiosity-act-primitives.sh" ]] || die "missing primitives: $SCRIPT_DIR/curiosity-act-primitives.sh"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/curiosity-act-primitives.sh"

FIELD_SEP=$'\034'
mapfile -t ACTIONS < <(
  sqlite3 -separator "$FIELD_SEP" "$DB" \
    "SELECT id, primitive, COALESCE(target, ''), COALESCE(payload, '{}')
     FROM curiosity_actions
     WHERE brief_id=$(sql_quote "$BRIEF_ID")
       AND classification='AUTO_ACT'
       AND status='proposed'
     ORDER BY id;" 2>/dev/null
)

for line in "${ACTIONS[@]}"; do
  IFS="$FIELD_SEP" read -r ACTION_ID PRIMITIVE TARGET PAYLOAD <<<"$line"
  [[ "$ACTION_ID" =~ ^[0-9]+$ ]] || continue

  if ! sqlite3 "$DB" \
    "UPDATE curiosity_actions
     SET status='executing', executed_at=datetime('now')
     WHERE id=$ACTION_ID;" >/dev/null; then
    printf '%s: failed to mark action %s executing\n' "$SCRIPT_NAME" "$ACTION_ID" >&2
    continue
  fi

  log_action "$ACTION_ID" "executing" "$PRIMITIVE on $TARGET" || true

  case "$PRIMITIVE" in
    memory_write)
      act_memory_write "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "memory_write returned non-zero"
      ;;
    skill_patch)
      act_skill_patch "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "skill_patch returned non-zero"
      ;;
    goal_register)
      act_goal_register "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "goal_register returned non-zero"
      ;;
    radio_broadcast)
      act_radio_broadcast "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "radio_broadcast returned non-zero"
      ;;
    event_emit)
      act_event_emit "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "event_emit returned non-zero"
      ;;
    delegate_task)
      act_delegate_task "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "delegate_task returned non-zero"
      ;;
    # Immediately dispatch a registered goal to a subagent.
    dispatch_now)
      act_dispatch_now "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "dispatch_now returned non-zero"
      ;;
    # Dispatch a goal to a subagent (alias of dispatch_now with goal routing).
    subagent_dispatch)
      act_subagent_dispatch "$DB" "$ACTION_ID" "$PAYLOAD" || mark_failed "$ACTION_ID" "primitive_error" "subagent_dispatch returned non-zero"
      ;;
    *)
      mark_failed "$ACTION_ID" "unknown_primitive" "unknown primitive: $PRIMITIVE"
      ;;
  esac
done
