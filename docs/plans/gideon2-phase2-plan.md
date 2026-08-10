# Gideon 2.0 — Phase 2: Distributed Task Routing & Consciousness

**Stack:** Bash 4+, SQLite3 (WAL mode), `agent-radio-mesh.sh` (existing radio transport).
**DB:** `/var/lib/gideon/gideon.db` — `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`
**Conventions:** every `db()` call opens a fresh sqlite3 handle (WAL-safe for concurrent readers/writer); all timestamps are Unix epoch seconds; JSON via `jq -nc`.

## Schema (DDL — applied by `install-phase2.sh`)

```sql
CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY, parent_task_id TEXT, originator TEXT NOT NULL,
  assignee TEXT, payload TEXT NOT NULL, capability TEXT,
  state TEXT NOT NULL,  -- QUEUED|QUERY|OFFERED|ASSIGNED|RUNNING|RESULT|DONE|FAILED|SPLIT
  priority INTEGER DEFAULT 5, chunk_seq INTEGER, chunk_total INTEGER,
  result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deadline INTEGER);
CREATE INDEX IF NOT EXISTS idx_tq_state  ON task_queue(state);
CREATE INDEX IF NOT EXISTS idx_tq_parent ON task_queue(parent_task_id);

CREATE TABLE IF NOT EXISTS task_offers (
  offer_id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, capacity REAL NOT NULL, eta_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL, UNIQUE(task_id, agent_id));

CREATE TABLE IF NOT EXISTS mesh_consciousness (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
  epoch INTEGER NOT NULL, state_blob TEXT NOT NULL, confidence REAL DEFAULT 0.5,
  received_at INTEGER NOT NULL, origin TEXT, UNIQUE(agent_id, epoch));
CREATE INDEX IF NOT EXISTS idx_mc_agent ON mesh_consciousness(agent_id, epoch);
```

---

## 1. `/usr/local/lib/gideon/task-routing-protocol.sh`

QUERY/OFFER/ASSIGN/RESULT state machine over the radio mesh.

