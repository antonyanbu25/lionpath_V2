#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB="${HERMES_DB:-$HERMES_HOME/state.db}"

json_escape() {
  local s="${1-}"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

sqlite_read() {
  sqlite3 -readonly "$DB" "$@"
}

table_exists() {
  local table="$1"
  [[ "$(sqlite_read "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';" 2>/dev/null || printf '0')" == "1" ]]
}

column_exists() {
  local table="$1"
  local column="$2"
  sqlite_read -separator $'\t' "PRAGMA table_info($table);" 2>/dev/null \
    | awk -F $'\t' -v column="$column" '$2 == column { found = 1 } END { exit !found }'
}

columns_exist() {
  local table="$1"
  shift
  local column
  for column in "$@"; do
    column_exists "$table" "$column" || return 1
  done
}

now_epoch="$(sqlite_read "SELECT CAST(strftime('%s','now') AS INTEGER);" 2>/dev/null || printf '0')"
last_cycle_at=0
triggers=()

if table_exists curiosity_state; then
  last_cycle_at="$(sqlite_read "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM curiosity_state WHERE key='last_cycle_at'), 0);" 2>/dev/null || printf '0')"
  last_self_reflect="$(sqlite_read "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM curiosity_state WHERE key='last_self_reflect'), 0);" 2>/dev/null || printf '0')"
else
  last_self_reflect=0
fi

if table_exists curiosity_topics; then
  stale_row="$(sqlite_read -separator $'\t' "
    SELECT topic, priority
    FROM curiosity_topics
    WHERE last_examined IS NULL
       OR last_examined < (CAST(strftime('%s','now') AS INTEGER) - stale_days * 86400)
    ORDER BY priority DESC
    LIMIT 1;
  " 2>/dev/null || true)"

  if [[ -n "$stale_row" ]]; then
    IFS=$'\t' read -r stale_topic stale_priority <<< "$stale_row"
    triggers+=("{\"id\":\"T_STALE_TOPIC\",\"topic\":\"$(json_escape "$stale_topic")\",\"priority\":$stale_priority,\"trigger_type\":\"T_STALE_TOPIC\"}")
  fi
fi

if table_exists gideon_sessions && column_exists gideon_sessions created_at; then
  recent_session_count="$(sqlite_read "
    SELECT COUNT(*)
    FROM gideon_sessions
    WHERE (
      typeof(created_at) IN ('integer','real')
      AND CAST(created_at AS INTEGER) >= CAST(strftime('%s','now','-2 hours') AS INTEGER)
    ) OR (
      typeof(created_at) = 'text'
      AND created_at >= datetime('now','-2 hours')
    );
  " 2>/dev/null || printf '0')"
  if (( recent_session_count > 0 )); then
    triggers+=("{\"id\":\"T_RECENT_SESSION\",\"topic\":\"Recent conversation with Kuttan\",\"priority\":8,\"trigger_type\":\"T_RECENT_SESSION\"}")
  fi
fi

if table_exists memory && columns_exist memory key updated_at; then
  significant_memory_count="$(sqlite_read "
    SELECT COUNT(*)
    FROM memory
    WHERE (
      lower(key) LIKE '%kuttan%'
      OR lower(key) LIKE '%goal%'
      OR lower(key) LIKE '%task%'
      OR lower(key) LIKE '%metric%'
    )
    AND (
      (typeof(updated_at) IN ('integer','real')
       AND CAST(updated_at AS INTEGER) >= CAST(strftime('%s','now','-24 hours') AS INTEGER))
      OR
      (typeof(updated_at) = 'text'
       AND updated_at >= datetime('now','-24 hours'))
    );
  " 2>/dev/null || printf '0')"
  if (( significant_memory_count > 0 )); then
    triggers+=("{\"id\":\"T_MEMORY_SIGNIFICANT\",\"topic\":\"Memory: something important happened\",\"priority\":7,\"trigger_type\":\"T_MEMORY_SIGNIFICANT\"}")
  fi
