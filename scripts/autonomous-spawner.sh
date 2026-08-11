#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SCRIPTS_DIR="$HERMES_HOME/scripts"
STATE_DIR="$HERMES_HOME/state"
DB="${HERMES_DB:-$STATE_DIR/state.db}"
RUN_DIR="$HERMES_HOME/run"
LOG_DIR="$HERMES_HOME/logs"
LOG_FILE="$LOG_DIR/autonomous-spawner.log"
LOCK_FILE="$RUN_DIR/autonomous-spawner.lock"
SSH_KEY="${HERMES_SPAWNER_KEY:-$HOME/.ssh/hermes_mesh_ed25519}"
MESH_SESSION="${MESH_SESSION:-mesh}"
LEAD_HOST="${HERMES_LEAD_HOST:-${MESH_LEAD_HOST:-$(hostname -f 2>/dev/null || hostname)}}"
LEAD_USER="${HERMES_LEAD_USER:-${USER:-}}"
SYSTEMD_SOURCE_DIR="${HERMES_SYSTEMD_DIR:-$HERMES_HOME/systemd}"
LOCK_FD=9

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)

log() {
  local level="$1"
  shift
  mkdir -p "$LOG_DIR"
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" | tee -a "$LOG_FILE" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  autonomous-spawner.sh --spawn <user@host>
  autonomous-spawner.sh --bootstrap <user@host>
  autonomous-spawner.sh --list-nodes
  autonomous-spawner.sh --verify <user@host>
  autonomous-spawner.sh --help

Environment:
  HERMES_HOME        Defaults to ~/.hermes
  HERMES_DB          Defaults to ~/.hermes/state/state.db
  HERMES_LEAD_HOST   Lead host passed to agent-radio-mesh.sh join
  HERMES_LEAD_USER   Lead SSH user passed to agent-radio-mesh.sh join
  MESH_SESSION       Mesh radio session, defaults to mesh
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  :
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

check_prereqs() {
  local missing=0 bin
  for bin in ssh scp sqlite3 flock date awk sed chmod mkdir; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  [[ -d "$SCRIPTS_DIR" ]] || { log ERROR "missing scripts directory: $SCRIPTS_DIR"; missing=1; }
  compgen -G "$SCRIPTS_DIR/*.sh" >/dev/null || { log ERROR "no mesh scripts found in $SCRIPTS_DIR"; missing=1; }
  (( missing == 0 )) || exit 4
}

init_dirs() {
  mkdir -p "$STATE_DIR" "$RUN_DIR" "$LOG_DIR"
}

acquire_lock() {
  exec {LOCK_FD}>"$LOCK_FILE"
  if ! flock -n "$LOCK_FD"; then
    log ERROR "autonomous-spawner already running"
    exit 1
  fi
}

migrate_schema() {
  sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS mesh_spawned_nodes (
  uuid TEXT PRIMARY KEY,
  host TEXT,
  ip TEXT,
  os TEXT,
  installed_at TEXT,
  last_heartbeat TEXT,
  capabilities TEXT,
  status TEXT
);
SQL
  local col
  for col in uuid host ip os installed_at last_heartbeat capabilities status; do
    if ! sqlite3 "$DB" "PRAGMA table_info(mesh_spawned_nodes);" | awk -F'|' '{print $2}' | grep -Fxq "$col"; then
      case "$col" in
        uuid) ;;
        installed_at|last_heartbeat|capabilities|status|host|ip|os)
          sqlite3 "$DB" "ALTER TABLE mesh_spawned_nodes ADD COLUMN $col TEXT;"
          ;;
      esac
    fi
  done
}

parse_target() {
  local raw="${1:-}" user host
  [[ "$raw" != *[[:space:]]* && "$raw" == *@* ]] || return 1
  user="${raw%%@*}"
  host="${raw#*@}"
  [[ -n "$user" && -n "$host" && "$host" != *@* ]] || return 1
  printf '%s@%s' "$user" "$host"
}

ensure_ssh_key() {
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  if [[ ! -f "$SSH_KEY" ]]; then
    log INFO "generating SSH key: $SSH_KEY"
    ssh-keygen -q -t ed25519 -N '' -f "$SSH_KEY" -C "hermes-mesh-$(hostname 2>/dev/null || echo node)" || return 1
  fi
  [[ -r "$SSH_KEY.pub" ]] || ssh-keygen -y -f "$SSH_KEY" > "$SSH_KEY.pub"
  chmod 600 "$SSH_KEY"
  chmod 644 "$SSH_KEY.pub"
}

