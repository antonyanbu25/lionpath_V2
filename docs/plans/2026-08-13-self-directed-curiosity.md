# Gideon Self-Directed Curiosity Loop — FINAL Plan (v3, merged)

**Date:** 2026-08-13
**Planner:** GLM 5.2 (v1 + v2) + Gideon (merged, SQLite-corrected, mesh-convention-aligned)
**Status:** GREEN LIGHT — dispatch Codex swarm

## Design principles (merged from GLM v2 + Gideon)
1. **Minimal first.** 2 triggers, 2 tables. Ship, observe, expand.
2. **Self-referential core.** Primary curiosity is about Gideon himself (behavior, patterns, what to change). External topics secondary (~70/30 self/external).
3. **Closed loop.** Brief → feedback applied to memory → next brief sees the change. Not a diary.
4. **Python for reasoning, bash for plumbing.** Judgment = Python+GLM; I/O = bash.
5. **Relevance-gated.** Before writing a brief, judge "does this matter to Kuttan's goals / Gideon's work?" Skip if not.
6. **Always-on systemd daemon** (Type=simple), NOT cron. Clock is a throttle, never the trigger.
7. **Disjoint swarm partition, single DDL owner, test isolation, token budget.**

## Architecture: the loop

```
gideon-curiosity.service (systemd, Type=simple, always-on)
  curiosity-daemon.sh  (foreground loop, sleep THROTTLE_SEC between)
    │
    ├─ SENSE   curiosity-sense.sh (bash)      → trigger vector JSON
    ├─ DECIDE  inline in daemon (bash)         → pick trigger+topic, enforce throttle/budget
    ├─ FETCH   curiosity-fetch.sh (bash)       → gather internal state + optional external
    ├─ SYNTHESIZE curiosity-synthesize.py (Python+GLM)
    │          → relevance gate (skip if <50) + write brief + propose changes
    ├─ SURFACE curiosity-surface.sh (bash)     → LATEST.md + archive + event-bus publish
    ├─ FEEDBACK curiosity-feedback.py (Python+GLM)
    │          → apply conservative changes to memory table
    └─ sleep THROTTLE_SEC → loop
```

## Triggers (2 only)
- **T_STALE_TOPIC:** a topic in `curiosity_topics` with `last_examined` older than `stale_days` (default 7). Round-robin by priority.
- **T_SELF_REFLECT:** periodic look at Gideon's own recent sessions/events/memory for patterns. Runs every `reflect_days` (default 3) OR when session count since last reflection > threshold.
- **Ratio:** ~70% self-reflect, ~30% stale-topic, enforced by a simple counter in `curiosity_state` (not a scoring engine).

## Language split
| Stage | Language | Why |
|-------|----------|-----|
| SENSE | bash | trigger checks, SQL queries |
| DECIDE | bash (inline) | round-robin + staleness, no judgment needed |
| FETCH | bash | gather data, read logs/DB, optional curl |
| SYNTHESIZE | Python + GLM | relevance judgment + brief + proposed changes (ONE call) |
| SURFACE | bash | write files, event-bus publish |
| FEEDBACK | Python + GLM | decide + apply conservative memory changes |

## Tables (2 only, SQLite-correct) — DDL owned by D5
```sql
CREATE TABLE IF NOT EXISTS curiosity_topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic         TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK(kind IN ('self','external')),
  priority      INTEGER NOT NULL DEFAULT 5,
  stale_days    INTEGER NOT NULL DEFAULT 7,
  last_examined INTEGER,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS curiosity_briefs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type     TEXT NOT NULL CHECK(trigger_type IN ('T_STALE_TOPIC','T_SELF_REFLECT')),
  topic            TEXT NOT NULL,
  brief_text       TEXT NOT NULL,
  changes_proposed TEXT,          -- JSON
  changes_applied  TEXT,          -- JSON (filled by FEEDBACK)
  relevance_score  INTEGER,       -- 0-100
  skipped          INTEGER DEFAULT 0,
  skip_reason      TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curiosity_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed keys: last_cycle_at, self_count, external_count, daily_tokens_<YYYYMMDD>
```

## Seed topics (D5, on init)
```sql
INSERT OR IGNORE INTO curiosity_topics(topic,kind,priority,stale_days,created_at) VALUES
 ('Gideon self-reflection & behavior patterns','self',9,3,strftime('%s','now')),
 ('Gideon mesh architecture & daemons','self',8,7,strftime('%s','now')),
 ('Kuttan work domains (SE, Freshworks)','self',7,7,strftime('%s','now')),
 ('AI agents & multi-agent orchestration','external',5,7,strftime('%s','now')),
 ('LLM reasoning & planning','external',4,7,strftime('%s','now'));
```

## Reuse (read-only) of existing tables
`gideon_events(id,ts,type,payload,consumed)`, `gideon_goals(id,goal,parent_id,status,progress,created_at,updated_at)`, `memory(key,value,updated_at,origin_node)`, `sessions` — read-only queries only.

## Interfaces (verified)
- Event bus: `~/.hermes/scripts/event-bus.sh publish <type> <payload>` → INSERT into gideon_events. Type = first arg. Surface publishes `event-bus.sh publish curiosity_cycle '{"topic":"...","brief":"archive/<epoch>.md","tokens":N}'`.
- agent-radio: `agent-radio.sh send <sessionId> <threadId> <type> <content>` — best-effort, `|| true`. (No broadcast subcommand; use send if a session exists, else skip.)
- API keys: read `~/.hermes/.env` directly (`set -a; . ~/.hermes/.env; set +a`) — subprocesses don't inherit env. Neuralwatt key = `HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY`.
- GLM call: `curl --max-time 120 -s https://api.neuralwatt.com/v1/chat/completions -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"model":"glm-5.2","max_tokens":1200,"messages":[...]}'`. Handle `content:null` (retry once, fall back to `reasoning` field, then ollama).

