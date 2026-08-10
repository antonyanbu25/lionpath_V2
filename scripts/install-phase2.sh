#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
DB_PATH="${HERMES_DB:-$HERMES_HOME/state.db}"
BACKUP_PATH="${PHASE2_DB_BACKUP:-$DB_PATH.pre-phase2.bak}"
CONFIG_PATH="${MESH_NODES_CONFIG:-$HERMES_HOME/config/mesh-nodes.conf}"
RUN_DIR="$HERMES_HOME/run"
SCRIPT_TARGET_DIR="$HERMES_HOME/scripts"
SYSTEMD_DIR="/etc/systemd/system"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SOURCE_DIR="$REPO_ROOT/scripts"
UNIT_SOURCE_DIR="$REPO_ROOT/etc/systemd/system"

PHASE2_SCRIPTS=(
  task-routing-protocol.sh
  workload-splitter.sh
  consciousness-propagation-hooks.sh
  consciousness-daemon.sh
  task-router-daemon.sh
)

PHASE2_UNITS=(
  gideon-consciousness.service
  gideon-task-router.service
)

log() {
  printf '[install-phase2] %s\n' "$*"
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    printf 'install-phase2.sh must be run as root\n' >&2
    exit 1
  fi
}

require_commands() {
  local missing=0

  for cmd in sqlite3 systemctl install mkdir grep touch chmod; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      printf 'missing required command: %s\n' "$cmd" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

prepare_dirs() {
  mkdir -p "$HERMES_HOME" "$RUN_DIR" "$SCRIPT_TARGET_DIR" "$(dirname "$CONFIG_PATH")"
}

backup_state_db() {
  if [[ ! -f "$DB_PATH" ]]; then
    log "state.db does not exist yet; creating it during schema setup"
    return
  fi

  if [[ -f "$BACKUP_PATH" ]]; then
    log "state.db backup already exists at $BACKUP_PATH"
    return
  fi

  sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
  chmod 0600 "$BACKUP_PATH"
  log "backed up state.db to $BACKUP_PATH"
}

init_state_db() {
  sqlite3 "$DB_PATH" <<'SQL'
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  status TEXT,
  origin_node TEXT,
  worker_node TEXT,
  task_type TEXT,
  spec TEXT,
  created_at INTEGER,
  assigned_at INTEGER,
  completed_at INTEGER,
  exit_code INTEGER,
  result TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
CREATE INDEX IF NOT EXISTS idx_task_queue_worker ON task_queue(worker_node);

CREATE TABLE IF NOT EXISTS mesh_consciousness (
  node_host TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  state_digest TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
SQL

  log "enabled WAL mode and verified Phase 2 schema at $DB_PATH"
}

copy_phase2_scripts() {
  local script

  for script in "${PHASE2_SCRIPTS[@]}"; do
    if [[ -f "$SCRIPT_SOURCE_DIR/$script" ]]; then
      install -m 0755 "$SCRIPT_SOURCE_DIR/$script" "$SCRIPT_TARGET_DIR/$script"
      log "installed $script"
    else
      log "source script not present in this checkout, leaving target unchanged: $script"
    fi
  done

  for script in consciousness-daemon.sh task-router-daemon.sh; do
    if [[ ! -x "$SCRIPT_TARGET_DIR/$script" ]]; then
      printf 'required daemon script is missing or not executable: %s/%s\n' "$SCRIPT_TARGET_DIR" "$script" >&2
      exit 1
    fi
  done
}

copy_systemd_units() {
  local unit

  for unit in "${PHASE2_UNITS[@]}"; do
    install -m 0644 "$UNIT_SOURCE_DIR/$unit" "$SYSTEMD_DIR/$unit"
    log "installed $unit"
  done

  systemctl daemon-reload
  log "reloaded systemd"
}

update_mesh_nodes_note() {
  local note="# Phase 2 requires $DB_PATH to use SQLite WAL mode for concurrent mesh reads."

  touch "$CONFIG_PATH"
  if ! grep -Fqx "$note" "$CONFIG_PATH"; then
    printf '\n%s\n' "$note" >> "$CONFIG_PATH"
    log "added WAL mode note to $CONFIG_PATH"
  else
    log "WAL mode note already present in $CONFIG_PATH"
  fi
}

enable_start_services() {
  systemctl enable --now gideon-consciousness.service gideon-task-router.service
  log "enabled and started Phase 2 services"
}

verify_services() {
  local service failed=0

  for service in gideon-mesh-daemon.service "${PHASE2_UNITS[@]}"; do
    if systemctl is-active --quiet "$service"; then
      log "$service is running"
    else
      printf '%s is not running\n' "$service" >&2
      failed=1
    fi
  done

  if [[ "$failed" -ne 0 ]]; then
    exit 1
  fi
}

main() {
  require_root
  require_commands
  prepare_dirs
  backup_state_db
  init_state_db
  copy_phase2_scripts
  copy_systemd_units
  update_mesh_nodes_note
  enable_start_services
  verify_services
}

main "$@"
