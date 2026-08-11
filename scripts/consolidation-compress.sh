#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${GIDEON_DB:-$HERMES_HOME/state.db}"
LIMIT="${CONSOLIDATION_LIMIT:-50}"

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  consolidation-compress.sh [--limit <n>]

Reads episodic memory rows and prints a semantic digest to stdout. It never writes
to memory tables. If CHEAP_MODEL_URL and CHEAP_MODEL_KEY are set, it asks that
model to summarize; otherwise it emits a local stub digest.

Environment:
  HERMES_HOME              Defaults to ~/.hermes
  GIDEON_DB                Defaults to $HERMES_HOME/state.db
  CONSOLIDATION_LIMIT      Rows to sample, defaults to 50
  CHEAP_MODEL_URL          Optional HTTP endpoint for summarization
  CHEAP_MODEL_KEY          Optional bearer token for summarization
USAGE
}

check_prereqs() {
  if ! command -v sqlite3 >/dev/null 2>&1; then
    log ERROR "missing prerequisite: sqlite3"
    exit 2
  fi
  if [[ ! -f "$DB_PATH" ]]; then
    log ERROR "database not found: $DB_PATH"
    exit 3
  fi
}

quote_ident() {
  local ident="${1//\"/\"\"}"
  printf '"%s"' "$ident"
}

sql_literal() {
  local value="${1//\'/\'\'}"
  printf "'%s'" "$value"
}

table_exists() {
  local table="$1"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$(sql_literal "$table");"
}

column_exists() {
  local table="$1"
  local column="$2"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info($(sql_literal "$table")) WHERE name=$(sql_literal "$column");"
}

first_existing_column() {
  local table="$1"
  shift
  local column
  for column in "$@"; do
    if [[ "$(column_exists "$table" "$column")" != "0" ]]; then
      printf '%s\n' "$column"
      return 0
    fi
  done
  return 1
}

first_episodic_table() {
  local table
  table="$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND lower(name) GLOB '*episod*' ORDER BY name LIMIT 1;")"
  if [[ -n "$table" ]]; then
    printf '%s\n' "$table"
    return 0
  fi
  for table in memory memories facts; do
    [[ "$(table_exists "$table")" == "1" ]] || continue
    if [[ "$(column_exists "$table" type)" != "0" ]]; then
      printf '%s\n' "$table"
      return 0
    fi
  done
  return 1
}

json_escape() {
  local input="$1"
  input="${input//\\/\\\\}"
  input="${input//\"/\\\"}"
  input="${input//$'\n'/\\n}"
  input="${input//$'\r'/}"
  printf '%s' "$input"
}

fetch_episodes() {
  local table id_col text_col ts_col where_clause order_clause
  table="$(first_episodic_table || true)"
  [[ -n "$table" ]] || return 1

  id_col="$(first_existing_column "$table" id rowid key uuid || true)"
  text_col="$(first_existing_column "$table" content text value summary body payload memory fact || true)"
  ts_col="$(first_existing_column "$table" updated_at created_at ts timestamp time || true)"

  [[ -n "$text_col" ]] || return 1
  [[ -n "$id_col" ]] || id_col="rowid"
  where_clause="1=1"
  if [[ "$(column_exists "$table" type)" != "0" && "$table" != *episod* ]]; then
    where_clause="lower(type) LIKE '%episod%'"
  fi
  order_clause="rowid DESC"
  [[ -n "$ts_col" ]] && order_clause="$(quote_ident "$ts_col") DESC"

  sqlite3 -tabs "$DB_PATH" "SELECT $(quote_ident "$id_col"), COALESCE($(quote_ident "$text_col"), '') FROM $(quote_ident "$table") WHERE $where_clause AND COALESCE($(quote_ident "$text_col"), '') != '' ORDER BY $order_clause LIMIT $LIMIT;"
}

stub_digest() {
  local rows="$1"
  local count
  count="$(printf '%s\n' "$rows" | awk 'NF {count++} END {print count+0}')"
  printf '# Semantic Digest\n\n'
  printf 'source: %s\n' "$DB_PATH"
  printf 'episodes_sampled: %s\n\n' "$count"
  printf '## Summary\n'
  if [[ "$count" -eq 0 ]]; then
    printf 'No episodic rows were discoverable for compression.\n'
    return 0
  fi
  printf 'Local stub digest from recent episodic memory. Set CHEAP_MODEL_URL and CHEAP_MODEL_KEY for model compression.\n\n'
  printf '## Evidence\n'
  printf '%s\n' "$rows" | awk -F '\t' 'NF {
    text=$2
    gsub(/[[:space:]]+/, " ", text)
    if (length(text) > 180) text=substr(text, 1, 177) "..."
    printf "- episode_id=%s %s\n", $1, text
  }'
}

model_digest() {
  local rows="$1"
  local prompt payload
  prompt="$(printf 'Summarize these episodic memory rows into a concise semantic digest. Preserve durable facts and uncertainty. Do not invent writes or deletion actions.\n\n%s\n' "$rows")"
  payload="{\"input\":\"$(json_escape "$prompt")\"}"
  curl -fsS \
    -H "Authorization: Bearer $CHEAP_MODEL_KEY" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "$CHEAP_MODEL_URL"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --limit)
        [[ $# -ge 2 ]] || { log ERROR "--limit requires a value"; exit 1; }
        LIMIT="$2"
        shift 2
        ;;
      --help|-h|help)
        usage
        return 0
        ;;
      *)
        log ERROR "unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
  [[ "$LIMIT" =~ ^[0-9]+$ && "$LIMIT" -gt 0 ]] || { log ERROR "invalid limit: $LIMIT"; exit 1; }
  check_prereqs

  local rows
  rows="$(fetch_episodes || true)"
  if [[ -n "${CHEAP_MODEL_URL:-}" && -n "${CHEAP_MODEL_KEY:-}" ]]; then
    model_digest "$rows" || { log WARN "model summarization failed; falling back to stub"; stub_digest "$rows"; }
  else
    stub_digest "$rows"
  fi
}

main "$@"
