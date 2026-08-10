# Gideon 2.0 — Phase 1 Implementation Plan

## Auto-Discovery + Distributed Ops + Node Health Registry

**Status:** Architecture Decision Record + Implementation Plan
**Target Executor:** Codex CLI (autonomous)
**Constraint Envelope:** bash, ssh, sqlite3, flock, coreutils only. No npm/pip.

---

## Deliverable 1 — `node-discovery.sh`

`~/.hermes/scripts/node-discovery.sh` — Auto-discovery of peer Hermes mesh nodes.

CLI:
- `--scan [CIDR]` — one-time scan (default 192.168.1.0/24)
- `--watch [--interval N]` — continuous scan loop
- `--list` — print known nodes as JSON

Key logic:
- `cidr_to_ips()` — expand CIDR to IP list (pure bash, /24 only, no nmap)
- `probe_ssh()` — `timeout 2 bash -c 'echo >/dev/tcp/$ip/22'` (bash builtin, no root)
- `probe_capabilities()` — SSH into discovered node, check for sqlite3 and agent-radio-mesh.sh
- `merge_nodes()` — deduplicate by IP, upsert into `discovered-nodes.json`
- Store: hostname, IP, last_seen, reachable (bool), capabilities (JSON)

Output: `~/.hermes/config/discovered-nodes.json`

## Deliverable 2 — `mesh-memory.sh` enhancement (--watch, --notify, conflict logging)

Modify existing Phase 0 file (backup first).

New flags:
- `--watch` — continuous sync loop for all known nodes
- `--interval N` — watch interval (default 60s)
- `--notify` — broadcast sync events via agent-radio-mesh.sh

New functions:
- `load_known_nodes()` — read from discovered-nodes.json, fallback to mesh-nodes.conf, always include localhost
- `notify_radio()` — broadcasts FYI when conflicts resolved
- `apply_lww_merge()` — logs BEFORE/AFTER/winner on conflict, writes to `memory-conflicts.log`
- `do_watch()` — infinite loop calling sync for each known node

Update `mesh-memory-daemon.sh` to support `MESH_NOTIFY=1` env var.

## Deliverable 3 — `skill-sync.sh`

`~/.hermes/scripts/skill-sync.sh` — Sync `~/.hermes/skills/` across mesh nodes.

CLI:
- `--push`, `--pull`, `--sync`, `--dry-run`, `--help`

Key logic:
- `rsync -avz --delete ~/.hermes/skills/ user@node:~/.hermes/skills/`
- Fallback: tar + scp if rsync missing
- Conflict detection: if both nodes modified a skill file since last sync, keep both (`.conflict` suffix)
- Store sync state in `skill_sync_state` table
- `--dry-run` with rsync (scp fallback cannot dry-run, logs warning)

## Deliverable 4 — `node-health-daemon.sh`

`~/.hermes/scripts/node-health-daemon.sh` — Health monitoring daemon.

CLI: `start [--interval N]`, `stop`, `status`, `--help`

Key logic:
- Check each known node via `/dev/tcp/$ip/22` every 30s
- Track: reachable, last_seen, response_time_ms, error_count in `mesh_node_health` table
- Transition detection: reachable→unreachable → URGENT broadcast
- Transition detection: unreachable→reachable → FYI broadcast
- Graceful SIGTERM, single-instance flock

## Deliverable 5 — Integration & systemd

systemd units:
- `/etc/systemd/system/gideon-node-health.service` (type=forking, forking daemon)
- `/etc/systemd/system/gideon-node-discovery.service` (type=oneshot) + `.timer` (daily)
- `/etc/systemd/system/gideon-skill-sync.service` (type=oneshot) + `.timer` (hourly)
- `/etc/logrotate.d/gideon-mesh`

Update existing gideon-mesh-daemon.service with `Environment=MESH_NOTIFY=1`

---

**Implementation order:**
1. node-discovery.sh (foundation)
2. node-health-daemon.sh (depends on D1 for node list)
3. skill-sync.sh (depends on D1 for node list)
4. mesh-memory.sh enhancement + daemon update (depends on D1 for --watch node list)
5. systemd integration

**Constraints:** bash, ssh, sqlite3, flock, coreutils, rsync (optional). All new scripts at ~/.hermes/scripts/. Mode 0755, user's own $HOME.

**Rollback plan:** Keep Phase 0 backups at mesh-memory.sh.phase0.bak. systemctl disable the new units to revert.
