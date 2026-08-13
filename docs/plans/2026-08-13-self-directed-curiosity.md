# Gideon Self-Directed Curiosity Loop — Architecture Plan (v2)

**Date:** 2026-08-13
**Planner:** GLM 5.2 (neuralwatt) + Gideon (completed §7 checklist)
**Status:** Ready for green light → Codex swarm
**Revision note:** v1 used a cron job as the trigger. That was WRONG — a cron job is external-clock automation, the opposite of self-directed curiosity. v2 is an always-on foreground loop that DECIDES when to be curious from internal state. The clock is a throttle, never the trigger.

---

## 1. ARCHITECTURE OVERVIEW

**Recommendation: NEW sibling always-on daemon** `~/.hermes/scripts/curiosity-daemon.sh` (systemd `gideon-curiosity.service`, `Type=simple`).

**Justification:** `background_mind.py` is owned by the limbic-system concern and is a Python file in `/opt/gideon/` — disjoint ownership forbids a second swarm agent from mutating it. A new bash sibling duplicates only the trivial `while true; do ...; sleep N; done` pattern, which is far cheaper than entangling two concerns in one file. It also gives curiosity its own failure domain, log, restart policy, and token budget — Kuttan can stop curiosity without stopping the limbic system.

**Data flow (text diagram):**

```
                  ┌─────────────────────────────────────────┐
                  │  gideon-curiosity.service (Type=simple)  │
                  │  curiosity-daemon.sh  (always-on loop)   │
                  └────────────────┬────────────────────────┘
                                   │ every THROTTLE_SEC (default 1800)
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  SENSE   curiosity-sense.sh                       │
        │  reads state.db (sessions, gideon_events,         │
        │  gideon_goals, memory, curiosity_topics)          │
        │  → emits trigger vector to stdout (JSON)          │
        └──────────────────┬───────────────────────────────┘
                           ▼
        ┌──────────────────────────────────────────────────┐
        │  DECIDE  (inline in daemon)                      │
        │  score triggers; if max score < THRESHOLD → skip │
        │  enforce: min interval, max cycles/day, token    │
        │  budget. Pick ONE topic.                         │
        └──────────────────┬───────────────────────────────┘
                           ▼ (only if a real trigger fired)
        ┌──────────────────────────────────────────────────┐
        │  FETCH   curiosity-fetch.sh                      │
        │  curl RSS / arxiv / web (headless, timeout 20s)  │
        │  → raw signal to /tmp/curiosity.<epoch>.raw      │
        └──────────────────┬───────────────────────────────┘
                           ▼
        ┌──────────────────────────────────────────────────┐
        │  SYNTHESIZE  curiosity-synthesize.sh              │
        │  GLM via neuralwatt (keys from ~/.hermes/.env)    │
        │  MAX_TOKENS=1200 hard cap; ollama fallback       │
        │  → markdown brief                                │
        └──────────────────┬───────────────────────────────┘
                           ▼
        ┌──────────────────────────────────────────────────┐
        │  SURFACE  curiosity-surface.sh                    │
        │  write ~/.hermes/curiosity/LATEST.md              │
        │  archive ~/.hermes/curiosity/archive/<epoch>.md   │
        │  event-bus publish curiosity_cycle '<json>'       │
        │  agent-radio broadcast (best-effort)              │
        └──────────────────┬───────────────────────────────┘
                           ▼
        ┌──────────────────────────────────────────────────┐
        │  STATE   curiosity-state.sh (DDL owner)           │
        │  INSERT curiosity_cycles; UPDATE curiosity_topics │
        │  .last_surveyed_at; decrement daily token budget  │
        └──────────────────┬───────────────────────────────┘
                           ▼
                     sleep THROTTLE_SEC
                           │
                           └──► loop
```

The clock is a **throttle**, never the trigger. The trigger is the SENSE→DECIDE stage reading internal state.

---

## 2. THE DECISION ENGINE

### 2.1 Internal-state triggers (concrete)

Each cycle, `curiosity-sense.sh` computes a trigger vector. A trigger fires when ANY of these hold:

