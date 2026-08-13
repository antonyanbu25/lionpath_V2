# Gideon Self-Directed Curiosity — Architecture Plan

**Date:** 2026-08-13
**Planner:** GLM 5.2 (neuralwatt) + Gideon (assembled, sections 5–7 completed by Gideon)
**Status:** Ready for green light → Codex swarm

## 1. ARCHITECTURE OVERVIEW

**Decision: New cron-triggered daemon, NOT embedded in background_mind.py.**

Rationale: `background_mind.py` is the continuously-running limbic system with its own concerns. Curiosity is a periodic, bounded, single-pass pipeline — it matches the existing `consolidation-daemon.sh` pattern exactly (cron.d entry → bash script → sqlite3 + event-bus). Embedding it in background_mind would couple failure modes and make the limbic loop harder to reason about. A standalone daemon with a cron trigger keeps the curiosity loop isolated, restartable, and observable through the same event-bus channel everything else uses.

**Data flow:**

```
/etc/cron.d/gideon-curiosity (04:00 daily)
  │
  ▼
~/.hermes/scripts/curiosity-daemon.sh        ← orchestrator (D6)
  │
  ├─ 1. PICK TOPIC
  │     round-robin pointer in curiosity_cycles table
  │     reads config/curiosity-topics.list
  │
  ├─ 2. INTERNAL RETRIEVAL
  │     sqlite3 queries against:
  │       - memory (WHERE key LIKE '%<topic>%')
  │       - sessions / session digest (latest from consolidation)
  │       - mesh_consciousness (latest snapshot)
  │     → /tmp/curiosity-<cycle>-internal.json
  │
  ├─ 3. EXTERNAL SIGNAL
  │     ~/.hermes/scripts/curiosity-fetch.sh  ← (D3)
  │       curl RSS/arxiv feeds (hardcoded source list)
  │       --max-time 30 per source, max 5 sources
  │       grep/filter by topic keywords
  │     → /tmp/curiosity-<cycle>-external.json
  │
  ├─ 4. SYNTHESIZE
  │     ~/.hermes/scripts/curiosity-synthesize.sh  ← (D4)
  │       calls curiosity-call-model.sh  ← (D2)
  │         source ~/.hermes/.env (set -a; . ~/.hermes/.env; set +a)
  │         curl GLM via neuralwatt API
  │         MAX_TOKENS=4000
  │       prompt = internal.json + external.json + topic
  │     → ~/.hermes/curiosity/briefs/YYYY-MM-DD-<slug>.md
  │
  ├─ 5. SURFACE
  │     ~/.hermes/scripts/curiosity-surface.sh  ← (D5)
  │       event-bus.sh publish type=curiosity_cycle
  │       ln -sf briefs/YYYY-MM-DD-<slug>.md ~/.hermes/curiosity/LATEST.md
  │       agent-radio.sh broadcast
  │
  └─ 6. CLOSE
        UPDATE curiosity_cycles SET status='completed', completed_at=<epoch>
```

**Where findings land:**
- Primary artifact: `~/.hermes/curiosity/briefs/YYYY-MM-DD-<topic-slug>.md` (markdown, human-readable, what Kuttan reviews)
- Convenience pointer: `~/.hermes/curiosity/LATEST.md` (symlink to most recent)
- Event bus record: `gideon_events` table, type=`curiosity_cycle` (so the rest of the mesh can react)
- Cycle audit trail: `curiosity_cycles` table (new, see §4)

**How findings get surfaced to Kuttan:**
- Kuttan reads `~/.hermes/curiosity/LATEST.md` each morning (file-based, no coupling to prefill hook)
- The event-bus publish means any mesh agent (including background_mind) can pick up the curiosity event and reference it
- agent-radio broadcast lets peer mesh nodes see the brief exists
- Deliberately NOT injected into session-digest-prefill.py — that would require modifying an existing owned file and would pollute every gateway turn. Kuttan reviews briefs on his own terms.

## 2. TRIGGER

**Mechanism:** `/etc/cron.d/gideon-curiosity` (cron, not systemd timer — matches the consolidation-daemon precedent)

**Schedule:** `0 4 * * *` — daily at 04:00