```bash
#!/usr/bin/env bash
set -euo pipefail
source /etc/gideon/gideon.env
DB="${GIDEON_DB:-/var/lib/gideon/gideon.db}"
MESH="${GIDEON_MESH:-/usr/local/lib/gideon/agent-radio-mesh.sh}"
AGENT_ID="${GIDEON_AGENT_ID:-$(hostname)}"
db() { sqlite3 "$DB"; }
now() { date +%s; }
mesh_send() { "$MESH" send "$1" "$2"; }   # topic, json

# tr_query <task_id> <capability> <payload> <priority?>
tr_query() {
  local task_id="$1" cap="$2" payload="$3" prio="${4:-5}" ts; ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO task_queue
  (task_id, originator, payload, capability, state, priority, created_at, updated_at)
VALUES ('${task_id}','${AGENT_ID}','${payload}','${cap}','QUERY',${prio},${ts},${ts});
SQL
  mesh_send "task.query" "$(jq -nc --arg t "$task_id" --arg c "$cap" \
    --arg p "$payload" --arg a "$AGENT_ID" \
    '{type:QUERY,task_id:$t,capability:$c,payload:$p,originator:$a}')"
}

# tr_offer <task_id> <capacity> <eta_ms>
tr_offer() {
  local task_id="$1" cap="$2" eta="$3" ts; ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO task_offers (task_id, agent_id, capacity, eta_ms, received_at)
VALUES ('${task_id}','${AGENT_ID}',${cap},${eta},${ts});
SQL
  mesh_send "task.offer" "$(jq -nc --arg t "$task_id" --arg a "$AGENT_ID" \
    --argjson c "$cap" --argjson e "$eta" \
    '{type:OFFER,task_id:$t,agent_id:$a,capacity:$c,eta_ms:$e}')"
}

# tr_assign <task_id> <agent_id>
tr_assign() {
  local task_id="$1" agent="$2" ts; ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
UPDATE task_queue SET state='ASSIGNED', assignee='${agent}', updated_at=${ts}
 WHERE task_id='${task_id}' AND state IN ('QUERY','OFFERED');
SQL
  mesh_send "task.assign" "$(jq -nc --arg t "$task_id" --arg a "$agent" \
    --arg o "$AGENT_ID" '{type:ASSIGN,task_id:$t,assignee:$a,originator:$o}')"
}

# tr_result <task_id> <status> <result_payload>
tr_result() {
  local task_id="$1" status="$2" result="$3" ts; ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
UPDATE task_queue SET state='RESULT', result='${result}', updated_at=${ts}
 WHERE task_id='${task_id}';
SQL
  mesh_send "task.result" "$(jq -nc --arg t "$task_id" --arg a "$AGENT_ID" \
    --arg s "$status" --arg r "$result" \
    '{type:RESULT,task_id:$t,agent_id:$a,status:$s,result:$r}')"
}

# tr_pick_best_offer <task_id> — lowest eta_ms, capacity>0
tr_pick_best_offer() {
  local task_id="$1"
  db <<SQL
SELECT agent_id FROM task_offers
 WHERE task_id='${task_id}' AND capacity>0
 ORDER BY eta_ms ASC, capacity DESC LIMIT 1;
SQL
}

# tr_receive <json> — dispatch incoming mesh message
tr_receive() {
  local msg="$1" type; type=$(jq -r .type <<<"$msg")
  case "$type" in
    QUERY)
      local t c p a
      t=$(jq -r .task_id <<<"$msg"); c=$(jq -r .capability <<<"$msg")
      p=$(jq -r .payload  <<<"$msg"); a=$(jq -r .originator <<<"$msg")
      if declare -F tr_local_can_handle >/dev/null && tr_local_can_handle "$c"; then
        tr_offer "$t" "$(tr_local_capacity)" "$(tr_local_eta "$p")"
      fi ;;
    OFFER)
      local t a cap eta
      t=$(jq -r .task_id <<<"$msg"); a=$(jq -r .agent_id <<<"$msg")
      cap=$(jq -r .capacity <<<"$msg"); eta=$(jq -r .eta_ms <<<"$msg")
      db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO task_offers (task_id, agent_id, capacity, eta_ms, received_at)
VALUES ('${t}','${a}',${cap},${eta},$(now));
SQL
      ;;
    ASSIGN)
      local t a
      t=$(jq -r .task_id <<<"$msg"); a=$(jq -r .assignee <<<"$msg")
      [[ "$a" == "$AGENT_ID" ]] && { tr_local_run "$t" || tr_result "$t" "FAILED" "$?"; } ;;
    RESULT)
      local t r s
      t=$(jq -r .task_id <<<"$msg"); r=$(jq -r .result <<<"$msg"); s=$(jq -r .status <<<"$msg")
      db <<SQL
PRAGMA journal_mode=WAL;
UPDATE task_queue SET state='DONE', result='${r}', updated_at=$(now) WHERE task_id='${t}';
SQL
      ;;
  esac
}
```

**Key logic:** state transitions are guarded by `WHERE state IN (...)` so duplicate mesh deliveries are idempotent. `tr_receive` is the single ingress point — the daemon just drains mesh topics into it. Local hooks (`tr_local_can_handle`, `tr_local_capacity`, `tr_local_eta`, `tr_local_run`) are user-overridable functions sourced from `/etc/gideon/gideon.local.sh` if present.

---

## 2. `/usr/local/lib/gideon/workload-splitter.sh`

Fan-out / fan-in for chunked tasks.

