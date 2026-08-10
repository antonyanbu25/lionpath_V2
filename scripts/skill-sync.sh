#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SKILLS_DIR="${SKILLS_DIR:-$HERMES_HOME/skills}"
DB_PATH="${DB_PATH:-$HERMES_HOME/state.db}"
REMOTE_SKILLS_DIR="${REMOTE_SKILLS_DIR:-~/.hermes/skills}"
DISCOVERED_NODES_FILE="${DISCOVERED_NODES_FILE:-$HERMES_HOME/config/discovered-nodes.json}"
MESH_NODES_FILE="${MESH_NODES_FILE:-$HERMES_HOME/config/mesh-nodes.conf}"
ACTION=""
NODE=""
DRY_RUN=0
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)
TMP_DIR=""

log() {
  local level="$1"
  shift
  printf '[%s] [%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage:
  skill-sync.sh --push [--node <user@host>] [--dry-run]
  skill-sync.sh --pull [--node <user@host>] [--dry-run]
  skill-sync.sh --sync [--node <user@host>] [--dry-run]
  skill-sync.sh --help

Syncs ~/.hermes/skills/ across known mesh nodes. When --node is omitted,
nodes are loaded from discovered-nodes.json, then mesh-nodes.conf.
USAGE
}

err_handler() {
  local line="$1"
  local code="$2"
  log ERROR "failed at line $line with exit code $code"
}

cleanup() {
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
}

trap 'err_handler "$LINENO" "$?"' ERR
trap cleanup INT TERM EXIT

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

trim() {
  local s="${1-}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s\n' "$s"
}

check_prereqs() {
  local missing=0 bin
  for bin in sqlite3 ssh scp tar find stat mktemp sort; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log ERROR "missing prerequisite: $bin"
      missing=1
    fi
  done
  (( missing == 0 )) || exit 2
}

init_state_db() {
  mkdir -p "$(dirname "$DB_PATH")"
  sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS skill_sync_state (
  node TEXT,
  skill_file TEXT,
  last_sync_ts INTEGER,
  local_mtime INTEGER,
  remote_mtime INTEGER,
  PRIMARY KEY (node, skill_file)
);
SQL
}