**Justification:**
- Consolidation runs at 03:05 and takes ~30 min → session digest is fresh by 04:00
- 04:00 is lowest system load
- Kuttan reviews in the morning; brief is ready before he starts
- Daily cadence is enough to be "curious" without being noisy; can be increased later by editing one cron line
- One cycle per day = natural rate limit

**cron.d file format:**
```
# /etc/cron.d/gideon-curiosity
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 4 * * * root /root/.hermes/scripts/curiosity-daemon.sh >> /root/.hermes/logs/curiosity.log 2>&1
```

**Validation:** `run-parts --test /etc/cron.d` after install.

## 3. CURIOSITY CYCLE (detailed)

### (a) Topic Selection
- Curated topic list at `~/.hermes/config/curiosity-topics.list` (one topic per line, plain text)
- Initial topics:
  ```
  agent-harness-architecture
  multi-agent-orchestration-patterns
  llm-routing-and-dispatch
  memory-consolidation-strategies
  self-evaluation-and-critic-loops
  tool-use-and-function-calling
  agent-safety-and-guardrails
  mesh-topology-and-peer-discovery
  session-context-management
  autonomous-goal-decomposition
  ```
- Round-robin pointer: query `curiosity_cycles` for the last completed topic, pick the next line (wrap around)
- Fallback if table empty: first topic

### (b) Internal Retrieval
Direct `sqlite3 ~/.hermes/state.db` queries (read-only):
- `SELECT key, value, updated_at FROM memory WHERE key LIKE '%<topic>%' OR value LIKE '%<topic>%' ORDER BY updated_at DESC LIMIT 20;`
- `SELECT * FROM mesh_consciousness ORDER BY rowid DESC LIMIT 1;`
- `SELECT goal, status, created_at FROM gideon_goals WHERE goal LIKE '%<topic>%' LIMIT 10;`
- Output: `/tmp/curiosity-<cycle_id>-internal.json` (constructed via `sqlite3 -json`)

### (c) External Signal
- Source list: hardcoded inside `curiosity-fetch.sh` (D3 owns the file; avoids cross-agent file ownership of a shared config)
- Initial sources:
  ```
  https://hnrss.org/frontpage
  https://export.arxiv.org/rss/cs.AI
  https://export.arxiv.org/rss/cs.CL
  https://www.reddit.com/r/LocalLLaMA/.rss
  ```
- Mechanism: `curl --silent --max-time 30 <url>` per source, pipe through `grep -i <topic-keywords>` to filter
- Max 5 sources, 30s timeout each, total external fetch budget = 150s
- Extract: title, link, pubDate for matching items
- Output: `/tmp/curiosity-<cycle_id>-external.json`
- Fully headless: curl + grep + jq, no browser, no JS rendering

### (d) Reason and Synthesize
- Script: `curiosity-synthesize.sh` calls `curiosity-call-model.sh`
- Model: GLM via neuralwatt API (primary), with ollama fallback if neuralwatt is unreachable
- API key retrieval:
  ```bash
  set -a
  . /root/.hermes/.env
  set +a
  ```
- API call: `curl --max-time 120 -s https://api.neuralwatt.com/v1/chat/completions -H "Authorization: Bearer ${NEURALWATT_KEY}" -H "Content-Type: application/json" -d '{"model":"glm-5.2","max_tokens":4000,"messages":[...]}'`
- Prompt structure (system + user):
  - System: "You are Gideon's curiosity subsystem. Given internal state and external signals about <topic>, write a concise brief (max 800 words) covering: (1) what's new in the external landscape, (2) how Gideon is currently built regarding this topic, (3) 1-3 concrete changes Gideon should consider, (4) open questions. Be specific and actionable. Do not suggest code changes — only conceptual/architectural recommendations."
  - User: JSON blob with internal.json + external.json
- Token budget: `MAX_TOKENS=4000` (hard limit in API call)
- Fallback to ollama: if neuralwatt returns non-200 or times out, call `ollama run glm4:latest` locally with same prompt (lower quality but keeps the loop running)