ssh_ok() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'true' >/dev/null 2>&1
}

authorize_target() {
  local target="$1"
  if ssh_ok "$target"; then
    return 0
  fi
  if command -v ssh-copy-id >/dev/null 2>&1; then
    log INFO "attempting ssh-copy-id for $target"
    ssh-copy-id -i "$SSH_KEY.pub" -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$target" >/dev/null 2>&1 || true
  fi
  ssh_ok "$target"
}

detect_os_remote() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'uname -s 2>/dev/null || echo UNKNOWN' 2>/dev/null
}

detect_pkg_mgr_remote() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" \
    'command -v apt-get >/dev/null && echo apt && exit 0;
     command -v apk >/dev/null && echo apk && exit 0;
     command -v dnf >/dev/null && echo dnf && exit 0;
     command -v yum >/dev/null && echo yum && exit 0;
     command -v pkg >/dev/null && echo pkg && exit 0;
     echo' 2>/dev/null
}

install_prereqs_remote() {
  local target="$1" pm
  pm="$(detect_pkg_mgr_remote "$target")"
  [[ -n "$pm" ]] || { log ERROR "no supported package manager on $target"; return 1; }
  log INFO "installing prerequisites on $target with $pm"
  ssh "${SSH_OPTS[@]}" "$target" 'sh -s' -- "$pm" <<'REMOTE'
set -eu
pm="$1"
if [ "$(id -u)" -eq 0 ]; then
  sudo_cmd=""
else
  sudo_cmd="sudo -n"
fi
case "$pm" in
  apt)
    $sudo_cmd apt-get update -qq
    $sudo_cmd apt-get install -y -qq bash sqlite3 util-linux
    ;;
  apk)
    $sudo_cmd apk add -q bash sqlite sqlite-libs util-linux
    ;;
  dnf|yum)
    $sudo_cmd "$pm" install -y -q bash sqlite util-linux
    ;;
  pkg)
    $sudo_cmd pkg install -y bash sqlite3 util-linux || \
      $sudo_cmd pkg install -y bash sqlite3 flock || \
      $sudo_cmd pkg install -y bash sqlite3
    ;;
  *)
    exit 1
    ;;
esac
command -v bash >/dev/null
command -v sqlite3 >/dev/null
REMOTE
}