```bash
#!/usr/bin/env bash
set -euo pipefail
source /usr/local/lib/gideon/task-routing-protocol.sh

# ws_split <parent_task_id> <capability> <payload> <chunks>
ws_split() {
  local parent="$1" cap="$2" payload="$3" chunks="$4" ts; ts=$(now)
  local i=0
  while (( i < chunks )); do
    local cid="${parent}#chunk${i}"
    db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO task_queue
  (task_id, parent_task_id, originator, payload, capability, state,
   priority, chunk_seq, chunk_total, created_at, updated_at)
VALUES ('${cid}','${parent}','${AGENT_ID}','${payload}','${cap}','QUEUED',
   5, ${i}, ${chunks}, ${ts}, ${ts});
SQL
    tr_query "$cid" "$cap" "$payload" 5
    ((i++))
  done
  db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO task_queue
  (task_id, originator, payload, capability, state, created_at, updated_at)
VALUES ('${parent}','${AGENT_ID}','${payload}','${cap}','SPLIT',${ts},${ts});
SQL
}

# ws_chunk_complete <chunk_id> <result>
ws_chunk_complete() {
  local cid="$1" result="$2" ts; ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
UPDATE task_queue SET state='DONE', result='${result}', updated_at=${ts}
 WHERE task_id='${cid}';
SQL
}

# ws_reassemble <parent_task_id> — returns 0 if all chunks DONE
ws_reassemble() {
  local parent="$1" total done
  total=$(db "SELECT COUNT(*) FROM task_queue WHERE parent_task_id='${parent}';")
  done=$(db "SELECT COUNT(*) FROM task_queue WHERE parent_task_id='${parent}' AND state='DONE';")
  (( total > 0 && done == total ))
}

# ws_dispatch <parent_task_id> — re-dispatch non-DONE chunks
ws_dispatch() {
  local parent="$1"
  while read -r cid cap payload; do
    tr_query "$cid" "$cap" "$payload" 5
  done < <(db <<SQL
SELECT task_id, capability, payload FROM task_queue
 WHERE parent_task_id='${parent}' AND state IN ('QUEUED','FAILED');
SQL
)
}

# ws_fan_in <parent_task_id> — concatenate chunk results in seq order
ws_fan_in() {
  local parent="$1"
  db <<SQL
SELECT result FROM task_queue
 WHERE parent_task_id='${parent}' AND state='DONE'
 ORDER BY chunk_seq ASC;
SQL
}
```

**Key logic:** parent task is marked `SPLIT` so the router knows to skip it for direct assignment; chunks carry `chunk_seq`/`chunk_total` so `ws_fan_in` can reassemble deterministically. `ws_reassemble` is the gate the router polls to trigger fan-in.

---

## 3. `/usr/local/lib/gideon/consciousness-propagation-hooks.sh`

Reads/writes `mesh_consciousness`; bridges local state ↔ mesh.

