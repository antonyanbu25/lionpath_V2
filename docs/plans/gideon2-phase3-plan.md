# Gideon 2.0 — Phase 3 Implementation Plan

**Lead Architect:** Gideon
**Phase:** 3 (Final)
**Base path:** `~/.hermes/scripts/`
**State DB:** `~/.hermes/state/state.db`
**Constraints:** Bash-only, ssh/scp/sqlite3/flock/coreutils, systemd optional

---

## 0. Phase 3 Pre-flight

### 0.1 Shared assumptions (inherited from Phase 0–2)

| Asset | Path | Notes |
|---|---|---|
| State DB | `~/.hermes/state/state.db` | sqlite3, WAL mode |
| Mesh scripts | `~/.hermes/scripts/*.sh` | all `set -Eeuo pipefail` |
| Logs | `~/.hermes/logs/<script>.log` | rotated by `logrotate` if installed |
| Locks | `~/.hermes/run/*.lock` | `flock -n` |
| Mesh radio | `agent-radio-mesh.sh` | `init/join/broadcast/ledger/SSH-tail` |
| Daemons | `mesh-memory-daemon`, `node-health-daemon`, `consciousness-daemon`, `task-router-daemon` | systemd units in `~/.hermes/systemd/` |

### 0.2 New shared helpers (add to `lib/common.sh`)

```bash
# Append to ~/.hermes/scripts/lib/common.sh

require_linux_target() {        # args: user@host
  local target="$1"
  local os
  os=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$target" \
        'uname -s 2>/dev/null || echo UNKNOWN' 2>/dev/null) || return 1
  [[ "$os" == "Linux" ]] || { log "ERR" "Target $target is '$os', not Linux"; return 2; }
}

detect_pkg_mgr_remote() {       # args: user@host -> echoes "apt"|"pkg"|"yum"|"dnf"|"apk"|"" 
  local target="$1"
  ssh -o BatchMode=yes "$target" \
    'command -v apt-get >/dev/null && echo apt && exit 0;
     command -v apk     >/dev/null && echo apk  && exit 0;
     command -v dnf     >/dev/null && echo dnf  && exit 0;
     command -v yum     >/dev/null && echo yum  && exit 0;
     command -v pkg     >/dev/null && echo pkg  && exit 0;
     echo' 2>/dev/null
}

remote_uuid() {                 # args: user@host -> echoes node UUID (creates if missing)
  local target="$1"
  ssh -o BatchMode=yes "$target" \
    'uuid_file="$HOME/.hermes/state/node.uuid";
     mkdir -p "$(dirname "$uuid_file")";
     if [[ -r "$uuid_file" ]]; then cat "$uuid_file";
     else uuidgen > "$uuid_file" 2>/dev/null || cat /proc/sys/kernel/random/uuid > "$uuid_file";
          cat "$uuid_file"; fi' 2>/dev/null
}
```

### 0.3 Schema migrations (idempotent)

```bash
# ~/.hermes/scripts/lib/migrate-phase3.sh
migrate_phase3() {
  local db="$HERMES_DB"
  sqlite3 "$db" <<'SQL'
CREATE TABLE IF NOT EXISTS mesh_spawned_nodes (
  uuid            TEXT PRIMARY KEY,
  host            TEXT NOT NULL,
  ip              TEXT,
  user            TEXT,
  installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat  TEXT,
  capabilities    TEXT,           -- JSON-ish CSV: "bash,sqlite3,flock,systemd"
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|active|failed|decommissioned
  last_error      TEXT
);
CREATE TABLE IF NOT EXISTS mesh_peers (
  peer_id         TEXT PRIMARY KEY,        -- remote lead UUID
  lead_host       TEXT NOT NULL,
  peering_since   TEXT NOT NULL DEFAULT (datetime('now')),
  last_contact    TEXT,
  filter_rules    TEXT NOT NULL DEFAULT 'liveness,memory_digest',
  status          TEXT NOT NULL DEFAULT 'active',
  ssh_tunnel_pid  INTEGER
);
CREATE TABLE IF NOT EXISTS scale_test_runs (
  run_id          TEXT PRIMARY KEY,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  workload        TEXT NOT NULL,
  nodes_total     INTEGER,
  nodes_online    INTEGER,
  nodes_offline   INTEGER,
  total_work_units INTEGER,
  avg_duration_ms INTEGER,
  fastest_node    TEXT,
  slowest_node    TEXT,
  results_json    TEXT
);
SQL
}
```

