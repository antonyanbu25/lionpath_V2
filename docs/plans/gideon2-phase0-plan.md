# Gideon 2.0 — Phase 0 Implementation Plan

## Multi-Node Mesh with Shared Consciousness

**Status:** Architecture Decision Record + Implementation Plan
**Target Executor:** Codex CLI (autonomous)
**Constraint Envelope:** bash, ssh, sqlite3, flock, coreutils only. No npm/pip.

---

## 0. Cross-Cutting Architecture Decisions

### 0.1 Directory Layout (canonical paths)
```
~/.hermes/
├── scripts/
│   ├── agent-radio.sh            (existing — DO NOT MODIFY)
│   ├── agent-radio-mesh.sh       (new — deliverable 1)
│   ├── mesh-memory.sh            (new — deliverable 2)
│   └── mesh-memory-daemon.sh     (new — deliverable 3)
├── agent-radio/
│   └── <sessionId>/
│       ├── messages/             (existing)
│       ├── mesh.participants     (new — newline list of user@host)
│       └── mesh.ledger           (new — append-only broadcast ledger)
├── state.db                      (existing — extended schema)
├── run/
│   └── mesh-daemon.pid           (new)
├── logs/
│   └── mesh-daemon.log           (new)
└── config/
    └── mesh-nodes.conf           (new — known peers, one per line)

~/gideon-mesh/docker/
└── Dockerfile                    (new — deliverable 5)
```

### 0.2 Shared Conventions
- **Logging:** `log()` helper writes `[ISO8601] [LEVEL] [script] msg` to stderr. Daemon redirects stderr to log file.
- **Error handling:** Every script: `set -Eeuo pipefail`; `trap 'err_handler $LINENO $?' ERR`; `trap 'cleanup' INT TERM EXIT`.
- **Prereq check:** `check_prereqs()` validates `sqlite3`, `ssh`, `flock`, `agent-radio.sh` presence; exits 2 with human message on failure.
- **Help flag:** Every script implements `--help` → prints usage, exits 0.
- **SSH assumptions:** Key-based auth pre-configured between nodes. `SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new"`.
- **Node identity:** `NODE_ID="${USER}@$(hostname -f)"` — canonical participant key.

### 0.3 Schema Extension to state.db
The existing `memory` table is assumed to be `(key TEXT PRIMARY KEY, value TEXT)`. Phase 0 requires:

```sql
ALTER TABLE memory ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s','now'));
ALTER TABLE memory ADD COLUMN origin_node TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at);

CREATE TABLE IF NOT EXISTS mesh_sync_state (
  node_host      TEXT PRIMARY KEY,
  last_pull_at   INTEGER NOT NULL DEFAULT 0,
  last_push_at   INTEGER NOT NULL DEFAULT 0,
  last_sync_ok   INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
```

Migration is idempotent — wrapped in `try { ALTER } catch {}` style via `sqlite3 ... 2>/dev/null || true`.

---

## 1. Deliverable 1: `agent-radio-mesh.sh`

### 1.1 File Path
`~/.hermes/scripts/agent-radio-mesh.sh`

### 1.2 Purpose
Wrap existing `agent-radio.sh` to enable cross-node session participation over SSH. No protocol changes — purely a fan-out/tail bridge.

### 1.3 CLI Surface
```
agent-radio-mesh.sh init    <sessionId>
agent-radio-mesh.sh join    <sessionId> <leadHost> [sshUser]
agent-radio-mesh.sh broadcast <sessionId> <type> <content>
agent-radio-mesh.sh participants <sessionId>
agent-radio-mesh.sh leave   <sessionId> [leadHost]
agent-radio-mesh.sh --help
```

### 1.4 Key Variables
| Variable | Purpose |
|---|---|
| `RADIO` | Path to `agent-radio.sh` (default `~/.hermes/scripts/agent-radio.sh`) |
| `MESH_DIR` | `~/.hermes/agent-radio/<sessionId>` |
| `PARTICIPANTS_FILE` | `$MESH_DIR/mesh.participants` |
| `LEDGER_FILE` | `$MESH_DIR/mesh.ledger` |
| `NODE_ID` | `${USER}@$(hostname -f)` |
| `SSH_OPTS` | Shared SSH flags (see 0.2) |
| `POLL_INTERVAL` | Seconds between ledger tail polls (default 2, env `MESH_POLL_INTERVAL`) |