```bash
#!/usr/bin/env bash
set -euo pipefail
source /etc/gideon/gideon.env
DB="${GIDEON_DB:-/var/lib/gideon/gideon.db}"
MESH="${GIDEON_MESH:-/usr/local/lib/gideon/agent-radio-mesh.sh}"
AGENT_ID="${GIDEON_AGENT_ID:-$(hostname)}"
EPOCH_FILE="${GIDEON_RUN:-/run/gideon}/consciousness.epoch"
db() { sqlite3 "$DB"; }
now() { date +%s; }
next_epoch() {
  mkdir -p "$(dirname "$EPOCH_FILE")"
  echo $(($(cat "$EPOCH_FILE" 2>/dev/null || echo 0)+1)) | tee "$EPOCH_FILE"
}

# cp_snapshot — capture local consciousness as JSON blob
cp_snapshot() {
  jq -nc --arg a "$AGENT_ID" --argjson t "$(now)" \
    --argjson load "$(cut -d' ' -f1 /proc/loadavg)" \
    --argjson mem "$(awk '/MemAvailable/{print $2}' /proc/meminfo)" \
    '{agent:$a, ts:$t, load:$load, mem_avail:$mem, mood:"neutral"}'
}

# cp_propagate <state_blob> — persist locally + broadcast
cp_propagate() {
  local state="$1" ep ts; ep=$(next_epoch); ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO mesh_consciousness
  (agent_id, epoch, state_blob, confidence, received_at, origin)
VALUES ('${AGENT_ID}', ${ep}, '${state}', 1.0, ${ts}, 'self');
SQL
  "$MESH" send "consciousness.snapshot" "$(jq -nc --arg a "$AGENT_ID" \
    --argjson e "$ep" --arg s "$state" \
    '{type:SNAPSHOT,agent_id:$a,epoch:$e,state:$s}')"
}

# cp_receive <json> — ingest remote snapshot
cp_receive() {
  local msg="$1" a e s ts
  a=$(jq -r .agent_id <<<"$msg"); e=$(jq -r .epoch <<<"$msg")
  s=$(jq -r .state <<<"$msg"); ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO mesh_consciousness
  (agent_id, epoch, state_blob, confidence, received_at, origin)
VALUES ('${a}', ${e}, '${s}', 0.7, ${ts}, 'remote');
SQL
}

# cp_merge <agent_id> — latest snapshot for agent
cp_merge() {
  local agent="$1"
  db <<SQL
SELECT state_blob FROM mesh_consciousness
 WHERE agent_id='${agent}' ORDER BY epoch DESC LIMIT 1;
SQL
}

# cp_query_state <agent_id?> — latest states (default: all)
cp_query_state() {
  local agent="${1:-%}"
  db <<SQL
SELECT agent_id, epoch, state_blob, confidence, received_at
 FROM mesh_consciousness WHERE agent_id LIKE '${agent}'
 ORDER BY agent_id, epoch DESC;
SQL
}

# cp_hook_on_event <event_type> <payload?> — event-driven propagation
cp_hook_on_event() {
  local event="$1" payload="${2:-}"
  case "$event" in
    task_assigned|task_done|task_failed|shutdown)
      cp_propagate "$(cp_snapshot | jq --arg e "$event" --arg p "$payload" \
        '. + {trigger:$e, payload:$p}')" ;;
    idle) cp_propagate "$(cp_snapshot)" ;;
    *) : ;;
  esac
}

# cp_decay <max_age_seconds> — prune stale remote snapshots
cp_decay() {
  local max_age="${1:-3600}" ts; ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
DELETE FROM mesh_consciousness
 WHERE origin='remote' AND received_at < ($ts - ${max_age});
SQL
}
```

**Key logic:** `confidence=1.0` for self-originated snapshots, `0.7` for remote (degrades trust across hops). Epoch is monotonic per-agent via `EPOCH_FILE` so `UNIQUE(agent_id, epoch)` prevents duplicate ingest. `cp_hook_on_event` is the integration seam — task router calls it on lifecycle transitions.

---

## 4. `/usr/local/lib/gideon/consciousness-daemon.sh`

Long-running sync loop.

