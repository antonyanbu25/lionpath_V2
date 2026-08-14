#!/usr/bin/env bash
# Installs goal-dispatcher.sh and goal-dispatcher-worker.sh into the live
# Hermes scripts directory, runs DB migration 003, creates a log file for the
# cron redirect, writes a cron entry, and verifies syntax.
#
# Idempotent: safe to run multiple times.
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
INSTALL_DIR="$HERMES_HOME/scripts"
DB="${HERMES_DB:-$HERMES_HOME/state.db}"

CRON_FILE="/etc/cron.d/gideon-dispatch"
CRON_LINE='*/10 * * * * root /root/.hermes/scripts/goal-dispatcher.sh >> /var/log/goal-dispatcher.log 2>&1'

DISPATCHER_SRC="$REPO_ROOT/scripts/goal-dispatcher.sh"
WORKER_SRC="$REPO_ROOT/scripts/goal-dispatcher-worker.sh"
MIGRATION_SCRIPT="$REPO_ROOT/scripts/curiosity-migrations/003_dispatch_state.sh"
MIGRATIONS_RUNNER="$REPO_ROOT/scripts/curiosity-migrations/run.sh"

die() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

info() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$*"
}

ensure_prereqs() {
  command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
  command -v bash >/dev/null 2>&1 || die "bash is required"
  [[ -f "$DISPATCHER_SRC" ]] || die "source script not found: $DISPATCHER_SRC"
  [[ -x "$MIGRATIONS_RUNNER" || -f "$MIGRATIONS_RUNNER" ]] \
    || die "migrations runner not found: $MIGRATIONS_RUNNER"
}

verify_syntax() {
  info "syntax check: $DISPATCHER_SRC"
  bash -n "$DISPATCHER_SRC"
  if [[ -f "$WORKER_SRC" ]]; then
    info "syntax check: $WORKER_SRC"
    bash -n "$WORKER_SRC"
  fi
}

ensure_install_dir() {
  if [[ ! -d "$INSTALL_DIR" ]]; then
    mkdir -p "$INSTALL_DIR"
    info "created install dir: $INSTALL_DIR"
  fi
}

copy_script() {
  local src="$1"
  local dest_file="$2"
  local dest="$INSTALL_DIR/$dest_file"

  if [[ -f "$src" ]]; then
    install -m 755 "$src" "$dest"
    info "installed $dest_file → $dest"
  else
    info "skip $dest_file (source not present): $src"
  fi
}

run_migration_003() {
  if [[ ! -f "$MIGRATION_SCRIPT" ]]; then
    info "migration 003_dispatch_state.sh not found, skipping"
    return 0
  fi

  bash -n "$MIGRATION_SCRIPT" || die "migration 003 failed syntax check"

  # Check whether the migration was already applied via the schema version table.
  local applied=0
  applied="$(sqlite3 -noheader "$DB" \
    "SELECT COUNT(*) FROM curiosity_schema_migrations WHERE migration='003_dispatch_state.sql';" \
    2>/dev/null || echo 0)"

  if [[ "$applied" -ge 1 ]]; then
    info "migration 003 already applied, skipping"
    return 0
  fi

  info "running migration 003_dispatch_state.sh"
  HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" DB="$DB" \
    bash "$MIGRATIONS_RUNNER"
  info "migration 003 complete"
}

ensure_cron() {
  if [[ -f "$CRON_FILE" ]] && grep -qF "$CRON_LINE" "$CRON_FILE" 2>/dev/null; then
    info "cron entry already present in $CRON_FILE"
    return 0
  fi

  # If the cron file exists but does not have our line, append it.
  if [[ -f "$CRON_FILE" ]]; then
    printf '%s\n' "$CRON_LINE" >> "$CRON_FILE"
    chmod 644 "$CRON_FILE"
    info "appended cron entry to existing $CRON_FILE"
    return 0
  fi

  printf '%s\n' "$CRON_LINE" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  info "created $CRON_FILE with dispatch cron entry"

  # Try to reload cron if crond is running; non-fatal if not.
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload cron 2>/dev/null || systemctl reload crond 2>/dev/null || true
  fi
}

ensure_log_dir() {
  local log_dir
  log_dir="$(dirname /var/log/goal-dispatcher.log)"

  if [[ ! -d "$log_dir" ]]; then
    mkdir -p "$log_dir"
    info "created log dir: $log_dir"
  fi

  # Pre-create the log file so the cron redirect does not fail on first run.
  if [[ ! -f /var/log/goal-dispatcher.log ]]; then
    : > /var/log/goal-dispatcher.log
    chmod 644 /var/log/goal-dispatcher.log
    info "created log file: /var/log/goal-dispatcher.log"
  fi
}

verify_install() {
  # Re-run bash -n against the installed copies to be sure they landed intact.
  if [[ -f "$INSTALL_DIR/goal-dispatcher.sh" ]]; then
    bash -n "$INSTALL_DIR/goal-dispatcher.sh" \
      || die "installed goal-dispatcher.sh failed syntax check"
  fi
  if [[ -f "$INSTALL_DIR/goal-dispatcher-worker.sh" ]]; then
    bash -n "$INSTALL_DIR/goal-dispatcher-worker.sh" \
      || die "installed goal-dispatcher-worker.sh failed syntax check"
  fi
  info "installation verified"
}

main() {
  info "installing goal-dispatcher (idempotent)"

  ensure_prereqs
  verify_syntax
  ensure_install_dir

  copy_script "$DISPATCHER_SRC" "goal-dispatcher.sh"
  if [[ -f "$WORKER_SRC" ]]; then
    copy_script "$WORKER_SRC" "goal-dispatcher-worker.sh"
  fi

  run_migration_003
  ensure_log_dir
  ensure_cron

  verify_install

  info "Success — goal-dispatcher installed to $INSTALL_DIR"
  info "Cron: $CRON_FILE (every 10 minutes)"
  info "Log: /var/log/goal-dispatcher.log"
  info "Run manually: $INSTALL_DIR/goal-dispatcher.sh"
  if [[ -f "$INSTALL_DIR/goal-dispatcher.sh" ]]; then
    info "Goal-dispatcher path: $INSTALL_DIR/goal-dispatcher.sh"
  fi
}

main "$@"