| Trigger ID | Condition | Query basis |
|---|---|---|
| `T_STALE_TOPIC` | A row in `curiosity_topics` with `last_surveyed_at IS NULL` OR `(now - last_surveyed_at) > stale_days*86400` | `curiosity_topics` |
| `T_NEW_GOAL` | A row in `gideon_goals` created since `last_cycle_at` | `gideon_goals.created_at` |
| `T_EVENT_BURST` | `COUNT(*) FROM gideon_events WHERE ts > last_cycle_at` ≥ `EVENT_BURST_N` (default 25) | `gideon_events` |
| `T_SESSION_QUESTION` | A recent `sessions` row whose digest/prefill contains `?` and a topic keyword not present in `memory` | `sessions` + `memory` |
| `T_MEMORY_GAP` | A noun phrase appearing in ≥3 recent `gideon_events.payload` but absent from `memory` | `gideon_events` + `memory` |
| `T_GOAL_DRIFT` | An active goal with no `gideon_events` progress in `GOAL_STALE_DAYS` (default 3) | `gideon_goals` + `gideon_events` |

### 2.2 Scoring & selection

- Each trigger carries a weight: `T_NEW_GOAL=3, T_GOAL_DRIFT=3, T_MEMORY_GAP=2, T_SESSION_QUESTION=2, T_STALE_TOPIC=1, T_EVENT_BURST=1`.
- Score = weight × recency_multiplier (1.0 if fresh, decaying to 0.3 over 24h).
- **Decision threshold:** if `max_score < 2`, the cycle is a NO-OP (sleep and re-sense). This is what keeps it cheap — most cycles do nothing.
- Topic selection: round-robin over `curiosity_topics` ordered by `last_surveyed_at ASC NULLS FIRST`, but trigger-driven topics (e.g. the goal that drifted) override round-robin.

### 2.3 Throttle (the cheapness guarantee)

| Knob | Default | Env var |
|---|---|---|
| Min interval between cycles | 1800s (30 min) | `CURIOSITY_THROTTLE_SEC` |
| Max cycles/day | 12 | `CURIOSITY_MAX_DAILY` |
| Max tokens/cycle | 1200 | `CURIOSITY_MAX_TOKENS` |
| Max tokens/day | 20000 | `CURIOSITY_DAILY_TOKEN_BUDGET` |
| Fetch timeout | 20s | `CURIOSITY_FETCH_TIMEOUT` |
| Decision threshold | 2 | `CURIOSITY_MIN_SCORE` |

Daily counters reset at local midnight (computed from `date +%H%M`); persisted in `curiosity_cycles` so restarts don't reset the budget.

---

## 3. CURIOSITY CYCLE — COMPONENT SPEC

### 3.1 Sense (`curiosity-sense.sh`)
- Reads `~/.hermes/state.db` **read-only** (`sqlite3 -readonly`).
- Inputs: `last_cycle_at` (from `curiosity_state` kv, see §4).
- Output: JSON to stdout:
  ```json
  {"triggers":[{"id":"T_NEW_GOAL","score":3,"topic":"...","evidence":"goal_id=42"}], "last_cycle_at":1735000000}
  ```

### 3.2 Decide (inline in `curiosity-daemon.sh`)
- Pure bash: parse JSON with `python3 -c` (already a mesh dependency) or `jq` if present.
- Enforce throttle/budget; if exceeded → emit `NOOP` and sleep.
- Pick topic; export `CURIOSITY_TOPIC`, `CURIOSITY_TRIGGER`, `CURIOSITY_EVIDENCE` to children.

### 3.3 Fetch (`curiosity-fetch.sh`)
- Sources (one per cycle, chosen by topic tag in `curiosity_topics.source`):
  - `rss`: curl a feed URL from `curiosity_topics.source_url`
  - `arxiv`: `https://export.arxiv.org/api/query?search_query=<topic>&max_results=5`
  - `web`: `curl -L` a search endpoint (DuckDuckGo HTML, no key)
- Hard timeout `CURIOSITY_FETCH_TIMEOUT`. Output to `/tmp/curiosity.<epoch>.raw`, path on stdout.

### 3.4 Synthesize (`curiosity-synthesize.sh`)
- Source `~/.hermes/.env` directly (`set -a; . ~/.hermes/.env; set +a`) — subprocesses don't inherit env.
- Call GLM via neuralwatt endpoint (`${NEURALWATT_BASE_URL}/chat/completions`, bearer `${NEURALWATT_API_KEY}`).
- `MAX_TOKENS=${CURIOSITY_MAX_TOKENS}`. System prompt: "You are Gideon's curiosity. Produce a ≤300-word brief: what changed, why it matters to Gideon's goals, one open question. No code, no config."
- Fallback: if neuralwatt HTTP non-200 or timeout → `ollama run glm4:latest` (best-effort, log warning).
- Output markdown to `/tmp/curiosity.<epoch>.md`.

