# Gideon Power-Upgrades — 5-Phase Parallel Swarm Plan

Date: 2026-08-11
Owner: Gideon (orchestrator) — does NOT write code. GLM-5.2 planned. Codex 5.5 (gpt-5.5) implements via parallel worktrees.
Repo: ~/gideon-mesh (branch master, clean at c276894)

## Ground truth
- 13 systemd services live (gideon-*: consciousness, node-health, task-router, RAG, reranker, soulkeeper, background-mind, mesh-daemon, autonomous).
- ~/.hermes/state.db is 168MB and growing (Phase E fixes bloat).
- sqlite3, node, npm, docker present. NO redis, NO chromium/playwright (Phase C adds it).

## Swarm partition — disjoint file ownership (CRITICAL)
Each agent owns a disjoint set of NEW files under gideon-mesh/. NO agent touches:
- scripts/daemon files owned by others
- ~/.hermes/state.db schema of other phases
- existing phase-3 scripts

| Agent/Worktree | Phase | Owns (NEW files only) | New SQLite tables |
|----------------|-------|------------------------|-------------------|
| D5-critic | A (#5 Critic) | scripts/critic-agent.sh, scripts/critic-run.sh, docs/plans/critic.md | NONE — read-only on swarm output |
| D1-eventbus | B (#1 Event bus) | scripts/event-bus.sh, scripts/event-bus-subscribe.sh, scripts/event-bus-publish.sh, scripts/event-bus-daemon.sh | gideon_events |
| D2-tooling | C (#2 Tool layer) | docker/playwright/Dockerfile, docker/playwright/entrypoint.sh, scripts/http-tool.sh, scripts/browser-verify.sh | NONE |
| D3-goalqueue | D (#3 Goal queue) | scripts/goal-queue.sh, scripts/goal-decompose.sh, scripts/goal-schedule.sh | gideon_goals |
| D4-consolidation | E (#4 Memory consolidation) | scripts/consolidation-daemon.sh, scripts/consolidation-compress.sh, scripts/consolidation-prune.sh | gideon_mem_stats |

## Shared-state schema ownership (NO schema incest)
- gideon_events table: OWNED by D1-eventbus. Schema below. D3 and D4 MUST NOT create gideon_events.
- gideon_goals table: OWNED by D3-goalqueue. D1 MUST NOT create it.
- Distinct table names means no conflict, but EACH agent's task file MUST say "DO NOT add CREATE TABLE for any table you don't own."

gideon_events schema (D1):
```
CREATE TABLE IF NOT EXISTS gideon_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  consumed INTEGER DEFAULT 0
);
```

gideon_goals schema (D3):
```
CREATE TABLE IF NOT EXISTS gideon_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal TEXT NOT NULL,
  parent_id INTEGER,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
```

gideon_mem_stats schema (D4):
```
CREATE TABLE IF NOT EXISTS gideon_mem_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  episodic_count INTEGER,
  semantic_count INTEGER,
  db_size_bytes INTEGER
);
```

## What each phase delivers (design detail for agents)
See per-phase docs/plans/*.md written by each agent, PLUS these constraints:

### Phase A (#5 Critic) — D5-critic
Swarm role: after Codex writes, critic runs tests + spec check, accepts or sends back with feedback BEFORE merge. Pure orchestration.
- critic-agent.sh: reads a spec file + a worktree path, runs `git show --stat`, runs tests, outputs ACCEPT/REJECT + reasons.
- critic-run.sh: wrapper that calls critic-agent.sh, writes verdict to a results file.
- Do NOT touch agent-radio.sh or task-router.sh (others may own). Keep standalone.

### Phase B (#1 Event bus) — D1-eventbus
SQLite-backed pub/sub. Replace fixed polling with events. Existing daemons become subscribers (document how, don't refactor them in this phase — just build the bus + a demo subscriber).
- event-bus.sh: CLI: `event-bus.sh publish <type> <payload>`, `event-bus.sh subscribe <type> <handler>`, `event-bus.sh poll`.
- event-bus-daemon.sh: long-running subscriber loop that polls gideon_events and dispatches to handlers.
- Use sqlite3. No redis.

### Phase C (#2 Tool layer) — D2-tooling
Playwright Docker sidecar + HTTP tool + browser verify wrapper.
- docker/playwright/Dockerfile: FROM mcr.microsoft.com/playwright, install node deps.
- scripts/http-tool.sh: curl wrapper — GET/HEAD a URL, return status + hash of body (for deploy verification).
- scripts/browser-verify.sh: drives playwright sidecar to open a URL, wait for a selector, report status.
- Note in README: ~200MB RAM cost. Provide docker run/exec example.

### Phase D (#3 Goal queue) — D3-goalqueue
Hierarchical goal queue with resume-after-restart.
- goal-queue.sh: CLI to add/list/update goals + subgoals (parent_id), dependency edges, status transitions.
- goal-decompose.sh: takes a high-level goal, prompts GLM (via env GLM_API_URL) or falls back to a hardcoded decomposition for a demo, writes subgoals.
- goal-schedule.sh: picks next actionable task (status=pending, no unmet deps), marks in_progress.
- Must persist to gideon_goals so a restarted process resumes.

### Phase E (#4 Memory consolidation) — D4-consolidation
Idle-time (3-4am) compression of episodic->semantic, prune stale, cross-link.
- consolidation-daemon.sh: reads ~/.hermes/state.db (episodic memory), computes stats, writes gideon_mem_stats.
- consolidation-compress.sh: summarizes episodic clusters into semantic nodes (uses cheap model via env or a stub), writes back.
- consolidation-prune.sh: flags stale facts, reports candidates (do NOT hard-delete — report only).
- Must be safe: read-only on state.db, only writes its own gideon_mem_stats table.

## Verification (per phase, done AFTER merge by Gideon)
- Each script exists, is executable, bash -n passes.
- Event bus: publish -> poll -> subscriber receives.
- Goal queue: add parent + child -> schedule picks child.
- Critic: run on a known-good worktree -> ACCEPT.
- Tool layer: docker image builds; http-tool.sh HEAD returns 200 + hash.
- Consolidation: runs, writes gideon_mem_stats row.
- No phase modifies another phase's files (git show --stat check).

## Merge order (all disjoint -> clean)
1. Merge D5-critic, D2-tooling (no shared tables) in any order
2. Merge D1-eventbus, D3-goalqueue, D4-consolidation (distinct tables, no conflict)
3. git branch -d each, git worktree remove
4. Report per-phase verification results.