## Guardrails
- Token budget: `CURIOSITY_MAX_TOKENS=1200`/call, `CURIOSITY_DAILY_TOKEN_BUDGET=20000`/day (persisted in curiosity_state).
- Throttle: `CURIOSITY_THROTTLE_SEC=1800` (30 min) min interval, `CURIOSITY_MAX_DAILY=12` cycles/day.
- No config/code mutation: writes ONLY to `~/.hermes/curiosity/`, `curiosity_*` tables, `/tmp/curiosity.*`. Read-only on scripts and other tables.
- No deploy: never calls systemctl/git/pip/npm.
- Test isolation: `HERMES_HOME=/tmp/gideon-test` override + scratch state.db copy (HERMES_HOME overrides HOME).
- Temp cleanup: `trap 'rm -f /tmp/curiosity.$$.*' EXIT`.
- Error handling: every external call `|| { log; status=error; }`; cycle always records a row in curiosity_briefs even on failure.
- Restart safety: Type=simple, Restart=on-failure, RestartSec=30, StartLimitBurst=5.

## File layout (mesh conventions — ~/.hermes/scripts/, NOT /opt/gideon)
Repo: /root/gideon-mesh. Scripts written to `scripts/`, installed to `~/.hermes/scripts/` by Gideon.
```
scripts/curiosity-daemon.sh        # D1 orchestrator loop
scripts/curiosity-sense.sh         # D2 bash trigger checks
scripts/curiosity-fetch.sh         # D3 bash data gathering
scripts/curiosity-synthesize.py    # D4 Python+GLM brief + relevance
scripts/curiosity-state.sh         # D5 DDL owner + state helpers
scripts/curiosity-surface.sh        # D6 bash LATEST.md + event-bus
scripts/curiosity-feedback.py      # D7 Python+GLM apply memory changes
etc/systemd/system/gideon-curiosity.service  # D1 systemd unit (content only)
```

## Swarm partition (7 disjoint agents)
| Agent | Owns (new files) | Builds | Commit msg |
|-------|------------------|--------|-----------|
| D1 | `scripts/curiosity-daemon.sh`, `etc/systemd/system/gideon-curiosity.service` | Always-on foreground loop; calls sense→decide→fetch→synthesize→surface→feedback; throttle+budget; logs to `~/.hermes/curiosity/daemon.log`; systemd unit Type=simple | `feat(curiosity): add always-on daemon loop and systemd unit` |
| D2 | `scripts/curiosity-sense.sh` | Read-only sqlite3 queries for 2 triggers; emits JSON trigger vector; honors HERMES_HOME | `feat(curiosity): add sense stage with 2 trigger detectors` |
| D3 | `scripts/curiosity-fetch.sh` | Gather internal state (sessions/events/memory) + optional external curl (arxiv/rss); timeout; temp file; path on stdout | `feat(curiosity): add fetch stage for internal+external signal` |
| D4 | `scripts/curiosity-synthesize.py` | Python+GLM: relevance gate (skip if <50) + write brief + propose changes JSON; reads .env directly; MAX_TOKENS cap; content:null handling | `feat(curiosity): add GLM synthesize stage with relevance gate` |
| D5 | `scripts/curiosity-state.sh` | DDL owner: idempotent CREATE TABLE for curiosity_topics/briefs/state; seed topics; helpers init/record/update/get-kv/set-kv/budget-check; honors HERMES_HOME | `feat(curiosity): add state stage owning curiosity_* DDL` |
| D6 | `scripts/curiosity-surface.sh` | Atomic LATEST.md write, archive copy, event-bus publish curiosity_cycle, best-effort agent-radio send; creates dirs | `feat(curiosity): add brief surfacing via LATEST.md and event-bus` |
| D7 | `scripts/curiosity-feedback.py` | Python+GLM: read brief + changes_proposed + current memory; decide conservative memory changes; apply to memory table; write changes_applied | `feat(curiosity): add feedback stage applying memory changes` |

## Gideon's install step (NOT a Codex deliverable)
```bash
install -m 755 scripts/curiosity-daemon.sh scripts/curiosity-sense.sh \
  scripts/curiosity-fetch.sh scripts/curiosity-state.sh scripts/curiosity-surface.sh \
  ~/.hermes/scripts/
install -m 644 scripts/curiosity-synthesize.py scripts/curiosity-feedback.py ~/.hermes/scripts/
cp etc/systemd/system/gideon-curiosity.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now gideon-curiosity
~/.hermes/scripts/curiosity-state.sh init   # creates tables + seeds
```

## Verification checklist (Gideon after merge)
- [ ] All 7 scripts exist, executable, `bash -n` passes (py: `python3 -m py_compile`)
- [ ] curiosity_topics/briefs/state tables created in state.db
- [ ] Functional test against scratch DB (HERMES_HOME=/tmp/gideon-test + scratch copy) — run one cycle, confirm brief row + event land in COPY not live DB
- [ ] Service active, NRestarts=0, enabled
- [ ] Test rows cleaned from live state.db
- [ ] `git show --stat` confirms each agent only touched its assigned files