### 3.5 Surface (`curiosity-surface.sh`)
- `mkdir -p ~/.hermes/curiosity/archive`
- `cp /tmp/curiosity.<epoch>.md ~/.hermes/curiosity/archive/<epoch>.md`
- `cp /tmp/curiosity.<epoch>.md ~/.hermes/curiosity/LATEST.md` (atomic: write `.tmp` then `mv`)
- `~/.hermes/scripts/event-bus.sh publish curiosity_cycle '{"topic":"...","trigger":"...","brief":"archive/<epoch>.md","tokens":N}'`
- `~/.hermes/scripts/agent-radio.sh broadcast "curiosity: <topic> brief at ~/.hermes/curiosity/LATEST.md"` (best-effort, `|| true`)

---

## 4. STATE MODEL

**One DDL owner: D5 (`curiosity-state.sh`).** No other agent touches schema.

### 4.1 New tables (created idempotently on daemon start)

```sql
CREATE TABLE IF NOT EXISTS curiosity_topics (
  topic_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK(source IN ('rss','arxiv','web','internal')),
  source_url      TEXT,
  stale_days      INTEGER NOT NULL DEFAULT 7,
  last_surveyed_at INTEGER,
  survey_count    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curiosity_cycles (
  cycle_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  trigger_type    TEXT NOT NULL,
  topic           TEXT NOT NULL,
  evidence        TEXT,
  brief_path      TEXT,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','noop','error','budget_exceeded')),
  error           TEXT
);

CREATE TABLE IF NOT EXISTS curiosity_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed keys: last_cycle_at, daily_cycles_<YYYYMMDD>, daily_tokens_<YYYYMMDD>
```

### 4.2 Seed topics (inserted once by D5 on first run)

```sql
INSERT OR IGNORE INTO curiosity_topics(name,source,source_url,stale_days,created_at) VALUES
 ('AI agents & multi-agent orchestration','arxiv',NULL,7,strftime('%s','now')),
 ('LLM reasoning & planning','arxiv',NULL,5,strftime('%s','now')),
 ('tool-use & function calling','rss','https://hnrss.org/frontpage',7,strftime('%s','now')),
 ('Gideon mesh health patterns','internal',NULL,1,strftime('%s','now'));
```

### 4.3 Reuse (read-only) of existing tables
`gideon_events`, `gideon_goals`, `sessions`, `memory` — read-only queries only. No schema changes to existing tables.

---

## 5. SURFACING

| Channel | Mechanism | Audience |
|---|---|---|
| `~/.hermes/curiosity/LATEST.md` | Atomic file write | Kuttan (human review) + Gideon (acts on it) |
| `~/.hermes/curiosity/archive/<epoch>.md` | Copy | Audit trail |
| `event-bus.sh publish curiosity_cycle` | Row in `gideon_events` | Mesh (other daemons can subscribe) |
| `agent-radio.sh broadcast` | Best-effort radio | Live mesh awareness |
| `~/.hermes/curiosity/daemon.log` | Append | Debugging |

**Explicitly NOT used:** `session-digest-prefill.py` — keeps curiosity out of every gateway turn (avoids pollution). Kuttan reads `LATEST.md` when he chooses.

---

## 6. SAFETY / GUARDRAILS

| Concern | Mechanism |
|---|---|
| Bounded loop | Single pass per cycle; `sleep $THROTTLE_SEC` between; no recursion; no `while` inside children. |
| Token budget | Hard `MAX_TOKENS` per call; daily cap in `curiosity_state`; daemon refuses new cycle when exceeded. |
| Throttle | Min interval + max cycles/day, both persisted across restarts. |
| No config/code mutation | Daemon writes ONLY to `~/.hermes/curiosity/`, `curiosity_*` tables, `/tmp/curiosity.*`. Read-only on all scripts and other tables. |
| No deploy | Produces briefs only. Never calls `systemctl`, `git`, `pip`, `npm`. |
| Test isolation | `HERMES_HOME=/tmp/gideon-test` override; `curiosity-state.sh init` clones `state.db` schema into `$HERMES_HOME/state.db` scratch copy. `HERMES_HOME` overrides `HOME` in all child scripts. |
| Temp cleanup | `trap 'rm -f /tmp/curiosity.$$.*' EXIT` in every child. |
| Error handling | Every external call `|| { log error; status=error; }`; cycle always records a row in `curiosity_cycles` even on failure. |
| Single DDL owner | D5 owns `curiosity-state.sh` and is the only agent that issues `CREATE TABLE`. |
| Restart safety | `Type=simple`, `Restart=on-failure`, `RestartSec=30`, `StartLimitBurst=5`. |