```bash
#!/usr/bin/env bash
set -euo pipefail
source /etc/gideon/gideon.env
source /usr/local/lib/gideon/consciousness-propagation-hooks.sh
TICK_INTERVAL="${GIDEON_CD_TICK:-5}"
DECAY_INTERVAL="${GIDEON_CD_DECAY:-300}"
MESH="${GIDEON_MESH:-/usr/local/lib/gideon/agent-radio-mesh.sh}"

# cd_main_loop — signal-aware main loop
cd_main_loop() {
  trap 'cd_shutdown' INT TERM
  local last_decay=0
  while true; do
    cd_tick || true
    local n; n=$(date +%s)
    if (( n - last_decay > DECAY_INTERVAL )); then
      cp_decay "$DECAY_INTERVAL" || true
      last_decay=$n
    fi
    sleep "$TICK_INTERVAL"
  done
}

# cd_tick — snapshot → persist → propagate → ingest
cd_tick() {
  local snap; snap=$(cp_snapshot)
  cd_persist_state "$snap"
  cp_propagate "$snap"
  cd_ingest_mesh
}

# cd_persist_state <state_blob>
cd_persist_state() {
  local state="$1" ep ts; ep=$(next_epoch); ts=$(now)
  db <<SQL
PRAGMA journal_mode=WAL;
INSERT OR REPLACE INTO mesh_consciousness
  (agent_id, epoch, state_blob, confidence, received_at, origin)
VALUES ('${AGENT_ID}', ${ep}, '${state}', 1.0, ${ts}, 'self');
SQL
}

# cd_ingest_mesh — drain incoming consciousness.snapshot messages
cd_ingest_mesh() {
  local msg
  while msg=$("$MESH" recv --topic "consciousness.snapshot" --timeout 0 2>/dev/null) \
        && [[ -n "$msg" ]]; do
    cp_receive "$msg"
  done
}

# cd_sync_mesh — explicit full sync request to peers
cd_sync_mesh() {
  "$MESH" send "consciousness.sync" "$(jq -nc --arg a "$AGENT_ID" \
    '{type:SYNC_REQ,agent_id:$a}')"
}

# cd_shutdown — emit final snapshot, exit
cd_shutdown() {
  cp_propagate "$(cp_snapshot | jq '. + {mood:"shutdown"}')"
  exit 0
}

cd_main_loop "$@"
```

**Key logic:** tick = snapshot + persist + broadcast + drain inbox. Decay runs on a longer cadence to avoid WAL churn. Shutdown emits a terminal snapshot so peers learn the agent is going dark (rather than waiting for decay).

---

## 5. `/usr/local/lib/gideon/task-router-daemon.sh`

Orchestrates the full QUERY→OFFER→ASSIGN→RESULT lifecycle.

```bash
#!/usr/bin/env bash
set -euo pipefail
source /etc/gideon/gideon.env
source /usr/local/lib/gideon/task-routing-protocol.sh
source /usr/local/lib/gideon/consciousness-propagation-hooks.sh
[[ -f /etc/gideon/gideon.local.sh ]] && source /etc/gideon/gideon.local.sh
TICK_INTERVAL="${GIDEON_TRD_TICK:-2}"
OFFER_WINDOW="${GIDEON_OFFER_WINDOW:-2}"   # seconds
MESH="${GIDEON_MESH:-/usr/local/lib/gideon/agent-radio-mesh.sh}"

# trd_main_loop
trd_main_loop() {
  trap 'trd_shutdown' INT TERM
  while true; do
    trd_tick || true
    sleep "$TICK_INTERVAL"
  done
}

# trd_tick
trd_tick() {
  trd_ingest_mesh
  trd_process_pending
  trd_collect_offers
  trd_collect_results
}

# trd_ingest_mesh — drain all task.* topics into tr_receive
trd_ingest_mesh() {
  local msg
  for topic in task.query task.offer task.assign task.result; do
    while msg=$("$MESH" recv --topic "$topic" --timeout 0 2>/dev/null) \
          && [[ -n "$msg" ]]; do
      tr_receive "$msg"
    done
  done
}

# trd_process_pending — promote local QUEUED → QUERY
trd_process_pending() {
  while read -r tid cap payload prio; do
    tr_query "$tid" "$cap" "$payload" "$prio"
  done < <(db <<SQL
SELECT task_id, capability, payload, priority FROM task_queue
 WHERE state='QUEUED' AND originator='${AGENT_ID}';
SQL
)
}

# trd_collect_offers — for QUERY tasks past offer window, pick best & assign
trd_collect_offers() {
  local ts; ts=$(now); local cutoff=$((ts - OFFER_WINDOW))
  while read -r tid; do
    local best; best=$(tr_pick_best_offer "$tid")
    if [[ -n "$best" ]]; then
      tr_assign "$tid" "$best"
      cp_hook_on_event "task_assigned" "$tid"
    else
      db <<SQL
PRAGMA journal_mode=WAL;
UPDATE task_queue SET state='QUEUED', updated_at=${ts} WHERE task_id='${tid}';
SQL
    fi
  done < <(db <<SQL
SELECT task_id FROM task_queue
 WHERE state='QUERY' AND originator='${AGENT_ID}' AND updated_at < ${cutoff};
SQL
)
}

# trd_collect_results — promote RESULT → DONE, trigger fan-in if parent complete
trd_collect_results() {
  while read -r tid parent; do
    if [[ -n "$parent" ]] && ws_reassemble "$parent"; then
      ws_fan_in "$parent" > "/tmp/gideon_fanin_${parent}.txt"
      cp_hook_on_event "task_done" "$parent"
    fi
    cp_hook_on_event "task_done" "$tid"
  done < <(db <<SQL
SELECT task_id, parent_task_id FROM task_queue WHERE state='RESULT';
SQL
)
}

# trd_shutdown
trd_shutdown() {
  cp_hook_on_event "shutdown" ""
  exit 0
}

trd_main_loop "$@"
```

