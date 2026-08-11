#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB_PATH="${GIDEON_DB:-$HERMES_HOME/state.db}"
STALE_DAYS="${CONSOLIDATION_STALE_DAYS:-90}"
LIMIT="${CONSOLIDATION_LIMIT:-100}"

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  consolidation-prune.sh [--days <n>] [--limit <n>]

Reports stale memory/fact candidate ids only. It never deletes, updates, or
rewrites memory rows.

Environment:
  HERMES_HOME                 Defaults to ~/.hermes
  GIDEON_DB                   Defaults to $HERMES_HOME/state.db
  CONSOLIDATION_STALE_DAYS    Defaults to 90
  CONSOLIDATION_LIMIT         Defaults to 100
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

candidate_tables() {
  sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'gideon_mem_stats' AND (lower(name) GLOB '*semantic*' OR lower(name) GLOB '*fact*' OR lower(name) GLOB '*memory*' OR lower(name) GLOB '*memories*') ORDER BY name;"
}

report_table_candidates() {
  local table="$1"
  local cutoff="$2"
  local id_col updated_col text_col
  updated_col="$(first_existing_column "$table" updated_at modified_at last_seen_at ts timestamp || true)"
  [[ -n "$updated_col" ]] || return 0
  id_col="$(first_existing_column "$table" id rowid key uuid || true)"
  [[ -n "$id_col" ]] || id_col="rowid"
  text_col="$(first_existing_column "$table" content text value summary body payload memory fact || true)"

  if [[ -n "$text_col" ]]; then
    sqlite3 -tabs "$DB_PATH" "SELECT $(sql_literal "$table"), $(quote_ident "$id_col"), $(quote_ident "$updated_col"), substr(COALESCE($(quote_ident "$text_col"), ''), 1, 120) FROM $(quote_ident "$table") WHERE $(quote_ident "$updated_col") IS NOT NULL AND CAST($(quote_ident "$updated_col") AS INTEGER) > 0 AND CAST($(quote_ident "$updated_col") AS INTEGER) < $cutoff ORDER BY CAST($(quote_ident "$updated_col") AS INTEGER) ASC LIMIT $LIMIT;"
  else
    sqlite3 -tabs "$DB_PATH" "SELECT $(sql_literal "$table"), $(quote_ident "$id_col"), $(quote_ident "$updated_col"), '' FROM $(quote_ident "$table") WHERE $(quote_ident "$updated_col") IS NOT NULL AND CAST($(quote_ident "$updated_col") AS INTEGER) > 0 AND CAST($(quote_ident "$updated_col") AS INTEGER) < $cutoff ORDER BY CAST($(quote_ident "$updated_col") AS INTEGER) ASC LIMIT $LIMIT;"
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --days)
        [[ $# -ge 2 ]] || { log ERROR "--days requires a value"; exit 1; }
        STALE_DAYS="$2"
        shift 2
        ;;
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
  [[ "$STALE_DAYS" =~ ^[0-9]+$ && "$STALE_DAYS" -gt 0 ]] || { log ERROR "invalid days: $STALE_DAYS"; exit 1; }
  [[ "$LIMIT" =~ ^[0-9]+$ && "$LIMIT" -gt 0 ]] || { log ERROR "invalid limit: $LIMIT"; exit 1; }
  check_prereqs

  local cutoff table found=0
  cutoff="$(( $(date +%s) - (STALE_DAYS * 86400) ))"
  printf 'table\tcandidate_id\tupdated_at\tpreview\n'
  while IFS= read -r table || [[ -n "$table" ]]; do
    [[ -n "$table" ]] || continue
    report_table_candidates "$table" "$cutoff"
    found=1
  done < <(candidate_tables)
  if [[ "$found" -eq 0 ]]; then
    log WARN "no candidate memory/fact tables with updated_at-like columns found"
  fi
}

main "$@"
