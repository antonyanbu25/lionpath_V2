#!/usr/bin/env bash
# Owner: Agent 2 (mesh-disp-2)
# Run migration 003_dispatch_state — creates goal_dispatch_state table.
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB="${HERMES_DB:-${DB:-$HERMES_HOME/state.db}}"
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() {
    printf '003_dispatch_state.sh: %s\n' "$*" >&2
    exit 1
}

require_sqlite3() {
    command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
}

ensure_db() {
    mkdir -p "$(dirname "$DB")"
    [[ -f "$DB" ]] || sqlite3 "$DB" 'PRAGMA user_version;' >/dev/null
}

main() {
    require_sqlite3
    ensure_db
    sqlite3 "$DB" < "$MIGRATIONS_DIR/003_dispatch_state.sql"
    echo "Migration 003 applied: goal_dispatch_state table"
}

main "$@"
