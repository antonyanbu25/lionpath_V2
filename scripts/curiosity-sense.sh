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
    triggers+=("{\"id\":\"T_STALE_TOPIC\",\"topic\":\"$(json_escape "$stale_topic")\",\"priority\":$stale_priority}")
  fi
fi

if (( last_self_reflect == 0 || last_self_reflect < now_epoch - 3 * 86400 )); then
  self_priority=9
  if table_exists curiosity_topics; then
    self_priority="$(sqlite_read "SELECT COALESCE((SELECT priority FROM curiosity_topics WHERE topic='Gideon self-reflection & behavior patterns'), 9);" 2>/dev/null || printf '9')"
  fi
  triggers+=("{\"id\":\"T_SELF_REFLECT\",\"topic\":\"Gideon self-reflection & behavior patterns\",\"priority\":$self_priority}")
  HERMES_STATE="$HERMES_HOME/scripts/curiosity-state.sh"
  "$HERMES_STATE" set-kv last_self_reflect "$now_epoch"
fi

printf '{"triggers":['
for i in "${!triggers[@]}"; do
  if (( i > 0 )); then
    printf ','
  fi
  printf '%s' "${triggers[$i]}"
done
printf '],"last_cycle_at":%s}\n' "$last_cycle_at"