---

## 7. CODEX SWARM PARTITION

Seven disjoint deliverables. Each agent owns distinct NEW files. No two agents touch the same file. D5 is the sole DDL owner.

### D1 — Main loop orchestrator
- **Owns:** `scripts/curiosity-daemon.sh`
- **Builds:** Always-on foreground loop. Sources env, calls sense→decide→fetch→synthesize→surface→state in order. Enforces throttle and budget. Logs to `~/.hermes/curiosity/daemon.log`. `trap` cleanup.
- **Commit msg:** `feat(curiosity): add always-on self-directed curiosity daemon loop`

### D2 — Sense stage
- **Owns:** `scripts/curiosity-sense.sh`
- **Builds:** Read-only sqlite3 queries against `state.db` for the 6 triggers in §2.1. Emits JSON trigger vector to stdout. Honors `HERMES_HOME`.
- **Commit msg:** `feat(curiosity): add internal-state sense stage with 6 trigger detectors`

### D3 — Fetch stage
- **Owns:** `scripts/curiosity-fetch.sh`
- **Builds:** Headless curl for rss/arxiv/web sources. Timeout, temp file, path on stdout. No API keys required.
- **Commit msg:** `feat(curiosity): add external-signal fetch stage (rss/arxiv/web)`

### D4 — Synthesize stage
- **Owns:** `scripts/curiosity-synthesize.sh`
- **Builds:** Sources `~/.hermes/.env` directly. Calls GLM via neuralwatt with `MAX_TOKENS` cap. Ollama fallback. Writes markdown to `/tmp/curiosity.<epoch>.md`. Reports tokens used on stdout.
- **Commit msg:** `feat(curiosity): add GLM synthesis stage with token cap and ollama fallback`

### D5 — State stage (DDL OWNER)
- **Owns:** `scripts/curiosity-state.sh`
- **Builds:** Idempotent DDL for `curiosity_topics`, `curiosity_cycles`, `curiosity_state`. Seed topics. Functions: `init`, `record-cycle`, `update-topic`, `get-kv`, `set-kv`, `budget-check`. Honors `HERMES_HOME` for test isolation.
- **Commit msg:** `feat(curiosity): add state stage owning curiosity_* DDL and budget tracking`

### D6 — Surface stage
- **Owns:** `scripts/curiosity-surface.sh`
- **Builds:** Atomic LATEST.md write, archive copy, event-bus publish, agent-radio broadcast. Creates `~/.hermes/curiosity/` and `archive/` dirs.
- **Commit msg:** `feat(curiosity): add brief surfacing via LATEST.md, event-bus, and agent-radio`

### D7 — Systemd unit (content only)
- **Owns:** `etc/systemd/system/gideon-curiosity.service` (content; Gideon installs)
- **Builds:** systemd unit file, `Type=simple`, `Restart=on-failure`, `ExecStart=/root/.hermes/scripts/curiosity-daemon.sh`, `Environment=HERMES_HOME=/root/.hermes`. Does NOT install — Gideon does.
- **Commit msg:** `feat(curiosity): add systemd unit file for gideon-curiosity service`

### Gideon's install step (NOT a Codex deliverable)
```bash
# 1. Install scripts to runtime dir (systemd ExecStart points THERE, not gideon-mesh/scripts)
install -m 755 scripts/curiosity-daemon.sh scripts/curiosity-sense.sh \
  scripts/curiosity-fetch.sh scripts/curiosity-synthesize.sh \
  scripts/curiosity-surface.sh scripts/curiosity-state.sh \
  ~/.hermes/scripts/
# 2. Install unit + enable
cp etc/systemd/system/gideon-curiosity.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now gideon-curiosity
# 3. Init schema + seed topics
~/.hermes/scripts/curiosity-state.sh init
```

### Verification checklist (Gideon runs after merge)
- [ ] All 6 scripts exist, are executable, `bash -n` passes
- [ ] `curiosity_topics`, `curiosity_cycles`, `curiosity_state` tables created in state.db (`.tables` shows them)
- [ ] Functional test against scratch DB (`HERMES_HOME=/tmp/gideon-test` + scratch state.db copy) — run one cycle, confirm a brief row + event land in the COPY, not the live DB
- [ ] Service `active`, `NRestarts=0`, `enabled` (reboot-persistent)
- [ ] Test rows cleaned from live state.db
- [ ] `git show --stat` confirms each agent only touched its assigned files