is_local_node() {
  local node="${1:-}"
  local host="${node#*@}"
  local short fqdn
  short="$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)"
  fqdn="$(hostname -f 2>/dev/null || true)"
  [[ "$node" == "localhost" || "$node" == "127.0.0.1" || "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "$short" || "$host" == "$fqdn" ]]
}

remote_shell() {
  local node="$1"
  shift
  ssh "${SSH_OPTS[@]}" "$node" "$@"
}

remote_has_rsync() {
  local node="$1"
  is_local_node "$node" && command -v rsync >/dev/null 2>&1 && return 0
  remote_shell "$node" 'command -v rsync >/dev/null 2>&1'
}

can_use_rsync() {
  local node="$1"
  command -v rsync >/dev/null 2>&1 && remote_has_rsync "$node"
}

load_known_nodes() {
  local seen="" raw node
  if [[ -f "$DISCOVERED_NODES_FILE" ]]; then
    while IFS= read -r raw || [[ -n "$raw" ]]; do
      node="$(trim "$raw")"
      [[ -n "$node" ]] || continue
      if [[ "$seen" != *"|$node|"* ]]; then
        printf '%s\n' "$node"
        seen="${seen}|${node}|"
      fi
    done < <(sed -nE 's/.*"(ssh_target|node|target|host|hostname|ip|IP)"[[:space:]]*:[[:space:]]*"([^"]+)".*/\2/p' "$DISCOVERED_NODES_FILE")
  elif [[ -f "$MESH_NODES_FILE" ]]; then
    while IFS= read -r raw || [[ -n "$raw" ]]; do
      raw="${raw%%#*}"
      node="$(trim "$raw")"
      [[ -n "$node" ]] || continue
      if [[ "$seen" != *"|$node|"* ]]; then
        printf '%s\n' "$node"
        seen="${seen}|${node}|"
      fi
    done < "$MESH_NODES_FILE"
  fi
}

snapshot_local() {
  mkdir -p "$SKILLS_DIR"
  (cd "$SKILLS_DIR" && find . -type f -printf '%P\t%T@\n') |
    while IFS=$'\t' read -r file mtime; do
      [[ -n "$file" ]] || continue
      printf '%s\t%s\n' "$file" "${mtime%.*}"
    done | sort
}

snapshot_remote() {
  local node="$1"
  if is_local_node "$node"; then
    snapshot_local
    return 0
  fi
  remote_shell "$node" 'mkdir -p ~/.hermes/skills && cd ~/.hermes/skills && find . -type f -printf "%P\t%T@\n"' |
    while IFS=$'\t' read -r file mtime; do
      [[ -n "$file" ]] || continue
      printf '%s\t%s\n' "$file" "${mtime%.*}"
    done | sort
}

load_snapshot_map() {
  local file="$1"
  local prefix="$2"
  local rel mtime
  while IFS=$'\t' read -r rel mtime || [[ -n "$rel" ]]; do
    [[ -n "$rel" ]] || continue
    printf -v "${prefix}[$rel]" '%s' "$mtime"
  done < "$file"
}

load_state_map() {
  local node="$1"
  local qnode rel local_mtime remote_mtime
  qnode="$(sql_quote "$node")"
  while IFS=$'\t' read -r rel local_mtime remote_mtime || [[ -n "$rel" ]]; do
    [[ -n "$rel" ]] || continue
    printf -v 'STATE_LOCAL[%s]' "$rel" '%s' "$local_mtime"
    printf -v 'STATE_REMOTE[%s]' "$rel" '%s' "$remote_mtime"
  done < <(sqlite3 -separator $'\t' "$DB_PATH" "SELECT skill_file, local_mtime, remote_mtime FROM skill_sync_state WHERE node=$qnode;")
}

collect_snapshots() {
  local node="$1"
  LOCAL_SNAPSHOT="$TMP_DIR/local.$(date +%s%N).tsv"
  REMOTE_SNAPSHOT="$TMP_DIR/remote.$(date +%s%N).tsv"
  snapshot_local > "$LOCAL_SNAPSHOT"
  snapshot_remote "$node" > "$REMOTE_SNAPSHOT"
}

detect_conflicts() {
  local node="$1"
  local backup_dir="$2"
  local ts="$3"
  local rel current_local current_remote previous_local previous_remote conflict_path

  declare -gA LOCAL_MTIMES=()
  declare -gA REMOTE_MTIMES=()
  declare -gA STATE_LOCAL=()
  declare -gA STATE_REMOTE=()
  load_snapshot_map "$LOCAL_SNAPSHOT" LOCAL_MTIMES
  load_snapshot_map "$REMOTE_SNAPSHOT" REMOTE_MTIMES
  load_state_map "$node"

  for rel in "${!LOCAL_MTIMES[@]}"; do
    [[ -n "${REMOTE_MTIMES[$rel]+x}" ]] || continue
    [[ -n "${STATE_LOCAL[$rel]+x}" && -n "${STATE_REMOTE[$rel]+x}" ]] || continue
    current_local="${LOCAL_MTIMES[$rel]}"
    current_remote="${REMOTE_MTIMES[$rel]}"
    previous_local="${STATE_LOCAL[$rel]}"
    previous_remote="${STATE_REMOTE[$rel]}"
    if [[ "$current_local" != "$previous_local" && "$current_remote" != "$previous_remote" ]]; then
      conflict_path="$backup_dir/$rel.conflict.$ts"
      mkdir -p "$(dirname "$conflict_path")"
      cp -p "$SKILLS_DIR/$rel" "$conflict_path"
      log WARN "conflict detected from $node: $rel; preserving local as $rel.conflict.$ts"
    fi
  done
}

restore_conflicts() {
  local backup_dir="$1"
  [[ -d "$backup_dir" ]] || return 0
  (cd "$backup_dir" && find . -type f -print) |
    while IFS= read -r file || [[ -n "$file" ]]; do
      file="${file#./}"
      mkdir -p "$SKILLS_DIR/$(dirname "$file")"
      cp -p "$backup_dir/$file" "$SKILLS_DIR/$file"
    done
}

update_state() {
  local node="$1"
  local now rel local_mtime remote_mtime qnode qrel
  local state_file="$TMP_DIR/state.$(date +%s%N).tsv"
  now="$(date +%s)"
  collect_snapshots "$node"
  {
    cut -f1 "$LOCAL_SNAPSHOT"
    cut -f1 "$REMOTE_SNAPSHOT"
  } | sort -u > "$state_file"

  declare -gA LOCAL_MTIMES=()
  declare -gA REMOTE_MTIMES=()
  load_snapshot_map "$LOCAL_SNAPSHOT" LOCAL_MTIMES
  load_snapshot_map "$REMOTE_SNAPSHOT" REMOTE_MTIMES

  while IFS= read -r rel || [[ -n "$rel" ]]; do
    [[ -n "$rel" ]] || continue
    local_mtime="${LOCAL_MTIMES[$rel]:-0}"
    remote_mtime="${REMOTE_MTIMES[$rel]:-0}"
    qnode="$(sql_quote "$node")"
    qrel="$(sql_quote "$rel")"
    sqlite3 "$DB_PATH" "INSERT INTO skill_sync_state(node,skill_file,last_sync_ts,local_mtime,remote_mtime) VALUES($qnode,$qrel,$now,$local_mtime,$remote_mtime) ON CONFLICT(node,skill_file) DO UPDATE SET last_sync_ts=excluded.last_sync_ts,local_mtime=excluded.local_mtime,remote_mtime=excluded.remote_mtime;"
  done < "$state_file"
}

ensure_remote_dir() {
  local node="$1"
  is_local_node "$node" && return 0
  remote_shell "$node" 'mkdir -p ~/.hermes/skills'
}

rsync_transfer() {
  local direction="$1"
  local node="$2"
  local dry_args=()
  (( DRY_RUN == 1 )) && dry_args=(--dry-run)

  if is_local_node "$node"; then
    log INFO "local node $node selected; transfer is a no-op"
    return 0
  fi

  ensure_remote_dir "$node"
  if [[ "$direction" == "push" ]]; then
    rsync -avz --delete "${dry_args[@]}" "$SKILLS_DIR/" "$node:$REMOTE_SKILLS_DIR/"
  else
    rsync -avz --delete "${dry_args[@]}" "$node:$REMOTE_SKILLS_DIR/" "$SKILLS_DIR/"
  fi
}

tar_scp_transfer() {
  local direction="$1"
  local node="$2"
  local archive remote_archive

  if (( DRY_RUN == 1 )); then
    log WARN "dry-run is not possible with tar/scp fallback; skipping $direction for $node"
    return 0
  fi
  if is_local_node "$node"; then
    log INFO "local node $node selected; transfer is a no-op"
    return 0
  fi

  archive="$TMP_DIR/skills-$direction-$(date +%s%N).tar.gz"
  remote_archive="/tmp/hermes-skills-$direction-$$.tar.gz"
  if [[ "$direction" == "push" ]]; then
    tar -C "$SKILLS_DIR" -czf "$archive" .
    scp "$archive" "$node:$remote_archive"
    remote_shell "$node" "rm -rf ~/.hermes/skills && mkdir -p ~/.hermes/skills && tar -C ~/.hermes/skills -xzf '$remote_archive' && rm -f '$remote_archive'"
  else
    remote_shell "$node" "mkdir -p ~/.hermes/skills && tar -C ~/.hermes/skills -czf '$remote_archive' ."
    scp "$node:$remote_archive" "$archive"
    remote_shell "$node" "rm -f '$remote_archive'"
    rm -rf "$SKILLS_DIR"
    mkdir -p "$SKILLS_DIR"
    tar -C "$SKILLS_DIR" -xzf "$archive"
  fi
}

transfer_tree() {
  local direction="$1"
  local node="$2"
  if can_use_rsync "$node"; then
    rsync_transfer "$direction" "$node"
  else
    log WARN "rsync unavailable locally or on $node; using tar/scp fallback"
    tar_scp_transfer "$direction" "$node"
  fi
}

prepare_conflicts_for_pull() {
  local node="$1"
  local backup_dir="$2"
  local ts="$3"
  collect_snapshots "$node"
  detect_conflicts "$node" "$backup_dir" "$ts"
}

sync_one_node() {
  local node="$1"
  local ts backup_dir
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="$TMP_DIR/conflicts-$ts"

  log INFO "$ACTION start: $node"
  case "$ACTION" in
    push)
      collect_snapshots "$node"
      detect_conflicts "$node" "$backup_dir" "$ts"
      restore_conflicts "$backup_dir"
      transfer_tree push "$node"
      (( DRY_RUN == 1 )) || update_state "$node"
      ;;
    pull)
      prepare_conflicts_for_pull "$node" "$backup_dir" "$ts"
      transfer_tree pull "$node"
      (( DRY_RUN == 1 )) || restore_conflicts "$backup_dir"
      (( DRY_RUN == 1 )) || update_state "$node"
      ;;
    sync)
      prepare_conflicts_for_pull "$node" "$backup_dir" "$ts"
      transfer_tree pull "$node"
      (( DRY_RUN == 1 )) || restore_conflicts "$backup_dir"
      transfer_tree push "$node"
      (( DRY_RUN == 1 )) || update_state "$node"
      ;;
    *)
      log ERROR "unknown action: $ACTION"
      exit 1
      ;;
  esac
  log INFO "$ACTION ok: $node"
}

main() {
  local nodes=() node failures=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --push|--pull|--sync)
        [[ -z "$ACTION" ]] || { log ERROR "choose only one of --push, --pull, --sync"; exit 1; }
        ACTION="${1#--}"
        shift
        ;;
      --node)
        [[ $# -ge 2 ]] || { log ERROR "--node requires a value"; exit 1; }
        NODE="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        log ERROR "unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done

  [[ -n "$ACTION" ]] || { usage; exit 1; }
  check_prereqs
  init_state_db
  mkdir -p "$SKILLS_DIR"
  TMP_DIR="$(mktemp -d)"

  if [[ -n "$NODE" ]]; then
    nodes=("$NODE")
  else
    while IFS= read -r node || [[ -n "$node" ]]; do
      [[ -n "$node" ]] || continue
      nodes+=("$node")
    done < <(load_known_nodes)
  fi

  if (( ${#nodes[@]} == 0 )); then
    log WARN "no known nodes found"
    return 0
  fi

  for node in "${nodes[@]}"; do
    sync_one_node "$node" || failures=$((failures + 1))
  done

  (( failures == 0 )) || return 1
}

main "$@"