### (e) Write Brief
- Output path: `~/.hermes/curiosity/briefs/$(date +%Y-%m-%d)-<topic-slug>.md`
- Brief format (markdown):
  ```markdown
  # Curiosity Brief: <Topic>
  **Date:** YYYY-MM-DD
  **Cycle ID:** <id>
  **Model:** <model-name>
  **Sources reviewed:** <count>

  ## Landscape (External)
  ...

  ## Gideon's Current State (Internal)
  ...

  ## Recommended Changes
  1. ...
  2. ...

  ## Open Questions
  - ...

  ## Sources
  - [title](url)
  ...
  ```
- After writing: call `curiosity-surface.sh` with the brief path and cycle ID

## 4. STATE MODEL

**One new table. Owned by D1 (exactly one Codex agent).**

```sql
-- /root/gideon-mesh/scripts/sql/curiosity-schema.sql
CREATE TABLE IF NOT EXISTS curiosity_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  brief_path TEXT,
  source_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  model TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_curiosity_cycles_started ON curiosity_cycles(started_at);
CREATE INDEX IF NOT EXISTS idx_curiosity_cycles_topic ON curiosity_cycles(topic);
```

**No other new tables.** Topics are a flat file. Briefs are files. Events go into the existing `gideon_events` table.

## 5. SURFACING

The brief reaches Kuttan and the mesh through three independent, idempotent channels, all invoked from `curiosity-surface.sh` after the brief is written and the `curiosity_cycles` row is updated to `status='complete'`.

### 5.1 LATEST.md symlink (Kuttan's read path)
Kuttan reads a single stable path. The surface script atomically repoints the symlink:
```bash
BRIEF_PATH="$HOME/.hermes/curiosity/briefs/${TODAY}-${SLUG}.md"
ln -sfn "$BRIEF_PATH" "$HOME/.hermes/curiosity/LATEST.md"
```
`-n` prevents dereferencing an existing symlink-to-symlink; `ln -sf` is atomic on POSIX filesystems. No file under `session-digest-prefill.py` is touched.

### 5.2 Event-bus publish (mesh signal)
The surface script emits a single typed event so any subscriber (background_mind, agent-radio, future hooks) can react:
```bash
~/.hermes/scripts/event-bus.sh publish gideon_events \
  '{"type":"curiosity_cycle","topic":"<topic>","brief_path":"<path>","model":"<model>","source_count":N,"tokens_used":N}'
```
The event lands in `gideon_events` (existing table) with `type='curiosity_cycle'`. Subscribers filter on that type.

### 5.3 Agent-radio broadcast (audible mesh channel)
A short human-readable announcement for any agent listening on the radio channel:
```bash
~/.hermes/scripts/agent-radio.sh broadcast \
  "curiosity_cycle complete: topic='<topic>' brief=<path> sources=N tokens=N model=<model>"
```

### 5.4 Mesh reactions
- **background_mind**: subscribes to `type=curiosity_cycle` via its existing event-bus poller. On receipt it may (a) read `LATEST.md` and append a one-paragraph reference into its next reflection cycle, (b) bump a `curiosity_seen_at` timestamp in its own state. It must NOT re-broadcast or re-synthesize.
- **Other mesh agents**: may subscribe to `curiosity_cycle` and treat the brief as retrieval context only. No agent other than `curiosity-daemon.sh` may write to `~/.hermes/curiosity/briefs/` or update `curiosity_cycles`.
- **Kuttan**: reads `LATEST.md` lazily on session start; if the file's mtime is older than 24h it logs a stale-brief notice but does not fail.

## 6. SAFETY / GUARDRAILS

Each rule is enforced in code, not by convention.