copy_mesh_scripts() {
  local target="$1"
  log INFO "copying mesh scripts to $target"
  ssh "${SSH_OPTS[@]}" "$target" 'mkdir -p "$HOME/.hermes/scripts" "$HOME/.hermes/state" "$HOME/.hermes/run" "$HOME/.hermes/logs"'
  scp "${SCP_OPTS[@]}" -q "$SCRIPTS_DIR"/*.sh "$target:.hermes/scripts/"
  ssh "${SSH_OPTS[@]}" "$target" 'chmod 0750 "$HOME"/.hermes/scripts/*.sh'
}

migrate_remote_db() {
  local target="$1"
  log INFO "running remote mesh-memory migration on $target"
  ssh "${SSH_OPTS[@]}" "$target" \
    'mkdir -p "$HOME/.hermes/state"; HERMES_HOME="$HOME/.hermes" bash "$HOME/.hermes/scripts/mesh-memory.sh" --migrate --db "$HOME/.hermes/state/state.db"'
}

copy_systemd_units_remote() {
  local target="$1"
  [[ -d "$SYSTEMD_SOURCE_DIR" ]] || return 0
  compgen -G "$SYSTEMD_SOURCE_DIR/*" >/dev/null || return 0
  log INFO "copying systemd units to $target"
  ssh "${SSH_OPTS[@]}" "$target" 'mkdir -p "$HOME/.hermes/systemd"'
  scp "${SCP_OPTS[@]}" -q "$SYSTEMD_SOURCE_DIR"/* "$target:.hermes/systemd/" || return 1
}

install_systemd_units_remote() {
  local target="$1"
  copy_systemd_units_remote "$target" || return 1
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
unit_dir="$HOME/.hermes/systemd"
if ! command -v systemctl >/dev/null 2>&1 || [[ ! -d "$unit_dir" ]]; then
  exit 0
fi
shopt -s nullglob
units=("$unit_dir"/*.service "$unit_dir"/*.timer)
if (( ${#units[@]} == 0 )); then
  exit 0
fi
mkdir -p "$HOME/.config/systemd/user"
cp "${units[@]}" "$HOME/.config/systemd/user/" 2>/dev/null || true
systemctl --user daemon-reload
for unit in "${units[@]}"; do
  name="$(basename "$unit")"
  systemctl --user enable --now "$name" >/dev/null 2>&1 || true
done
loginctl enable-linger "$(whoami)" >/dev/null 2>&1 || true
REMOTE
}

remote_uuid() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
uuid_file="$HOME/.hermes/state/node.uuid"
mkdir -p "$(dirname "$uuid_file")"
if [[ ! -s "$uuid_file" ]]; then
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen > "$uuid_file"
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid > "$uuid_file"
  else
    printf '%s-%s-%s\n' "$(hostname 2>/dev/null || echo node)" "$(date +%s)" "$RANDOM" | cksum | awk '{print $1}' > "$uuid_file"
  fi
fi
cat "$uuid_file"
REMOTE
}

remote_ip() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'sh -s' <<'REMOTE' 2>/dev/null || true
if command -v hostname >/dev/null 2>&1; then
  ip_addr="$(hostname -I 2>/dev/null | awk '{print $1; exit}')"
  if [ -n "$ip_addr" ]; then
    printf '%s\n' "$ip_addr"
    exit 0
  fi
fi
if command -v ip >/dev/null 2>&1; then
  ip_addr="$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')"
  if [ -n "$ip_addr" ]; then
    printf '%s\n' "$ip_addr"
    exit 0
  fi
fi
if command -v ifconfig >/dev/null 2>&1; then
  ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}'
fi
REMOTE
}

remote_capabilities() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'sh -s' <<'REMOTE' 2>/dev/null || printf 'unknown'
caps="bash"
command -v sqlite3 >/dev/null 2>&1 && caps="$caps,sqlite3"
command -v flock >/dev/null 2>&1 && caps="$caps,flock"
command -v systemctl >/dev/null 2>&1 && caps="$caps,systemd"
printf '%s,inbound=false\n' "$caps"
REMOTE
}

join_mesh_remote() {
  local target="$1"
  log INFO "joining $target to mesh session $MESH_SESSION via $LEAD_HOST"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' -- "$MESH_SESSION" "$LEAD_HOST" "$LEAD_USER" <<'REMOTE'
set -Eeuo pipefail
session="$1"
lead_host="$2"
lead_user="$3"
args=(join "$session" "$lead_host")
[[ -n "$lead_user" ]] && args+=("$lead_user")
HERMES_HOME="$HOME/.hermes" bash "$HOME/.hermes/scripts/agent-radio-mesh.sh" "${args[@]}"
REMOTE
}

register_spawned_node() {
  local uuid="$1" host="$2" ip="$3" os="$4" caps="$5" status="$6"
  sqlite3 "$DB" "INSERT INTO mesh_spawned_nodes (uuid, host, ip, os, installed_at, last_heartbeat, capabilities, status)
VALUES ($(sql_quote "$uuid"), $(sql_quote "$host"), $(sql_quote "$ip"), $(sql_quote "$os"), datetime('now'), NULL, $(sql_quote "$caps"), $(sql_quote "$status"))
ON CONFLICT(uuid) DO UPDATE SET
  host=excluded.host,
  ip=excluded.ip,
  os=excluded.os,
  installed_at=excluded.installed_at,
  capabilities=excluded.capabilities,
  status=excluded.status;"
}

register_failed() {
  local target="$1" os="${2:-unknown}" reason="${3:-failed}" uuid
  uuid="failed:$(printf '%s' "$target" | cksum | awk '{print $1}')"
  sqlite3 "$DB" "INSERT INTO mesh_spawned_nodes (uuid, host, ip, os, installed_at, last_heartbeat, capabilities, status)
VALUES ($(sql_quote "$uuid"), $(sql_quote "$target"), NULL, $(sql_quote "$os"), datetime('now'), NULL, $(sql_quote "error=$reason"), 'failed')
ON CONFLICT(uuid) DO UPDATE SET
  host=excluded.host,
  os=excluded.os,
  installed_at=excluded.installed_at,
  capabilities=excluded.capabilities,
  status='failed';"
}

spawn_node() {
  local raw="$1" target os uuid ip caps
  target="$(parse_target "$raw")" || { register_failed "$raw" unknown "bad_target"; log ERROR "target must be user@host"; return 1; }
  ensure_ssh_key || { register_failed "$target" unknown "ssh_key_create"; return 3; }
  authorize_target "$target" || { register_failed "$target" unknown "ssh_key_auth"; return 3; }
  os="$(detect_os_remote "$target" || true)"
  case "$os" in
    Linux|FreeBSD) ;;
    *) register_failed "$target" "${os:-unknown}" "unsupported_os"; log ERROR "unsupported target OS for $target: ${os:-unknown}"; return 5 ;;
  esac
  install_prereqs_remote "$target" || { register_failed "$target" "$os" "prereqs"; return 4; }
  copy_mesh_scripts "$target" || { register_failed "$target" "$os" "copy"; return 4; }
  migrate_remote_db "$target" || { register_failed "$target" "$os" "migrate"; return 4; }
  install_systemd_units_remote "$target" || { register_failed "$target" "$os" "systemd"; return 4; }
  join_mesh_remote "$target" || { register_failed "$target" "$os" "mesh_join"; return 6; }
  uuid="$(remote_uuid "$target")"
  ip="$(remote_ip "$target")"
  caps="$(remote_capabilities "$target")"
  register_spawned_node "$uuid" "$target" "$ip" "$os" "$caps" "active"
  log INFO "spawned node uuid=$uuid host=$target ip=$ip os=$os caps=$caps"
  printf '{"uuid":"%s","host":"%s","ip":"%s","os":"%s","caps":"%s"}\n' "$uuid" "$target" "$ip" "$os" "$caps"
}

start_daemons_remote() {
  local target="$1"
  ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
if command -v systemctl >/dev/null 2>&1; then
  for unit in mesh-memory-daemon node-health-daemon consciousness-daemon task-router-daemon gideon-node-health gideon-consciousness gideon-task-router; do
    systemctl --user start "$unit.service" >/dev/null 2>&1 || true
  done
fi
for script in mesh-memory-daemon.sh node-health-daemon.sh consciousness-daemon.sh task-router-daemon.sh; do
  path="$HOME/.hermes/scripts/$script"
  [[ -x "$path" ]] || continue
  HERMES_HOME="$HOME/.hermes" HERMES_DB="$HOME/.hermes/state/state.db" bash "$path" start >/dev/null 2>&1 || true
done
REMOTE
}

verify_node() {
  local raw="$1" target uuid
  target="$(parse_target "$raw")" || { log ERROR "target must be user@host"; return 1; }
  if ! ssh "${SSH_OPTS[@]}" "$target" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
test -x "$HOME/.hermes/scripts/mesh-memory.sh"
test -x "$HOME/.hermes/scripts/agent-radio-mesh.sh"
test -s "$HOME/.hermes/state/node.uuid"
command -v bash >/dev/null
command -v sqlite3 >/dev/null
REMOTE
  then
    register_failed "$target" unknown "not_online"
    log ERROR "node not online or incomplete: $target"
    return 6
  fi
  uuid="$(remote_uuid "$target")"
  sqlite3 "$DB" "UPDATE mesh_spawned_nodes SET last_heartbeat=datetime('now'), status='active' WHERE uuid=$(sql_quote "$uuid") OR host=$(sql_quote "$target");"
  log INFO "verified node online: $target uuid=$uuid"
  printf '%s online\n' "$target"
}

bootstrap_node() {
  local raw="$1"
  spawn_node "$raw"
  start_daemons_remote "$raw" || true
  verify_node "$raw"
}

list_nodes() {
  sqlite3 -header -column "$DB" \
    "SELECT uuid, host, ip, os, installed_at, last_heartbeat, capabilities, status FROM mesh_spawned_nodes ORDER BY installed_at DESC;"
}

main() {
  case "${1:-}" in
    --help|-h)
      usage
      exit 0
      ;;
    "")
      usage
      exit 1
      ;;
  esac
  init_dirs
  check_prereqs
  acquire_lock
  migrate_schema
  case "${1:-}" in
    --spawn)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      spawn_node "$2"
      ;;
    --bootstrap)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      bootstrap_node "$2"
      ;;
    --list-nodes)
      [[ $# -eq 1 ]] || { usage; exit 1; }
      list_nodes
      ;;
    --verify)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      verify_node "$2"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