### 1.5 Function Signatures
```bash
usage()                                    # prints help, exits 0
check_prereqs()                            # validates radio, ssh, flock
mesh_init <sessionId>                      # calls radio init; creates participants+ledger; self as first entry
mesh_join <sessionId> <leadHost> <sshUser> # registers self on lead; spawns background tailer
mesh_broadcast <sessionId> <type> <content># fan-out to all participants
mesh_participants <sessionId>              # lists participants (local view)
mesh_leave <sessionId> <leadHost>          # removes self from participants; kills tailer
register_self_on_lead <leadHost> <sessionId> <sshUser>
spawn_ledger_tailer <sessionId> <leadHost> <sshUser>
tailer_loop <sessionId> <leadHost> <sshUser>  # long-running; SIGTERM-aware
write_ledger <sessionId> <type> <content> <originNode>
fan_out_remote <sessionId> <type> <content> <participant>
cleanup()                                  # trap handler; kills tailer child
```

### 1.6 Key Logic Sections

**`mesh_init`**
1. Call `$RADIO init <sessionId>`.
2. `mkdir -p $MESH_DIR`; `touch $PARTICIPANTS_FILE $LEDGER_FILE`.
3. `flock $PARTICIPANTS_FILE` → append `$NODE_ID` if not present.
4. Write ledger header line: `# mesh-init <sessionId> <NODE_ID> <iso8601>`.

**`mesh_join`**
1. Validate lead reachable: `ssh $SSH_OPTS <sshUser>@<leadHost> test -d ~/.hermes/scripts`.
2. `register_self_on_lead` — SSH to lead, append `$NODE_ID` to `$PARTICIPANTS_FILE` under flock.
3. Locally call `$RADIO init <sessionId>` (so follower has its own message dir).
4. `spawn_ledger_tailer` — fork `tailer_loop` into background, write PID to `$MESH_DIR/.tailer.pid`.
5. Print join confirmation + participant count.

**`tailer_loop`** (the discovery/exchange core)
1. `trap 'exit 0' TERM INT`.
2. Track `last_offset=0` (byte offset into remote ledger).
3. Loop:
   - `ssh $SSH_OPTS <lead> "tail -c +$last_offset ~/.hermes/agent-radio/<sessionId>/mesh.ledger"` → capture delta.
   - For each new ledger line: parse `<ts> <origin> <type> <content>`; if `origin != $NODE_ID`, call `$RADIO send <sessionId> <type> <content>` locally.
   - Update `last_offset` to remote file size: `ssh <lead> stat -c %s <ledger>`.
   - `sleep $POLL_INTERVAL`.
4. On SSH failure: log, backoff exponentially (2s, 4s, 8s, max 30s), continue.

