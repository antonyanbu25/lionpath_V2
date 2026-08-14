#!/usr/bin/env bash
# Owner: Agent 1
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${HERMES_DB:-${DB:-$HERMES_HOME/state.db}}"
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HERMES_HOME/curiosity"
LOG_FILE="$LOG_DIR/migrations.log"

die() {
  printf 'run.sh: %s\n' "$*" >&2
  exit 1
}

log() {
  mkdir -p "$LOG_DIR"
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG_FILE"
}

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

require_sqlite3() {
  command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
}

ensure_db() {
  mkdir -p "$(dirname "$DB")" "$LOG_DIR"
  [[ -f "$DB" ]] || sqlite3 "$DB" 'PRAGMA user_version;' >/dev/null
}

ensure_migrations_table() {
  sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS curiosity_schema_migrations (
  migration TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
SQL
}

already_applied() {
  local migration="$1"
  local count
  count="$(sqlite3 -noheader "$DB" "SELECT COUNT(*) FROM curiosity_schema_migrations WHERE migration=$(sql_quote "$migration");")"
  [[ "$count" == "1" ]]
}

mark_applied() {
  local migration="$1"
  sqlite3 "$DB" "INSERT OR REPLACE INTO curiosity_schema_migrations(migration, applied_at) VALUES($(sql_quote "$migration"), datetime('now'));"
}

run_migration() {
  local sql_file="$1"
  local name
  local wrapper

  name="$(basename "$sql_file")"
  wrapper="${sql_file%.sql}.sh"

  if already_applied "$name"; then
    log "skip $name already applied"
    return 0
  fi

  log "apply $name"
  if [[ -x "$wrapper" ]]; then
    HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" DB="$DB" bash "$wrapper"
  else
    sqlite3 "$DB" <"$sql_file"
  fi
  mark_applied "$name"
  log "done $name"
}

main() {
  require_sqlite3
  ensure_db
  ensure_migrations_table

  local found=0
  local sql_file
  while IFS= read -r sql_file; do
    found=1
    run_migration "$sql_file"
  done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

  if [[ "$found" -eq 0 ]]; then
    log "no migrations found"
  fi

  log "migrations complete"
}

main "$@"