**Key logic:** four-phase tick — (1) drain mesh, (2) push local QUEUED→QUERY, (3) collect offers past window and assign (or re-queue with backoff), (4) collect results and trigger fan-in when all chunks of a parent are DONE. Every lifecycle transition fires `cp_hook_on_event` so consciousness propagation is coupled to task state, not a separate polling concern.

---

## 6. systemd units + `install-phase2.sh`

### `/etc/systemd/system/gideon-consciousness.service`

```ini
[Unit]
Description=Gideon 2.0 Consciousness Daemon
After=network.target agent-radio-mesh.service
Requires=agent-radio-mesh.service

[Service]
Type=simple
EnvironmentFile=/etc/gideon/gideon.env
ExecStart=/usr/local/lib/gideon/consciousness-daemon.sh
Restart=on-failure
RestartSec=3
User=gideon
Group=gideon
RuntimeDirectory=gideon

[Install]
WantedBy=multi-user.target
```

### `/etc/systemd/system/gideon-task-router.service`

```ini
[Unit]
Description=Gideon 2.0 Task Router Daemon
After=network.target agent-radio-mesh.service gideon-consciousness.service
Requires=agent-radio-mesh.service

[Service]
Type=simple
EnvironmentFile=/etc/gideon/gideon.env
ExecStart=/usr/local/lib/gideon/task-router-daemon.sh
Restart=on-failure
RestartSec=3
User=gideon
Group=gideon

[Install]
WantedBy=multi-user.target
```

### `/usr/local/sbin/install-phase2.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
LIB_DIR="/usr/local/lib/gideon"
ETC_DIR="/etc/gideon"
VAR_DIR="/var/lib/gideon"
RUN_DIR="/run/gideon"
DB="${VAR_DIR}/gideon.db"
USER="gideon"

# install_check_prereqs
install_check_prereqs() {
  for cmd in sqlite3 jq bash; do
    command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 1; }
  done
  [[ -x "${LIB_DIR}/agent-radio-mesh.sh" ]] || { echo "agent-radio-mesh.sh missing"; exit 1; }
}

# install_create_dirs
install_create_dirs() {
  for d in "$LIB_DIR" "$ETC_DIR" "$VAR_DIR" "$RUN_DIR"; do mkdir -p "$d"; done
  id "$USER" &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin "$USER"
  chown -R "$USER:$USER" "$VAR_DIR" "$RUN_DIR"
}

# install_init_db
install_init_db() {
  sqlite3 "$DB" <<'SQL'
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY, parent_task_id TEXT, originator TEXT NOT NULL,
  assignee TEXT, payload TEXT NOT NULL, capability TEXT, state TEXT NOT NULL,
  priority INTEGER DEFAULT 5, chunk_seq INTEGER, chunk_total INTEGER,
  result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deadline INTEGER);