**`mesh_broadcast`**
1. Locally: `write_ledger` (append line to `$LEDGER_FILE` under flock).
2. Locally: `$RADIO send <sessionId> <type> <content>` (so local agents receive).
3. Read `$PARTICIPANTS_FILE`; for each entry where `entry != $NODE_ID`: `fan_out_remote`.
4. `fan_out_remote` — `ssh $SSH_OPTS <entry> "~/.hermes/scripts/agent-radio.sh send <sessionId> <type> <content>"`. On failure: log, continue (don't abort broadcast).

**Ledger line format** (TSV, one event per line):
```
<epoch_ms>\t<origin_node>\t<type>\t<base64_content>
```
Base64 to preserve whitespace/newlines in content.

### 1.7 Edge Cases
| Case | Handling |
|---|---|
| Lead node goes offline during join | SSH test fails → exit 3 with "lead unreachable" |
| Follower goes offline mid-broadcast | `fan_out_remote` SSH fails → log warning, continue to next participant |
| Duplicate join (same node twice) | `register_self_on_lead` checks for existing entry under flock; idempotent |
| Concurrent broadcasts | `flock $LEDGER_FILE` for append; ledger is append-only so no corruption |
| Tailer dies | Daemon (deliverable 3) health-checks `.tailer.pid`; restarts if dead (optional Phase 0.1) |
| SSH key not authorized | `BatchMode=yes` causes immediate failure → clear error message |
| Large content | Base64 encode; no line-length issue since ledger is line-delimited |
| Participant file race | All reads/writes via `flock` |

### 1.8 Testing Steps
1. **Unit — init:** `agent-radio-mesh.sh init test-sess` → verify `$MESH_DIR/mesh.participants` contains exactly `$NODE_ID`.
2. **Unit — broadcast local:** `agent-radio-mesh.sh broadcast test-sess ALERT "hello"` → verify ledger line exists and `$RADIO read` returns the message.
3. **Integration — two-node join:** On node B: `agent-radio-mesh.sh join test-sess <nodeA>`. Verify B appears in A's participants file. Verify B's tailer process is running (`ps -p $(cat .tailer.pid)`).
4. **Integration — cross-node broadcast:** From A: `broadcast test-sess ALERT "ping"`. Within `2 * POLL_INTERVAL` seconds, B's local `$RADIO read` returns "ping".
5. **Integration — bidirectional:** From B: `broadcast test-sess ALERT "pong"`. A receives.
6. **Failure — lead down:** Stop sshd on A. From B: `broadcast` → completes locally, logs remote failure, exits 0.
7. **Failure — duplicate join:** Run `join` twice from B → second call is no-op, no duplicate participant entry.
8. **Help:** `agent-radio-mesh.sh --help` → exits 0, prints usage.

---

## 2. Deliverable 2: `mesh-memory.sh`

### 2.1 File Path
`~/.hermes/scripts/mesh-memory.sh`

### 2.2 Purpose
Bidirectional SQLite consciousness bridge. Syncs `memory` table between local and one remote node via SSH-invoked `sqlite3`.

### 2.3 CLI Surface
```
mesh-memory.sh --pull   --node <user@host> [--db <path>]
mesh-memory.sh --push   --node <user@host> [--db <path>]
mesh-memory.sh --sync   --node <user@host> [--db <path>]
mesh-memory.sh --status [--node <user@host>]
mesh-memory.sh --migrate
mesh-memory.sh --help
```

### 2.4 Key Variables
| Variable | Default |
|---|---|
| `DB_PATH` | `~/.hermes/state.db` |
| `REMOTE_DB_PATH` | `~/.hermes/state.db` (override via `--remote-db`) |
| `NODE` | Required (except `--migrate`, `--status`) |
| `SSH_OPTS` | See 0.2 |
| `BATCH_SIZE` | 500 rows per SSH round-trip (env `MESH_BATCH`) |

### 2.5 Function Signatures
```bash
usage()
check_prereqs()                              # sqlite3, ssh, flock
migrate_schema()                             # idempotent ALTER TABLEs + create mesh_sync_state
remote_sql <node> <sql>                      # ssh node sqlite3 remote_db "$sql"
local_sql <sql>                              # sqlite3 DB_PATH "$sql"
get_last_pull <node>                         # echoes epoch or 0
get_last_push <node>                         # echoes epoch or 0
set_sync_state <node> <pull_at> <push_at> <ok> <error>
pull_from <node>                             # fetch remote rows newer than last_pull; INSERT OR REPLACE locally (LWW)
push_to <node>                               # send local rows newer than last_push; INSERT OR REPLACE remotely (LWW)
do_sync <node>                               # pull then push, in single transaction per side
show_status()                                # print mesh_sync_state table
lww_merge <rows_csv> <target_db> <direction> # core merge logic
cleanup()
```

### 2.6 Key Logic Sections

**`migrate_schema`** (run automatically on every invocation, idempotent)
```sql
-- guard each ALTER by checking pragma table_info
ALTER TABLE memory ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s','now'));  -- ignore "duplicate column" error
ALTER TABLE memory ADD COLUMN origin_node TEXT;
CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at);
CREATE TABLE IF NOT EXISTS mesh_sync_state (...);
```

**`pull_from <node>`**
1. `LAST=$(get_last_pull $node)`.
2. `remote_sql $node "SELECT key, value, updated_at, origin_node FROM memory WHERE updated_at > $LAST;"` → capture as TSV stream.
3. Pipe into local `sqlite3` via `.import` to temp table `__pull_staging`.
4. `BEGIN IMMEDIATE;`
5. `INSERT OR REPLACE INTO memory(key, value, updated_at, origin_node)
   SELECT s.key, s.value, s.updated_at, s.origin_node FROM __pull_staging s
   LEFT JOIN memory m ON m.key = s.key
   WHERE m.key IS NULL OR s.updated_at > m.updated_at;`
6. `COMMIT;`
7. `set_sync_state $node <new_max_updated_at> <last_push> 1 ""`.

**`push_to <node>`**
- Mirror of pull: stage local rows `WHERE updated_at > last_push`, ship TSV over stdin to remote `sqlite3 .import`, run same LWW merge remotely, update `last_push_at`.

**`do_sync <node>`**
1. `migrate_schema` (local + remote).
2. `pull_from $node`.
3. `push_to $node`.
4. `set_sync_state` final.

**LWW conflict rule:** A remote row replaces local only if `remote.updated_at > local.updated_at` for the same key. New keys always insert. This is enforced in the SQL `WHERE` clause, not in bash — atomic and race-free within the transaction.

### 2.7 Edge Cases
| Case | Handling |
|---|---|
| SSH fails | `remote_sql` returns non-zero → `set_sync_state ... 0 "<err>"` → exit 4. `last_pull_at`/`last_push_at` NOT advanced. |
| Remote sqlite3 missing | Prereq check on first connect: `ssh node which sqlite3` → exit 5 with message. |
| Schema mismatch (remote lacks updated_at) | `migrate_schema` runs on remote too (via `remote_sql`). If ALTER fails (e.g., read-only DB), exit 6. |
| Concurrent sync from two nodes | `BEGIN IMMEDIATE` on local; remote uses its own transaction. Worst case: one sync retries after `SQLITE_BUSY` (3 retries with 200ms backoff). |
| Clock skew | LWW uses `updated_at` epoch seconds. If skew > 60s, log warning but proceed. Documented limitation. |
| Large memory table | `BATCH_SIZE` pagination: `WHERE updated_at > LAST ORDER BY updated_at LIMIT $BATCH_SIZE` per round-trip. |
| Binary values in `value` | sqlite3 default TSV export escapes; use `.mode list` with `.separator "\t"` and rely on sqlite3's quoting. Alternatively use `.dump` per row. **Decision:** use `.mode list` + `.separator \t` and reject rows containing literal tabs/newlines (log + skip). |
| Node offline mid-sync | Partial pull committed (rows already merged are fine); `last_pull_at` only advanced after full batch success. |
| Duplicate keys with same `updated_at` | `INSERT OR REPLACE` keeps the last one processed; deterministic by `ORDER BY key`. |

### 2.8 Testing Steps
1. **Migrate:** `mesh-memory.sh --migrate` → `sqlite3 state.db ".schema memory"` shows `updated_at`, `origin_node` columns. Re-run → no error.
2. **Pull — fresh:** On node A, insert `memory(k='foo', v='bar', updated_at=now)`. On node B: `mesh-memory.sh --pull --node A@host`. Verify B has `foo=bar`. Verify `mesh_sync_state` row for A has `last_pull_at > 0`.
3. **Push — fresh:** Reverse of #2.
4. **Sync — bidirectional:** A has `k1`, B has `k2`. After `--sync` from B → A, both have `k1` and `k2`.
5. **LWW:** Both nodes have `k='x'`. A's `updated_at=100`, B's `updated_at=200`. After sync from B → A, A's value matches B's. Reverse sync from A → B leaves B unchanged (B's is newer).
6. **Idempotency:** Run `--sync` twice → second run is a no-op (0 rows transferred).
7. **SSH failure:** Stop sshd on remote. `--sync` exits 4, `mesh_sync_state.last_sync_ok=0`, `last_error` populated, `last_pull_at` unchanged.
8. **Concurrent:** Launch two `--sync` processes simultaneously → both complete, no corruption (verify row count matches).
9. **Help:** `--help` exits 0.

---

## 3. Deliverable 3: `mesh-memory-daemon.sh`

### 3.1 File Path
`~/.hermes/scripts/mesh-memory-daemon.sh`

### 3.2 Purpose
Long-running background loop calling `mesh-memory.sh --sync` against configured peers.

### 3.3 CLI Surface
```
mesh-memory-daemon.sh [start] [--interval <sec>] [--nodes <file>]
mesh-memory-daemon.sh stop
mesh-memory-daemon.sh status
mesh-memory-daemon.sh --help
```

### 3.4 Key Variables
| Variable | Default |
|---|---|
| `INTERVAL` | `${MESH_INTERVAL:-30}` |
| `NODES_FILE` | `~/.hermes/config/mesh-nodes.conf` |
| `PID_FILE` | `~/.hermes/run/mesh-daemon.pid` |
| `LOG_FILE` | `~/.hermes/logs/mesh-daemon.log` |
| `MESH_MEM` | `~/.hermes/scripts/mesh-memory.sh` |
| `LOCK_FD` | 9 (for single-instance flock) |

### 3.5 Function Signatures
```bash
usage()
check_prereqs()
acquire_lock()          # flock on PID_FILE; exit 7 if already running
write_pid()
daemon_loop()           # main loop
sync_all_nodes()        # iterate NODES_FILE, call mesh-memory.sh --sync per node
handle_signal <signum>  # SIGTERM/SIGINT → graceful shutdown
cleanup()
status()                # check PID alive, last loop time, error count
```

### 3.6 Key Logic Sections

**Startup**
1. `check_prereqs`.
2. `mkdir -p` for run/ and logs/.
3. `acquire_lock` — `exec 9>"$PID_FILE"; flock -n 9 || { echo "already running (pid $(cat $PID_FILE))"; exit 7; }`.
4. `write_pid` — `echo $$ > $PID_FILE`.
5. `trap 'handle_signal TERM' TERM INT`.
6. `exec >>"$LOG_FILE" 2>&1` (redirect stderr+stdout to log).
7. `daemon_loop`.

**`daemon_loop`**
```
while true; do
  log INFO "sync cycle start"
  sync_all_nodes
  log INFO "sync cycle done; sleeping $INTERVAL"
  # sleep that respects signals:
  for ((i=0; i<INTERVAL; i++)); do sleep 1; done
done
```
The 1-second sleep loop ensures SIGTERM is handled within 1s, not after the full interval.

**`sync_all_nodes`**
1. Read `$NODES_FILE` (skip blank lines and `#` comments).
2. For each `node`: `"$MESH_MEM" --sync --node "$node" 2>&1 | log_lines` — capture exit code, log success/failure.
3. Continue to next node on failure (don't abort cycle).

**`handle_signal`**
1. Log "received SIGTERM, shutting down".
2. `cleanup` — remove PID file, release flock.
3. `exit 0`.

**`stop` subcommand**
1. Read PID from `$PID_FILE`.
2. `kill -TERM $PID`.
3. Wait up to 5s for process to exit.
4. Remove PID file.

### 3.7 Edge Cases
| Case | Handling |
|---|---|
| Already running | `flock -n` fails → exit 7 with message |
| `NODES_FILE` missing | Log warning, sleep, retry next cycle (don't crash) |
| `NODES_FILE` empty | Log, sleep full interval |
| One node unreachable | `mesh-memory.sh` exits non-zero; daemon logs, continues to next node |
| `mesh-memory.sh` hangs | Wrap each sync in `timeout 60` (coreutils) |
| Daemon killed -9 | PID file stale; `acquire_lock` flock is on file descriptor, OS releases on process death, so next start succeeds. Stale PID file overwritten. |
| Log file grows | Phase 0: no rotation. Documented. (Phase 1: logrotate config.) |
| System clock jumps backward | Sleep loop uses `sleep 1` × N, so unaffected. `updated_at` LWW may mis-order; documented. |

### 3.8 Testing Steps
1. **Start:** `mesh-memory-daemon.sh start --interval 5` → PID file exists, process running, log file has "sync cycle start" line.
2. **Single-instance:** Run `start` again → exits 7, message "already running".
3. **Sync execution:** With a node in `mesh-nodes.conf`, verify `mesh_sync_state` row's `last_pull_at` advances within `INTERVAL` seconds.
4. **Graceful stop:** `mesh-memory-daemon.sh stop` → process exits within 5s, PID file removed, log has "shutting down".
5. **Signal handling:** `kill -TERM $(cat pid)` → same as `stop`.
6. **Node failure resilience:** Remove a node's sshd; daemon logs failure each cycle but continues running and tries other nodes.
7. **Status:** `mesh-memory-daemon.sh status` → prints PID, alive/dead, last cycle timestamp.
8. **Help:** `--help` exits 0.

---

## 4. Deliverable 4: Consciousness Cron Job

### 4.1 Mechanism
Use Hermes' existing `cronjob` tool.

### 4.2 Fallback (if `cronjob` tool differs)
Write directly to user crontab:
```bash
( crontab -l 2>/dev/null; echo "*/5 * * * * $HOME/.hermes/scripts/mesh-memory.sh --sync --node <peer> >> $HOME/.hermes/logs/mesh-cron.log 2>&1" ) | crontab -
```
**Decision:** Codex should try `hermes cronjob add` first; if it fails or syntax differs, fall back to `crontab`. Log which path was taken.

### 4.3 Idempotency
Before adding, check if a job named `consciousness-sync` already exists (`hermes cronjob list | grep consciousness-sync`). If yes, skip. Prevents duplicate cron entries on re-runs.

### 4.4 Configuration
- Schedule: `*/5 * * * *` (every 5 minutes — explicit Phase 0 requirement).
- Node: read from `$HOME/.hermes/config/mesh-nodes.conf` first line, OR accept as arg to the install command.
- Log: `~/.hermes/logs/mesh-cron.log`.

### 4.5 Testing Steps
1. **Install:** Run install command → `hermes cronjob list` shows `consciousness-sync`.
2. **Idempotent:** Run install again → no duplicate.
3. **Execution:** Wait 5 minutes (or temporarily set schedule to `* * * * *`) → verify `mesh_sync_state.last_pull_at` advances and `mesh-cron.log` has entries.
4. **Removal:** `hermes cronjob remove consciousness-sync` → gone from list.

---

## 5. Deliverable 5: Docker Fringe Node

### 5.1 File Path
`~/gideon-mesh/docker/Dockerfile`

Companion files:
- `~/gideon-mesh/docker/entrypoint.sh`
- `~/gideon-mesh/docker/mesh-nodes.conf.example`
- `~/gideon-mesh/docker/README.md`

### 5.2 Base Image
`ubuntu:22.04` (not alpine — `flock` from util-linux, `sqlite3`, `openssh-client` all in apt; alpine needs `busybox` flock which differs subtly).

### 5.3 Dockerfile Skeleton
```dockerfile
FROM ubuntu:22.04

ARG HERMES_USER=hermes
ENV DEBIAN_FRONTEND=noninteractive

# Prereqs
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash sqlite3 openssh-client util-linux ca-certificates \
      coreutils && \
    rm -rf /var/lib/apt/lists/*

# Create hermes user
RUN useradd -m -s /bin/bash $HERMES_USER
USER $HERMES_USER
WORKDIR /home/$HERMES_USER

# Copy scripts (assume build context = repo root with scripts/ dir)
COPY --chown=$HERMES_USER:$HERMES_USER scripts/ ./hermes/scripts/
COPY --chown=$HERMES_USER:$HERMES_USER docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh ./hermes/scripts/*.sh

# Volume mount points
VOLUME ["/home/$HERMES_USER/.hermes/state.db", "/home/$HERMES_USER/.hermes/config", "/home/$HERMES_USER/.ssh"]

ENV MESH_INTERVAL=30

ENTRYPOINT ["/home/hermes/entrypoint.sh"]
```

### 5.4 `entrypoint.sh` Skeleton
```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# 1. Validate volumes mounted
# 2. If state.db doesn't exist, init empty
# 3. Run mesh-memory.sh --migrate
# 4. If SSH key present, set perms 600
# 5. Start mesh-memory-daemon.sh in background
# 6. exec tail -f /home/hermes/.hermes/logs/mesh-daemon.log
#    (PID 1 must stay alive; tail is signal-friendly)
```

### 5.5 Key Decisions
- **state.db:** Mounted as a *file volume* (not directory) so the container shares the host's DB. Alternative: SQLite over SSH from container to lead node. **Decision:** volume mount for same-host Docker; SSH tunnel for cross-host. Documented in README.
- **SSH keys:** Mounted read-only at `~/.ssh/`. Container uses these to authenticate to lead node for `agent-radio-mesh.sh join`.
- **No agent-radio.sh modification:** Container runs the same `agent-radio.sh` from the host's scripts dir (copied at build).
- **Hermes Agent itself:** Phase 0 fringe node is *memory-only* — it does NOT run the full Hermes Agent. It runs `mesh-memory-daemon.sh` and (optionally) `agent-radio-mesh.sh join`. Phase 1 will add the agent runtime. **Decision documented in README.**

### 5.6 Edge Cases
| Case | Handling |
|---|---|
| state.db volume not mounted | entrypoint detects missing file, creates empty DB, logs warning |
| SSH key not mounted | `agent-radio-mesh.sh join` will fail; daemon still runs `--sync` against configured nodes (will fail until keys added) |
| Container restarts | Daemon PID file may be stale; `acquire_lock` flock handles it (OS releases on process death) |
| SQLite locked by host process | `BEGIN IMMEDIATE` retries with backoff (see 2.7) |
| Multiple fringe containers | Each must have unique `NODE_ID` — set `HOSTNAME` env or pass `--node-id` to daemon. **Decision:** use container hostname (Docker sets unique hostname by default). |

### 5.7 Testing Steps
1. **Build:** `docker build -t gideon-fringe ~/gideon-mesh/docker/`.
2. **Run with volume:** `docker run -d -v ~/.hermes/state.db:/home/hermes/.hermes/state.db -v ~/.ssh:/home/hermes/.ssh:ro gideon-fringe`.
3. **Verify daemon:** `docker exec <cid> cat /home/hermes/.hermes/run/mesh-daemon.pid` → process alive.
4. **Verify sync:** After `INTERVAL` seconds, `docker exec <cid> sqlite3 ~/.hermes/state.db "SELECT * FROM mesh_sync_state;"` shows sync activity.
5. **Verify migration:** `docker exec <cid> sqlite3 ~/.hermes/state.db ".schema memory"` has `updated_at` column.
6. **Graceful shutdown:** `docker stop <cid>` → exits within 10s (SIGTERM propagated to daemon via entrypoint's `tail -f`).
7. **Help:** `docker run --rm gideon-fringe --help` → entrypoint prints usage.

---

## 6. Implementation Order for Codex

Execute in this sequence; each step gates the next:

1. **Schema migration** — write `migrate_schema` in `mesh-memory.sh` first; test in isolation. (Blocks 2, 3, 5.)
2. **`mesh-memory.sh`** — full implementation; test pull/push/sync against a second VPS or `localhost` with a second DB path.
3. **`mesh-memory-daemon.sh`** — depends on (2). Test single-instance, signal handling.
4. **`agent-radio-mesh.sh`** — independent of (2)/(3); can be developed in parallel. Test with two local users or two VPS instances.
5. **Cron job** — depends on (2). Trivial once (2) works.
6. **Dockerfile** — depends on (2), (3), (4). Build last.

## 7. Cross-Script Integration Test (Final Acceptance)

**Topology:**
- Node A (lead): Hermes Agent + all scripts + state.db
- Node B (follower): Hermes Agent + all scripts + state.db
- Node C (fringe): Docker container with mounted state.db

**Procedure:**
1. On A: `agent-radio-mesh.sh init sess-1`.
2. On B: `agent-radio-mesh.sh join sess-1 <A>`.
3. Start `mesh-memory-daemon.sh` on A and B with `INTERVAL=10`.
4. Start container C with `mesh-nodes.conf` pointing to A.
5. On A, agent writes `memory(key="thought-1", value="hello mesh")`.
6. Within 30s: B and C both have `thought-1` in their `state.db`.
7. On B, agent broadcasts via `agent-radio-mesh.sh broadcast sess-1 THOUGHT "thought-2"`.
8. Within `2 * POLL_INTERVAL`: A's local agent-radio receives `thought-2`.
9. Kill container C. Daemon on A logs sync failure for C, continues syncing with B.
10. Restart C. Within `INTERVAL`: C catches up on all missed thoughts.

**Acceptance criteria:** All 10 steps pass. No data loss. No duplicate rows. Logs are clean (warnings only, no unhandled errors).

---

**End of Plan.** Codex may proceed deliverable-by-deliverable in the order specified in Section 6.
