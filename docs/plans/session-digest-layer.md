# Session Digest Layer — L2 Cross-Session Context

## What we're building
A pull-based, topic-scoped session digest that gives every Hermes session
read-access to what other active sessions are doing, without token-bloat,
pollution, or mid-turn disruption.

## Architecture (GLM 5.2 approved)

```
Session A ──heartbeat──► gideon_events ──► consolidation ──► /tmp/session-digest.md
                                                          │
Session B ──pull (turn boundary)──────────────────────────┘
```

### Layers
- **L0** Durable memory — already exists, injected at session start
- **L1** Session-local working context — private, not shared
- **L2** Session digest — ≤300 token structured summary of active sessions:
  `{agent_id, goal, status, last_action, blocked_on, topics[], eta}`
- **L3** On-demand retrieval — session_search (already exists)

### Key invariants
1. **Heartbeats, not token streams** — ~50 token structured messages
2. **Pull, not push** — sessions fetch digest at turn boundaries only
3. **Topic-scoped** — session pulls only entries matching its active topic
4. **Consolidation daemon writes** — extends existing consolidation-daemon
5. **Critic-agent flags contradictions** — cross-session conflict detection

---

## Deliverables

### D1: Heartbeat Client
**File:** `scripts/session-heartbeat.sh`
A tiny script any Hermes session (CLI, WebUI, TUI) can call to emit a
structured heartbeat into the event bus. No daemon — just a publish call.

```bash
# Usage
session-heartbeat.sh emit --goal "fix auth bug" --status working --last-action "isolated test case in test/auth.rs" --blocked-on "waiting for reproduction steps" --topics auth,backend

# What it does
# 1. Reads current session from $HERMES_SESSION_ID (or generates a UUID)
# 2. Publishes a structured event to gideon_events:
#    { type: heartbeat, session_id, goal, status, last_action, blocked_on, topics[], ts }
# 3. The event-bus (already running) stores it
```

Schema for the heartbeat event (publish to event bus with type `session_heartbeat`):
```json
{
  "type": "session_heartbeat",
  "session_id": "223d0384cf13",
  "agent_id": "gideon-webui",
  "goal": "fix auth bug",
  "status": "working|blocked|done|waiting",
  "last_action": "isolated test case in test/auth.rs",
  "blocked_on": "waiting for reproduction steps",
  "topics": ["auth", "backend"],
  "eta": "5min",
  "ts": 1740000000
}
```

**Install:** `~/.hermes/scripts/session-heartbeat.sh`

### D2: Digest Writer (extends consolidation-daemon)
**File:** `scripts/consolidation-daemon.sh` (modify)
Add a `digest` sub-command that:
1. Reads all `session_heartbeat` events from event-bus in the last 30 min
2. Deduplicates by session_id (keep latest per session)
3. Resolves contradictions via critic-agent (if two sessions have same topic, different goals)
4. Writes a ≤300 token markdown digest to `/tmp/session-digest.md`

Digest format:
```markdown
# Session Digest — 2026-08-12 14:30 UTC

## Active Sessions
| Agent | Goal | Status | Last Action | Blocked | Topics |
|-------|------|--------|-------------|---------|--------|
| gideon-webui | fix auth bug | working | isolated test case | waiting for repro steps | auth,backend |
| gideon-cli | deploy staging | blocked | Caddy config | cert renewal | devops,infra |

## Cross-Session Conflicts
- `auth` topic: gideon-webui wants to CHANGE route schema, gideon-cli hasn't updated Caddy proxy (resolve: coordinate before merge)
```

**Key:** ≤300 tokens total. Topics-only filtering so a coding session doesn't
see landlord email session.

### D3: Digest Pull Client
**File:** `scripts/session-digest-pull.sh`
A script Hermes sessions call at turn boundaries to pull the digest.
Topics are inferred from the current working context (env var or CLI arg).

```bash
# Usage (injected into session system prompt or called by gateway)
session-digest-pull.sh pull --topics auth,backend

# Output: markdown digest (or empty if no relevant sessions)
```

Returns the digest content, which gets prepended to the session's next prompt
context window. Never mid-turn — only at turn boundaries.

**Install:** `~/.hermes/scripts/session-digest-pull.sh`

### D4: Critic Agent — Cross-Session Conflict Detection
**File:** `scripts/critic-agent.sh` (modify)
Add a `cross-session-check` mode that:
1. Reads the session digest
2. Flags sessions with overlapping topics but conflicting goals
3. Outputs a conflicts section in the digest

---

## Partition for Parallel Agents

| Agent | Owns | Must NOT touch |
|-------|------|----------------|
| D1 | `scripts/session-heartbeat.sh`, docs | anything else |
| D2 | `scripts/consolidation-daemon.sh` (digest sub-command only) | event-bus, critic-agent |
| D3 | `scripts/session-digest-pull.sh`, docs | anything else |

D2 and D4 both touch `consolidation-daemon.sh` and `critic-agent.sh` — run D2
first, then D4 after merge. D1 and D3 are fully independent and can run in
parallel with D2.

---

## Verification
1. `bash scripts/session-heartbeat.sh emit --goal "test" --status working --topics test`
2. `bash scripts/consolidation-daemon.sh digest`
3. `cat /tmp/session-digest.md` — should show the heartbeat entry
4. `bash scripts/session-digest-pull.sh pull --topics test` — should return digest
5. Install to `~/.hermes/scripts/`
6. `systemctl restart gideon-event-bus` (if running)

---

## Reference: Existing event-bus schema
The event-bus publishes to `gideon_events` table in state.db:
- type, payload (JSON text), created_at, source
Publish command: `bash ~/.hermes/scripts/event-bus.sh publish gideon_events '<json_payload>'`