fi

if (( last_self_reflect == 0 || last_self_reflect < now_epoch - 3 * 86400 )); then
  self_priority=9
  if table_exists curiosity_topics; then
    self_priority="$(sqlite_read "SELECT COALESCE((SELECT priority FROM curiosity_topics WHERE topic='Gideon self-reflection & behavior patterns'), 9);" 2>/dev/null || printf '9')"
  fi
  triggers+=("{\"id\":\"T_SELF_REFLECT\",\"topic\":\"Gideon self-reflection & behavior patterns\",\"priority\":$self_priority,\"trigger_type\":\"T_SELF_REFLECT\"}")
  HERMES_STATE="$HERMES_HOME/scripts/curiosity-state.sh"
  "$HERMES_STATE" set-kv last_self_reflect "$now_epoch"
fi

if table_exists gideon_goals && columns_exist gideon_goals id title status last_progress_at; then
  stalled_goal_count="$(sqlite_read "
    SELECT COUNT(*)
    FROM gideon_goals
    WHERE status='active'
      AND (
        (typeof(last_progress_at) IN ('integer','real')
         AND CAST(last_progress_at AS INTEGER) <= CAST(strftime('%s','now','-7 days') AS INTEGER))
        OR
        (typeof(last_progress_at) = 'text'
         AND last_progress_at <= datetime('now','-7 days'))
      );
  " 2>/dev/null || printf '0')"
  if (( stalled_goal_count > 0 )); then
    triggers+=("{\"id\":\"T_GOAL_STALLED\",\"topic\":\"Goal has stalled — needs attention\",\"priority\":9,\"trigger_type\":\"T_GOAL_STALLED\"}")
  fi

  while IFS=$'\t' read -r goal_id goal_title; do
    [[ -n "$goal_id" ]] || continue
    triggers+=("{\"id\":\"T_GOAL_DRIFT\",\"topic\":\"$(json_escape "$goal_title")\",\"priority\":10,\"trigger_type\":\"T_GOAL_DRIFT\",\"ref_id\":$goal_id}")
  done < <(sqlite_read -separator $'\t' "
    SELECT id, title
    FROM gideon_goals
    WHERE status='active'
      AND last_progress_at < datetime('now','-3 days')
    LIMIT 5;
  " 2>/dev/null || true)
fi

if table_exists curiosity_actions && columns_exist curiosity_actions id classification status proposed_at; then
  while IFS=$'\t' read -r action_id; do
    [[ -n "$action_id" ]] || continue
    triggers+=("{\"id\":\"T_CURIOSITY_FINDING\",\"topic\":\"curiosity: pending approval\",\"priority\":7,\"trigger_type\":\"T_CURIOSITY_FINDING\",\"ref_id\":$action_id}")
  done < <(sqlite_read "
    SELECT id
    FROM curiosity_actions
    WHERE classification='HUMAN_REQUIRED'
      AND status='proposed'
      AND proposed_at < datetime('now','-1 day')
    LIMIT 5;
  " 2>/dev/null || true)
fi

if table_exists curiosity_actions && columns_exist curiosity_actions id outcome verified_at; then
  while IFS=$'\t' read -r action_id; do
    [[ -n "$action_id" ]] || continue
    triggers+=("{\"id\":\"T_ACTION_FAILED\",\"topic\":\"curiosity: action failed\",\"priority\":8,\"trigger_type\":\"T_ACTION_FAILED\",\"ref_id\":$action_id}")
  done < <(sqlite_read "
    SELECT id
    FROM curiosity_actions
    WHERE outcome='failure'
      AND verified_at > datetime('now','-1 day')
    LIMIT 5;
  " 2>/dev/null || true)
fi

printf '{"triggers":['
for i in "${!triggers[@]}"; do
  if (( i > 0 )); then
    printf ','
  fi
  printf '%s' "${triggers[$i]}"
done
printf '],"last_cycle_at":%s}\n' "$last_cycle_at"