---

## 1. Deliverable 1 — `autonomous-spawner.sh`

### 1.1 File path
`~/.hermes/scripts/autonomous-spawner.sh` (mode 0750)

### 1.2 Function signatures

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
# ~/.hermes/scripts/autonomous-spawner.sh
# Self-replicating node spawner. Phase 3.

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SCRIPTS_DIR="$HERMES_HOME/scripts"
LIB_DIR="$SCRIPTS_DIR/lib"
STATE_DIR="$HERMES_HOME/state"
DB="$STATE_DIR/state.db"
LOCK="$HERMES_HOME/run/autonomous-spawner.lock"
LOG="$HERMES_HOME/logs/autonomous-spawner.log"

# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

usage() { ... }                          # no args
parse_target() { # args: "$raw" -> echoes "user@host" or returns 1
  local raw="$1"
  ...
}
ensure_ssh_key() { # args: none -> ensures ~/.ssh/hermes_mesh_ed25519 exists
  ...
}
authorize_target() { # args: user@host -> ssh-copy-id with idempotency
  ...
}
install_prereqs_remote() { # args: user@host -> returns 0/1; populates $REMOTE_PKG_MGR
  ...
}
copy_mesh_scripts() { # args: user@host -> scp -r ~/.hermes/scripts user@host:~/.hermes/
  ...
}
migrate_remote_db() { # args: user@host -> runs mesh-memory.sh --migrate over ssh
  ...
}
install_systemd_units_remote() { # args: user@host -> copies units, daemon-reload, enables
  ...
}
join_mesh_remote() { # args: user@host -> agent-radio-mesh.sh join via ssh
  ...
}
register_spawned_node() { # args: uuid host ip user capabilities status
  ...                                     # INSERT OR REPLACE into mesh_spawned_nodes
}
spawn_node() { # args: raw_target -> orchestrates full bootstrap
  ...
}
bootstrap_node() { # args: raw_target -> spawn_node + start daemons + verify
  ...
}
list_nodes() { # args: none -> SELECT * FROM mesh_spawned_nodes; pretty-print
  ...
}
heartbeat_spawned() { # args: none -> ping each spawned node, update last_heartbeat
  ...
}
main() { # args: "$@" -> dispatch on flags
  ...
}
main "$@"
```

### 1.3 Key logic — `spawn_node()`

```bash
spawn_node() {
  local raw="$1" target uuid ip user caps status="pending" err=""
  target=$(parse_target "$raw")            || { err="bad target form"; register_failed "$raw" "$err"; return 1; }

  ensure_ssh_key                            || return 1
  require_linux_target "$target"           || { err="not linux or unreachable"; register_failed "$target" "$err"; return 2; }
  authorize_target "$target"               || { err="ssh key not authorized"; register_failed "$target" "$err"; return 3; }

  install_prereqs_remote "$target"         || { err="prereqs failed"; register_failed "$target" "$err"; return 4; }
  copy_mesh_scripts "$target"             || { err="scp failed";       register_failed "$target" "$err"; return 5; }
  migrate_remote_db "$target"             || { err="migrate failed";   register_failed "$target" "$err"; return 6; }
  install_systemd_units_remote "$target"   || { err="systemd failed";   register_failed "$target" "$err"; return 7; }
  join_mesh_remote "$target"              || { err="mesh join failed";  register_failed "$target" "$err"; return 8; }

  uuid=$(remote_uuid "$target")
  ip=$(ssh -o BatchMode=yes "$target" 'hostname -I 2>/dev/null | awk "{print \$1}"')
  user="${target%%@*}"
  caps=$(ssh -o BatchMode=yes "$target" \
        'echo bash,$(command -v sqlite3 >/dev/null && echo sqlite3),$(command -v flock >/dev/null && echo flock),$(command -v systemctl >/dev/null && echo systemd)')
  status="active"

  register_spawned_node "$uuid" "$target" "$ip" "$user" "$caps" "$status"
  log "INFO" "Spawned node uuid=$uuid host=$target ip=$ip caps=$caps"
  echo "{\"uuid\":\"$uuid\",\"host\":\"$target\",\"ip\":\"$ip\",\"caps\":\"$caps\"}"
}
```

### 1.4 Key logic — `install_prereqs_remote()`

```bash
install_prereqs_remote() {
  local target="$1" pm
  pm=$(detect_pkg_mgr_remote "$target")
  [[ -n "$pm" ]] || { log "ERR" "No supported package manager on $target"; return 1; }
  case "$pm" in
    apt) ssh -o BatchMode=yes "$target" \
           'sudo -n apt-get update -qq && sudo -n apt-get install -y -qq bash sqlite3 util-linux' ;;
    apk) ssh -o BatchMode=yes "$target" \
           'sudo -n apk add -q bash sqlite3 util-linux' ;;
    dnf|yum) ssh -o BatchMode=yes "$target" \
           "sudo -n $pm install -y -q bash sqlite util-linux" ;;
    pkg) ssh -o BatchMode=yes "$target" \
           'sudo -n pkg install -y bash sqlite3' ;;
    *) log "ERR" "Unsupported pkg mgr '$pm'"; return 1 ;;
  esac
}
```

### 1.5 Key logic — `install_systemd_units_remote()`

```bash
install_systemd_units_remote() {
  local target="$1"
  # Tarball the units + scripts to avoid scp -r permission drift
  tar -C "$HERMES_HOME" -czf /tmp/hermes-bootstrap.tgz scripts systemd 2>/dev/null || \
    tar -C "$HERMES_HOME" -czf /tmp/hermes-bootstrap.tgz scripts 2>/dev/null
  scp -q /tmp/hermes-bootstrap.tgz "$target:/tmp/"
  ssh -o BatchMode=yes "$target" '
    set -e
    mkdir -p ~/.hermes
    tar -C ~/.hermes -xzf /tmp/hermes-bootstrap.tgz
    rm -f /tmp/hermes-bootstrap.tgz
    if command -v systemctl >/dev/null; then
      mkdir -p ~/.config/systemd/user
      cp ~/.hermes/systemd/*.service ~/.config/systemd/user/ 2>/dev/null || true
      systemctl --user daemon-reload
      for u in mesh-memory-daemon node-health-daemon consciousness-daemon task-router-daemon; do
        systemctl --user enable --now "$u.service" 2>/dev/null || true
      done
      # Enable lingering so user units survive logout
      loginctl enable-linger "$(whoami)" 2>/dev/null || true
    fi
  '
}
```

### 1.6 Edge cases & failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Target not Linux | `require_linux_target` returns 2 | Record `status=failed`, `last_error='not_linux'`, exit 2 |
| SSH key not authorized | `authorize_target` returns non-zero | Attempt one `ssh-copy-id -i ~/.ssh/hermes_mesh_ed25519.pub`; if interactive prompt → fail with code 3 |
| No package manager | `detect_pkg_mgr_remote` echoes empty | Fail code 4 |
| sqlite3 not installable | install command returns non-zero | Fail code 4, log apt/apk output |
| Target already spawned | `SELECT uuid FROM mesh_spawned_nodes WHERE host=?` | Idempotent: re-run bootstrap, update `installed_at`, keep UUID |
| Target behind NAT (no inbound) | `join_mesh_remote` uses SSH-tail mode of `agent-radio-mesh.sh` | Mark `capabilities` with `inbound=false`; rely on tail |
| `sudo -n` not passwordless | install step fails | Log hint: configure passwordless sudo for apt, or run as root |
| Disk full on target | scp/tar fails | Trap, record `last_error='disk_full'` |
| Clock skew | `installed_at` vs remote `date` differs >300s | Warn, do not fail |

### 1.7 Testing steps

```bash
# T1.1 happy path on a fresh LXC container
./autonomous-spawner.sh --spawn ubuntu@10.0.0.42
sqlite3 ~/.hermes/state/state.db \
  "SELECT uuid,host,status,capabilities FROM mesh_spawned_nodes;"

# T1.2 idempotency
./autonomous-spawner.sh --spawn ubuntu@10.0.0.42   # second run, same UUID

# T1.3 non-Linux target (macOS host)
./autonomous-spawner.sh --spawn user@mac.local
# Expect: exit 2, status=failed, last_error contains 'not_linux'

# T1.4 unreachable host
./autonomous-spawner.sh --spawn user@10.255.255.1
# Expect: exit 1 within ConnectTimeout, status=failed

# T1.5 list
./autonomous-spawner.sh --list-nodes

# T1.6 bootstrap (full auto, starts daemons)
./autonomous-spawner.sh --bootstrap ubuntu@10.0.0.43
ssh ubuntu@10.0.0.43 'systemctl --user is-active mesh-memory-daemon'

# T1.7 heartbeat sweep
./autonomous-spawner.sh --heartbeat   # optional subcommand
```

---

## 2. Deliverable 2 — `multi-mesh-peering.sh`

### 2.1 File path
`~/.hermes/scripts/multi-mesh-peering.sh` (mode 0750)

### 2.2 Function signatures

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
# ~/.hermes/scripts/multi-mesh-peering.sh
# Bridges separate meshes without merging full state.

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SCRIPTS_DIR="$HERMES_HOME/scripts"
LIB_DIR="$SCRIPTS_DIR/lib"
DB="$HERMES_HOME/state/state.db"
LOCK="$HERMES_HOME/run/multi-mesh-peering.lock"
LOG="$HERMES_HOME/logs/multi-mesh-peering.log"
SYNC_INTERVAL="${HERMES_PEER_SYNC_INTERVAL:-60}"

source "$LIB_DIR/common.sh"

usage() { ... }
parse_peer_host() { # args: raw -> echoes user@host
  ...
}
peer_establish() { # args: user@host -> creates mesh_peers row, opens SSH tunnel
  ...
}
peer_open_tunnel() { # args: user@host local_port remote_port -> echoes pid
  ...
}
peer_register() { # args: peer_id lead_host filter_rules
  ...                                     # INSERT OR REPLACE
}
peer_unpeer() { # args: user@host -> kill tunnel, mark status=revoked
  ...
}
peer_list() { # args: none -> SELECT * FROM mesh_peers
  ...
}
peer_sync_once() { # args: peer_id -> pull memory_digest + liveness only
  ...
}
peer_sync_loop() { # args: none -> while true; do peer_sync_all; sleep $SYNC_INTERVAL; done
  ...                                     # intended for systemd unit
}
peer_sync_all() { # args: none -> iterate active peers
  ...
}
peer_forward_task() { # args: task_id peer_mesh -> explicit task forwarding
  ...                                     # uses task-routing-protocol.sh OFFER to peer
}
peer_filter_allows() { # args: filter_rules kind -> 0/1
  ...                                     # kind in: liveness, memory_digest, task_queue
}
build_memory_digest() { # args: none -> sha256 of mesh_consciousness rows
  ...                                     # SELECT ... ORDER BY id; | sha256sum
}
fetch_remote_digest() { # args: user@host -> echoes digest
  ...
}
main() { ... }
main "$@"
```

### 2.3 Key logic — `peer_establish()`

```bash
peer_establish() {
  local raw="$1" target peer_id filter="liveness,memory_digest"
  target=$(parse_peer_host "$raw") || return 1

  require_linux_target "$target" || return 2
  ensure_ssh_key
  authorize_target "$target"     || return 3

  # A peer is just another mesh session via agent-radio-mesh.sh
  ssh -o BatchMode=yes "$target" \
    "bash ~/.hermes/scripts/agent-radio-mesh.sh join --lead $HOSTNAME" \
    || { log "ERR" "Remote has no agent-radio-mesh.sh — is it a lead?"; return 4; }

  peer_id=$(remote_uuid "$target")
  peer_register "$peer_id" "$target" "$filter"

  # Open a reverse SSH tunnel so the remote lead can push to us if needed
  peer_open_tunnel "$target" 0 2222 >/dev/null || \
    log "WARN" "Tunnel failed; falling back to poll-only peering"

  log "INFO" "Peered with $target (peer_id=$peer_id)"
  echo "{\"peer_id\":\"$peer_id\",\"lead_host\":\"$target\",\"filter\":\"$filter\"}"
}
```

### 2.4 Key logic — `peer_sync_once()` (filtered bridge)

```bash
peer_sync_once() {
  local peer_id="$1" host filter
  read host filter < <(sqlite3 "$DB" \
    "SELECT lead_host,filter_rules FROM mesh_peers WHERE peer_id='$peer_id' AND status='active';")
  [[ -n "$host" ]] || return 0

  local local_digest remote_digest
  local_digest=$(build_memory_digest)

  if peer_filter_allows "$filter" "memory_digest"; then
    remote_digest=$(fetch_remote_digest "$host") || { log "WARN" "digest fetch failed"; return 1; }
    if [[ "$local_digest" != "$remote_digest" ]]; then
      # Pull only the *digest* — never raw consciousness rows
      sqlite3 "$DB" "UPDATE mesh_peers SET last_contact=datetime('now') WHERE peer_id='$peer_id';"
      log "INFO" "Peer $peer_id digest updated (delta detected)"
    fi
  fi

  if peer_filter_allows "$filter" "liveness"; then
    # Pull remote node_health summary counts only
    ssh -o BatchMode=yes "$host" \
      'sqlite3 ~/.hermes/state/state.db \
        "SELECT COUNT(*),SUM(CASE WHEN status=\"healthy\" THEN 1 ELSE 0 END) FROM mesh_node_health;"' \
      | tee "$HERMES_HOME/state/peer_${peer_id}_liveness.txt" >/dev/null || true
  fi

  # NEVER sync task_queue — autonomy preserved
  sqlite3 "$DB" "UPDATE mesh_peers SET last_contact=datetime('now') WHERE peer_id='$peer_id';"
}
```

### 2.5 Key logic — `peer_forward_task()` (explicit opt-in)

```bash
peer_forward_task() {
  local task_id="$1" peer_mesh="$2" host
  host=$(sqlite3 "$DB" \
    "SELECT lead_host FROM mesh_peers WHERE peer_id='$peer_mesh' OR lead_host='$peer_mesh';")
  [[ -n "$host" ]] || { log "ERR" "Unknown peer '$peer_mesh'"; return 1; }

  # Use existing task-routing-protocol.sh — OFFER to remote, await ASSIGN
  local task_json
  task_json=$(sqlite3 "$DB" \
    "SELECT json_object('task_id',task_id,'payload',payload,'priority',priority)
       FROM task_queue WHERE task_id='$task_id';")
  [[ -n "$task_json" ]] || { log "ERR" "Task $task_id not found"; return 2; }

  ssh -o BatchMode=yes "$host" \
    "bash ~/.hermes/scripts/task-routing-protocol.sh OFFER '$task_json'" \
    || { log "ERR" "Forward rejected by $host"; return 3; }

  sqlite3 "$DB" "UPDATE task_queue SET status='forwarded',assigned_node='$peer_mesh' WHERE task_id='$task_id';"
  log "INFO" "Forwarded task $task_id to peer $peer_mesh"
}
```

### 2.6 Edge cases

| Failure | Detection | Recovery |
|---|---|---|
| Remote is not a lead (no `agent-radio-mesh.sh`) | join returns non-zero | Fail code 4, hint: run `--bootstrap` first |
| Filter rule denies task sync | `peer_filter_allows` returns 1 | `peer_forward_task` requires explicit `--forward` |
| SSH tunnel dies | `kill -0 $pid` fails in `peer_sync_loop` | Reopen tunnel, log WARN |
| Peer clock skew | `last_contact` older than `now - 2*SYNC_INTERVAL` | Mark `status=stale`, do not delete |
| Duplicate peer | `INSERT OR REPLACE` on `peer_id` | Idempotent; updates `peering_since` only if NULL |
| Peer behind NAT | Tunnel open fails | Fall back to poll-only (we ssh out, they can't push in) |
| Filter rule typo | `peer_filter_allows` returns 0 for all kinds | Log WARN, default to `liveness` only |
| Concurrent sync | `flock -n` on `$LOCK` | Skip tick if locked |

### 2.7 Testing steps

```bash
# T2.1 establish peering between two leads (lead-A → lead-B)
./multi-mesh-peering.sh --peer ubuntu@lead-b.local
./multi-mesh-peering.sh --list-peers

# T2.2 verify NO task_queue leakage
ssh lead-b 'sqlite3 ~/.hermes/state/state.db "SELECT COUNT(*) FROM task_queue;"'
# Should equal lead-b's own queue, NOT lead-a's

# T2.3 verify memory_digest sync
sqlite3 ~/.hermes/state/state.db \
  "SELECT peer_id,last_contact FROM mesh_peers WHERE status='active';"

# T2.4 explicit forward
./multi-mesh-peering.sh --forward task-abc-123 <peer_id_or_host>

# T2.5 unpeer
./multi-mesh-peering.sh --unpeer ubuntu@lead-b.local
sqlite3 ~/.hermes/state/state.db "SELECT status FROM mesh_peers;"

# T2.6 sync loop (foreground, then Ctrl-C)
HERMES_PEER_SYNC_INTERVAL=5 ./multi-mesh-peering.sh --sync-loop
```

---

## 3. Deliverable 3 — `scale-test.sh`

### 3.1 File path
`~/.hermes/scripts/scale-test.sh` (mode 0750)

### 3.2 Function signatures

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
# ~/.hermes/scripts/scale-test.sh
# Lightweight distributed processing test — proof the mesh works.

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SCRIPTS_DIR="$HERMES_HOME/scripts"
LIB_DIR="$SCRIPTS_DIR/lib"
DB="$HERMES_HOME/state/state.db"
LOCK="$HERMES_HOME/run/scale-test.lock"
LOG="$HERMES_HOME/logs/scale-test.log"
RUN_ID="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)"
RESULTS_DIR="$HERMES_HOME/state/scale-test/$RUN_ID"

source "$LIB_DIR/common.sh"

usage() { ... }
workload_primes() { # args: none -> echoes bash snippet that counts primes < 100000
  ...                                     # writes to stdout, runs on remote
}
workload_sha256() { # args: none -> echoes bash snippet: sha256 of /usr/bin/*.sh
  ...
}
workload_fib() { # args: none -> echoes bash snippet: fib(30) iterative
  ...
}
workload_select() { # args: name -> echoes snippet or returns 1
  ...
}
enumerate_nodes() { # args: none -> echoes "uuid|user@host|kind" lines
  ...                                     # kind = spawned|peer|self
}
dispatch_to_node() { # args: uuid user@host snippet -> writes result file
  ...                                     # uses task-routing-protocol.sh OFFER
}
collect_results() { # args: none -> aggregates $RESULTS_DIR/*.json
  ...
}
compute_stats() { # args: none -> updates scale_test_runs row
  ...
}
run_workload() { # args: workload_name -> orchestrates dispatch+collect+stats
  ...
}
show_status() { # args: none -> SELECT FROM scale_test_runs ORDER BY started_at DESC LIMIT 10
  ...
}
show_nodes() { # args: none -> enumerate_nodes pretty-print
  ...
}
main() { ... }
main "$@"
```

### 3.3 Key logic — `workload_primes()`

```bash
workload_primes() {
  cat <<'SNIPPET'
set -e
n=100000
count=0
for ((i=2;i<n;i++)); do
  is_prime=1
  for ((j=2;j*j<=i;j++)); do
    if (( i%j==0 )); then is_prime=0; break; fi
  done
  (( is_prime )) && ((count++))
done
echo "primes=$count"
SNIPPET
}
```

### 3.4 Key logic — `dispatch_to_node()`

```bash
dispatch_to_node() {
  local uuid="$1" target="$2" snippet="$3"
  local out="$RESULTS_DIR/$uuid.json"
  local t0 t1 rc
  t0=$(date +%s%3N)
  # Use task-routing-protocol.sh OFFER over the mesh; fall back to direct ssh
  if [[ -x "$SCRIPTS_DIR/task-routing-protocol.sh" ]]; then
    local task_id="scale-$RUN_ID-$uuid"
    local payload
    payload=$(jq -n --arg s "$snippet" --arg t "$task_id" \
      '{task_id:$t, payload:$s, priority:"low", ttl:120}' 2>/dev/null) \
      || payload="{\"task_id\":\"$task_id\",\"payload\":\"$snippet\",\"priority\":\"low\"}"
    "$SCRIPTS_DIR/task-routing-protocol.sh" OFFER "$payload" "$uuid" >/dev/null 2>&1 \
      || { log "WARN" "OFFER failed for $uuid, falling back to ssh"; ssh_dispatch "$uuid" "$target" "$snippet" "$out" "$t0"; return; }
    # Poll for RESULT
    for _ in $(seq 1 60); do
      if "$SCRIPTS_DIR/task-routing-protocol.sh" RESULT "$task_id" 2>/dev/null >"$out.tmp"; then
        t1=$(date +%s%3N)
        printf '{"uuid":"%s","host":"%s","rc":0,"duration_ms":%d,"output":%s}\n' \
          "$uuid" "$target" "$((t1-t0))" "$(cat "$out.tmp")" > "$out"
        return
      fi
      sleep 1
    done
    # Timeout
    t1=$(date +%s%3N)
    printf '{"uuid":"%s","host":"%s","rc":124,"duration_ms":%d,"output":""}\n' \
      "$uuid" "$target" "$((t1-t0))" > "$out"
  else
    ssh_dispatch "$uuid" "$target" "$snippet" "$out" "$t0"
  fi
}

ssh_dispatch() {  # fallback when task-router absent
  local uuid="$1" target="$2" snippet="$3" out="$4" t0="$5" t1 rc
  local tmp
  tmp=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$target" "bash -s" <<<"$snippet" 2>&1) ; rc=$?
  t1=$(date +%s%3N)
  printf '{"uuid":"%s","host":"%s","rc":%d,"duration_ms":%d,"output":%s}\n' \
    "$uuid" "$target" "$rc" "$((t1-t0))" "$(printf '%s' "$tmp" | jq -Rs . 2>/dev/null || printf '"%s"' "$tmp")" > "$out"
}
```

### 3.5 Key logic — `run_workload()`

```bash
run_workload() {
  local wl="$1" snippet nodes_total=0 nodes_online=0 nodes_offline=0
  snippet=$(workload_select "$wl") || { log "ERR" "Unknown workload '$wl'"; return 1; }
  mkdir -p "$RESULTS_DIR"

  # Fan out in parallel — bounded by 16 concurrent ssh
  local pids=() line uuid target kind
  while IFS='|' read -r uuid target kind; do
    [[ -n "$uuid" ]] || continue
    nodes_total=$((nodes_total+1))
    ( dispatch_to_node "$uuid" "$target" "$snippet" ) &
    pids+=($!)
    (( ${#pids[@]} >= 16 )) && { wait -n; pids=("${pids[@]:1}"); }
  done < <(enumerate_nodes)
  wait

  # Collect
  local f dur fastest="" slowest="" sum=0 n=0 max=0 min=999999999
  for f in "$RESULTS_DIR"/*.json; do
    [[ -r "$f" ]] || continue
    local rc
    rc=$(jq -r '.rc' "$f" 2>/dev/null || echo 1)
    if (( rc==0 )); then
      nodes_online=$((nodes_online+1))
      dur=$(jq -r '.duration_ms' "$f")
      sum=$((sum+dur)); n=$((n+1))
      (( dur<min )) && { min=$dur; fastest=$(jq -r '.uuid' "$f"); }
      (( dur>max )) && { max=$dur; slowest=$(jq -r '.uuid' "$f"); }
    else
      nodes_offline=$((nodes_offline+1))
    fi
  done

  local avg=0
  (( n>0 )) && avg=$((sum/n))

  sqlite3 "$DB" <<SQL
INSERT INTO scale_test_runs (run_id,finished_at,workload,nodes_total,nodes_online,nodes_offline,
                             total_work_units,avg_duration_ms,fastest_node,slowest_node,results_json)
VALUES ('$RUN_ID',datetime('now'),'$wl',$nodes_total,$nodes_online,$nodes_offline,
        $n,$avg,'$fastest','$slowest','');
SQL

  echo "run_id=$RUN_ID workload=$wl"
  echo "nodes_total=$nodes_total nodes_online=$nodes_online nodes_offline=$nodes_offline"
  echo "total_work_units=$n avg_duration_ms=$avg"
  echo "fastest_node=$fastest (${min}ms) slowest_node=$slowest (${max}ms)"
}
```

### 3.6 Key logic — `enumerate_nodes()`

```bash
enumerate_nodes() {
  # Self first
  local self_uuid
  self_uuid=$(cat "$HERMES_HOME/state/node.uuid" 2>/dev/null || remote_uuid localhost)
  echo "$self_uuid|localhost|self"

  # Spawned nodes
  sqlite3 -separator '|' "$DB" \
    "SELECT uuid, host FROM mesh_spawned_nodes WHERE status='active';" \
    | while IFS='|' read -r u h; do echo "$u|$h|spawned"; done

  # Peered leads (run their own scale-test internally — we just ping)
  sqlite3 -separator '|' "$DB" \
    "SELECT peer_id, lead_host FROM mesh_peers WHERE status='active';" \
    | while IFS='|' read -r u h; do echo "$u|$h|peer"; done
}
```

### 3.7 Edge cases

| Failure | Detection | Recovery |
|---|---|---|
| Node offline mid-run | ssh returns non-zero / RESULT poll times out | Record `rc!=0`, count as offline |
| `jq` not installed | `command -v jq` empty | Fall back to `python3 -c`? No — use `awk`/`sed` JSON builder; or skip JSON and use TSV |
| `date +%s%3N` unsupported (BSD) | echoes literal `%3N` | Fallback: `date +%s` × 1000 |
| All nodes offline | `nodes_online==0` | Exit code 2, log "mesh unavailable" |
| Partial completion | Some `.json` files missing | `for f in *.json` skips missing gracefully |
| Concurrent runs | `flock -n $LOCK` | Reject with "scale-test already running" |
| Peer doesn't support `task-routing-protocol.sh` | OFFER fails | Fall back to `ssh_dispatch` |
| Workload OOMs remote | rc=137 | Recorded as offline, not crash of orchestrator |
| Clock skew between nodes | duration_ms negative | Clamp to 0, log WARN |

### 3.8 Testing steps

```bash
# T3.1 enumerate
./scale-test.sh --nodes

# T3.2 single workload
./scale-test.sh --run primes
./scale-test.sh --run sha256
./scale-test.sh --run fib

# T3.3 status
./scale-test.sh --status

# T3.4 with 0 nodes online (kill all daemons first)
systemctl --user stop mesh-*
./scale-test.sh --run primes
# Expect: nodes_online=0, exit 2

# T3.5 mixed mesh: 3 spawned + 1 peer
./autonomous-spawner.sh --bootstrap ubuntu@n1
./autonomous-spawner.sh --bootstrap ubuntu@n2
./autonomous-spawner.sh --bootstrap ubuntu@n3
./multi-mesh-peering.sh --peer ubuntu@peer-lead
./scale-test.sh --run primes
# Expect: nodes_total >= 5 (self + 3 spawned + 1 peer)

# T3.6 concurrent run rejection
( ./scale-test.sh --run primes & ) ; sleep 0.2
./scale-test.sh --run sha256
# Expect: second invocation exits with "already running"
```

---

## 4. Cross-cutting concerns

### 4.1 New systemd units (optional)

```
~/.hermes/systemd/hermes-peer-sync.service
~/.hermes/systemd/hermes-peer-sync.timer   # OnBootSec=30s, OnUnitActiveSec=60s
~/.hermes/systemd/hermes-spawner-heartbeat.timer  # OnCalendar=*:0/5
```

`hermes-peer-sync.service`:
```ini
[Unit]
Description=Hermes multi-mesh peer sync (one-shot)
After=network-online.target

[Service]
Type=oneshot
ExecStart=%h/.hermes/scripts/multi-mesh-peering.sh --sync-once-all
```

### 4.2 Trap / logging convention (consistent with Phase 0–2)

```bash
trap 'rc=$?; log "ERR" "$0 line $LINENO rc=$rc"; exit $rc' ERR
trap 'log "INFO" "$0 received SIGINT"; cleanup; exit 130' INT
trap 'log "INFO" "$0 received SIGTERM"; cleanup; exit 143' TERM
```

### 4.3 State DB final schema additions (Phase 3)

```sql
-- All CREATE TABLE IF NOT EXISTS; safe to re-run.
mesh_spawned_nodes (uuid PK, host, ip, user, installed_at, last_heartbeat,
                    capabilities, status, last_error)
mesh_peers         (peer_id PK, lead_host, peering_since, last_contact,
                    filter_rules, status, ssh_tunnel_pid)
scale_test_runs    (run_id PK, started_at, finished_at, workload,
                    nodes_total, nodes_online, nodes_offline,
                    total_work_units, avg_duration_ms,
                    fastest_node, slowest_node, results_json)
```

### 4.4 Rollout order

1. Apply `lib/migrate-phase3.sh` (idempotent schema).
2. Append helpers to `lib/common.sh`.
3. Install `autonomous-spawner.sh` → smoke test T1.1.
4. Install `multi-mesh-peering.sh` → smoke test T2.1.
5. Install `scale-test.sh` → smoke test T3.2.
6. Enable optional systemd timers.
7. Final acceptance: T3.5 (mixed mesh) passes with `nodes_online >= 5`.

### 4.5 Acceptance criteria (Phase 3 = done)

- [ ] `autonomous-spawner.sh --bootstrap <target>` produces an active mesh node in <90s.
- [ ] `mesh_spawned_nodes` row exists with correct UUID, IP, capabilities.
- [ ] `multi-mesh-peering.sh --peer` establishes a peer without copying `task_queue`.
- [ ] `--forward` is the *only* path that moves a task across meshes.
- [ ] `scale-test.sh --run primes` reports `nodes_online`, `avg_duration_ms`, `fastest_node`, `slowest_node`.
- [ ] All scripts pass `shellcheck -S warning`.
- [ ] All scripts use `set -Eeuo pipefail`, `log()`, `check_prereqs()`, `trap`.
- [ ] No python/node dependencies introduced.

---

**End of Phase 3 plan.** On approval, implementation proceeds in the order: schema migration → spawner → peering → scale-test, with smoke tests after each.