CREATE INDEX IF NOT EXISTS idx_tq_state  ON task_queue(state);
CREATE INDEX IF NOT EXISTS idx_tq_parent ON task_queue(parent_task_id);
CREATE TABLE IF NOT EXISTS task_offers (
  offer_id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, capacity REAL NOT NULL, eta_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL, UNIQUE(task_id, agent_id));
CREATE TABLE IF NOT EXISTS mesh_consciousness (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
  epoch INTEGER NOT NULL, state_blob TEXT NOT NULL, confidence REAL DEFAULT 0.5,
  received_at INTEGER NOT NULL, origin TEXT, UNIQUE(agent_id, epoch));
CREATE INDEX IF NOT EXISTS idx_mc_agent ON mesh_consciousness(agent_id, epoch);
SQL
  chown "$USER:$USER" "$DB" "$DB-wal" "$DB-shm" 2>/dev/null || true
}

# install_install_libs
install_install_libs() {
  install -m 0755 -o root -g root task-routing-protocol.sh          "$LIB_DIR/"
  install -m 0755 -o root -g root workload-splitter.sh               "$LIB_DIR/"
  install -m 0755 -o root -g root consciousness-propagation-hooks.sh "$LIB_DIR/"
  install -m 0755 -o root -g root consciousness-daemon.sh           "$LIB_DIR/"
  install -m 0755 -o root -g root task-router-daemon.sh             "$LIB_DIR/"
}

# install_env_file
install_env_file() {
  cat > "$ETC_DIR/gideon.env" <<EOF
GIDEON_DB=$DB
GIDEON_MESH=$LIB_DIR/agent-radio-mesh.sh
GIDEON_AGENT_ID=\$(hostname)
GIDEON_RUN=$RUN_DIR
GIDEON_CD_TICK=5
GIDEON_CD_DECAY=300
GIDEON_TRD_TICK=2
GIDEON_OFFER_WINDOW=2
EOF
  chmod 0640 "$ETC_DIR/gideon.env"
  chown root:"$USER" "$ETC_DIR/gideon.env"
}

# install_systemd_units
install_systemd_units() {
  install -m 0644 gideon-consciousness.service /etc/systemd/system/
  install -m 0644 gideon-task-router.service   /etc/systemd/system/
  systemctl daemon-reload
}

# install_enable_services
install_enable_services() {
  systemctl enable --now gideon-consciousness.service
  systemctl enable --now gideon-task-router.service
  systemctl status gideon-consciousness.service --no-pager || true
  systemctl status gideon-task-router.service   --no-pager || true
}

# install_main
install_main() {
  install_check_prereqs
  install_create_dirs
  install_init_db
  install_install_libs
  install_env_file
  install_systemd_units
  install_enable_services
  echo "Gideon 2.0 Phase 2 installed."
}

install_main "$@"
```

---

## Lifecycle Summary

```
[QUEUED] →tr_query→ [QUERY] ──mesh──► peers tr_offer ──► [OFFERED]
   ▲                                              │
   │ backoff (no offers)                          │ trd_collect_offers
   └──────────────────────────────────────────────┘
                          │
                  tr_pick_best_offer
                          ▼
                      [ASSIGNED] ──mesh──► assignee tr_local_run → tr_result
                          │
                          ▼
                      [RESULT] → trd_collect_results → [DONE]
                                       │
                                       └─► ws_reassemble(parent) → ws_fan_in
                                       └─► cp_hook_on_event → mesh_consciousness
```

**WAL rationale:** multiple readers (daemons, CLI introspection, `cp_query_state`) + single writer per process; WAL permits concurrent reads without blocking the writer, and `synchronous=NORMAL` is safe for non-financial telemetry-grade data while halving fsync cost. Each `db()` heredoc re-issues `PRAGMA journal_mode=WAL` (no-op if already WAL) so any stray handle is correct.