1. **Token budget**: `MAX_TOKENS=4000` is exported by `curiosity-daemon.sh` and read by `curiosity-call-model.sh`. The model call truncates at 4000 output tokens; if the synthesizer would exceed it, the prompt is pruned (drop oldest source chunks first) before the call.
2. **Rate limit**: exactly one cron trigger per day, `0 4 * * *` in `/etc/cron.d/gideon-curiosity`. The daemon refuses to start if `curiosity_cycles` already contains a row with `started_at >= today 00:00` (idempotency guard).
3. **No infinite recursion**: `curiosity-daemon.sh` is a single-pass, non-looping script. It runs pipeline stages sequentially and exits. No `while`, no `tail -f`, no daemonizing `&`. Sub-scripts are invoked once each via `set -e` chain.
4. **External fetch budget**: `curiosity-fetch.sh` enforces `MAX_SOURCES=5` and `CURL_TIMEOUT=30` (`curl --max-time 30 --connect-timeout 10`). It stops after 5 successful fetches or first hard failure, whichever comes first. No retries.
5. **No config mutation**: no script in the pipeline may write to `~/.hermes/config.yaml`, `~/.hermes/config/`, or any file under `/etc/`. Writes are restricted to `~/.hermes/curiosity/briefs/`, `~/.hermes/logs/curiosity.log`, the `curiosity_cycles` table, and the `gideon_events` table.
6. **No code deployment**: no script may `git pull`, `git checkout`, `pip install`, `npm install`, write to any repo working tree, or modify `~/.hermes/scripts/`. The pipeline only reads scripts and writes briefs/rows.
7. **Test isolation**: all functional tests run with `HERMES_HOME=/tmp/curiosity-test-$$` and a scratch copy of `state.db` (`cp ~/.hermes/state.db "$HERMES_HOME/state.db"`). Because `HERMES_HOME` overrides `HOME` in every script via `HOME="${HERMES_HOME:-$HOME}"` at the top of each script, no test ever touches the live DB.
8. **Temp file cleanup**: every script uses `trap 'rm -f "$TMPDIR"/curiosity.*' EXIT` with `TMPDIR=$(mktemp -d -t curiosity.XXXXXX)`. No `/tmp/curiosity-*` file survives script exit, success or failure.
9. **Error handling**: every failure path sets `status='error'` and writes the failure message into the `error` column of the current `curiosity_cycles` row, then appends `[ERROR] $(date -Iseconds) stage=$STAGE msg=$MSG` to `~/.hermes/logs/curiosity.log`. The daemon exits non-zero so cron reports it.
10. **Single owner for DDL**: exactly one Codex agent (D1) owns the `curiosity_cycles` schema file. No other agent may emit `CREATE TABLE curiosity_cycles` or `ALTER TABLE curiosity_cycles`.
11. **Source attribution**: every brief includes a `## Sources` section with one line per source. Briefs without a sources section are rejected by `curiosity-synthesize.sh` before write.
12. **Model fallback is explicit**: `curiosity-call-model.sh` tries GLM via neuralwatt first; on non-zero exit or HTTP non-200 it logs the failure and falls back to `ollama run glm4:latest`. If both fail, the cycle is marked `status='error'` with `error='model_unavailable'`. No silent empty brief.

## 7. CODEX SWARM PARTITION

Six disjoint deliverables. Each agent owns only the files listed; no two agents touch the same path. D1 is the sole owner of the `curiosity_cycles` DDL.

### D1 — Schema + topics config (owns DDL)
- **Owns (new files):**
  - `scripts/sql/curiosity-schema.sql` (in gideon-mesh repo)
  - `config/curiosity-topics.list` (in gideon-mesh repo)
- **Builds:** `CREATE TABLE curiosity_cycles (...)` + 2 indexes (exact DDL in §4). Topics file: one topic per line, plain text, UTF-8, no comments.
- **Commit message:** `curiosity: add curiosity_cycles schema and topics list`

### D2 — Model caller
- **Owns (new file):**
  - `scripts/curiosity-call-model.sh` (in gideon-mesh repo)
- **Builds:** Bash script. Reads `MAX_TOKENS` (default 4000) and a prompt on stdin. Sources `~/.hermes/.env` (set -a; . ; set +a) to get the neuralwatt key. Calls GLM via neuralwatt endpoint. On non-zero exit or HTTP non-200, falls back to `ollama run glm4:latest`. Writes model response to stdout, model name used to stderr as `MODEL=<name>`. Exits non-zero only if both paths fail.
- **Commit message:** `curiosity: add model caller with GLM/ollama fallback`

### D3 — External fetcher
- **Owns (new file):**
  - `scripts/curiosity-fetch.sh` (in gideon-mesh repo)
- **Builds:** Bash script. Takes a topic as `$1`. Hits a fixed list of RSS/arxiv endpoints (hardcoded inside the script — D3 owns this file so no shared-config conflict). Enforces `MAX_SOURCES=5`, `curl --max-time 30 --connect-timeout 10`. Outputs JSONL: `{"url":..., "fetched_at":..., "sha256":..., "content":...}`. No retries.
- **Commit message:** `curiosity: add external fetcher (RSS/arxiv, 5-source budget)`

### D4 — Synthesizer
- **Owns (new file):**
  - `scripts/curiosity-synthesize.sh` (in gideon-mesh repo)
- **Builds:** Bash script. Takes topic + JSONL sources on stdin. Builds a prompt capped so output stays under `MAX_TOKENS=4000` (prune oldest sources first). Calls `curiosity-call-model.sh`. Validates output has a `## Sources` section. Writes brief to `~/.hermes/curiosity/briefs/${TODAY}-${SLUG}.md`. Echoes `BRIEF_PATH`, `SOURCE_COUNT`, `TOKENS_USED`, `MODEL` to stderr for the daemon to capture.
- **Commit message:** `curiosity: add synthesizer with source attribution and token pruning`

### D5 — Surfacing
- **Owns (new file):**
  - `scripts/curiosity-surface.sh` (in gideon-mesh repo)
- **Builds:** Bash script. Takes `BRIEF_PATH`, `TOPIC`, `SOURCE_COUNT`, `TOKENS_USED`, `MODEL` as args. Repoints `~/.hermes/curiosity/LATEST.md` symlink (`ln -sfn`). Publishes event via `event-bus.sh publish gideon_events '{"type":"curiosity_cycle",...}'`. Broadcasts via `agent-radio.sh broadcast`. Idempotent — safe to re-run.
- **Commit message:** `curiosity: add surfacing (LATEST.md symlink, event-bus, agent-radio)`

### D6 — Orchestrator daemon + cron
- **Owns (new files):**
  - `scripts/curiosity-daemon.sh` (in gideon-mesh repo)
  - `etc/cron.d/gideon-curiosity` (in gideon-mesh repo)
- **Builds:** Bash orchestrator. Single-pass, non-looping. Stages: pick topic (round-robin from curiosity_cycles + topics.list) → internal retrieval (sqlite3 state.db) → call D3 fetch → call D4 synthesize → call D5 surface → close (UPDATE curiosity_cycles). Idempotency guard (refuse if a cycle started today). Error handling per §6.9. Writes to `~/.hermes/logs/curiosity.log`.
- **Commit message:** `curiosity: add orchestrator daemon and cron schedule`

## Install step (Gideon's job, after merge — NOT the agents')

```bash
# 1. Copy daemon scripts into ~/.hermes/scripts/ (systemd/cron ExecStart points THERE, not gideon-mesh/scripts)
install -m 755 scripts/curiosity-daemon.sh scripts/curiosity-call-model.sh \
  scripts/curiosity-fetch.sh scripts/curiosity-synthesize.sh scripts/curiosity-surface.sh \
  ~/.hermes/scripts/
# 2. Install schema + config
mkdir -p ~/.hermes/config ~/.hermes/curiosity/briefs
cp config/curiosity-topics.list ~/.hermes/config/
sqlite3 ~/.hermes/state.db < scripts/sql/curiosity-schema.sql
# 3. Install cron entry
cp etc/cron.d/gideon-curiosity /etc/cron.d/ && chmod 644 /etc/cron.d/gideon-curiosity
# 4. Verify
run-parts --test /etc/cron.d/
bash -n ~/.hermes/scripts/curiosity-daemon.sh
```

## Verification checklist (Gideon, after merge)
- [ ] All 5 scripts exist, are executable, `bash -n` passes
- [ ] `curiosity_cycles` table created in state.db (`.tables` shows it)
- [ ] Functional test against scratch DB (`HERMES_HOME=/tmp/curiosity-test-$$` + scratch state.db copy) — run daemon, confirm a brief row + event land in the COPY, not the live DB
- [ ] cron.d entry passes `run-parts --test /etc/cron.d/`
- [ ] Test rows cleaned from live state.db
- [ ] `git show --stat` confirms each agent only touched its assigned files
