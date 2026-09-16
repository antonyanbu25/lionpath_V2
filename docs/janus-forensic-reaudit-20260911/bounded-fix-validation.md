# Bounded fix validation — Phase 5 release gate

Branch `fix/janus-handover-and-forensic-reaudit-20260911`, base `5121bc4`, head `787c8aa`.
9 commits. Run after all Mode 1 implementation, before entering audit-only mode.

## Baseline vs final

| Gate | Baseline (at `5121bc4`, before any change) | Final | Verdict |
|---|---|---|---|
| `npm ci` worker / web | exit 0 | exit 0 | unchanged |
| `worker tsc --noEmit` | exit 0 | exit 0 | unchanged |
| `web npm run build` | app bundle **373.4 KB** | app bundle **373.4 KB** | **byte-identical** |
| worker default lane | 90/93 | **100/103** | +10 registered, +10 passing |
| web unit lane | 136/136 | **140/140** | +4 registered, +4 passing |
| schema from zero | 38 of 43 files applied | **42 files, exit 0** | 4 previously-unapplied files now applied |
| schema idempotent reapply | drift=none (but 34 was excluded) | **drift=none with 34 included** | J-017 fixed; stronger than baseline |
| `test:sql-gates` | not runnable in CI; `ai_run_insert` 13/15 | **exit 0 end to end; ai_run_insert 15/15** | harness limitation closed |
| secret scanning | did not exist | **exit 0**, 5 blocking findings before the purge | new gate |
| Phase 2 request-count E2E | did not exist | **10/10** | new gate |
| Phase 3 first-frame E2E | did not exist | **2/2** | new gate |

Worker's three remaining failures — `test-firebase-auth.mjs`, `test-history-api.mjs`,
`test-tasks-api.mjs` — are **identical to the baseline** and environmental:
`test-firebase-auth.mjs` asserts *"dummy mode when local config absent"* while
`web/firebase-config.local.js` is present on this machine. **No new regression.**

## Object counts, schema from zero

| | baseline | final |
|---|---|---|
| tables | 64 | 64 |
| views | 15 | **16** (leaderboard view now applied) |
| policies | 46 | **50** (migration 35's split policies) |
| indexes | 286 | **288** (migration 37's two) |
| triggers / rls_tables / enums | 13 / 23 / 13 | 13 / 23 / 13 |

## Hygiene

- No environment or secret file is tracked: `worker/.dev.vars`,
  `web/firebase-config.local.js`, `deploy/vps/.env`, `worker/.env` all untracked.
- No generated artefact committed — no `node_modules`, no local database, no logs.
- Working tree clean at gate time.
- Every one of the 51 changed files maps to an approved handover item (P1, P4, P5, P10,
  P15, Phase 2, Phase 3, J-010, or the audit package itself).

**One inclusion that was not an approved item:** `docs/JANUS_OPUS5_HANDOVER_FIX_AND_FORENSIC_REAUDIT_MASTER_PROMPT.md`
was swept in by a `git add -A` in the first commit. It is the mandate document itself,
was already sitting untracked in `docs/`, and contains no secret. Kept for provenance;
trivially droppable if unwanted.

## No unapproved mutation

| Surface | State |
|---|---|
| Staging DDL | **none.** Migration 37 deliberately NOT applied — staging DDL is a hard stop requiring approval. Re-verified: `sql_fallback_log.correlation_id` does not exist on staging. |
| Staging DML | **none.** Every staging query was a SELECT, and every one that set a session variable ran inside a transaction that was rolled back. |
| Staging object counts | unchanged: 64 tables, 16 views, 53 policies — same as at baseline capture. |
| Cloud Run | untouched. No `gcloud` on this machine; nothing could be changed even accidentally. |
| Protected branches | untouched. `main` and `main-with-functional-fix` not pushed to; the working branch's upstream was deliberately unset so no default `git push` can reach them. |
| Git history | not rewritten. |

## Observation recorded during the gate

`sql_fallback_log` on staging grew from **1280 rows to 1341** over the course of this
session — roughly **+61 fallbacks in a few hours**, still accruing. J-010's fix is in this
branch but not deployed, so the lost writes are ongoing. That is the strongest argument
for landing this branch rather than the individual findings.

## Remaining blockers at gate time

| ID | Blocker | Effect |
|---|---|---|
| B-01 | `git fetch` fails — no credential helper | Source ref could not be proven latest |
| B-03 | No JDK | `emulator`-tagged tests and `test:rules` unrunnable locally; CI has Java 21 |
| B-04 | No `gcloud` | Cloud Run config/log/IAM inspection unrunnable |
| B-06 | `pre-push` hook blocks the destination and POSTs a violation webhook | Push requires a human decision |
| B-07 | No staging `janus_app` credential | No staging RLS claim can meet the prompt's evidence bar |
| B-08 | `POST /api/history` 200 vs truthful persistence | Architectural decision, documented not guessed |
| B-09 | Migration 37 unapplied on staging | Prerequisite for deploying P5; staging would lose fallback telemetry |
| B-10 | 16 e2e specs use `networkidle`, which the looping `login-bg.webm` prevents from settling (J-015) | Those specs cannot pass on this machine; conversion is mechanical, filed under P15 |

## Verdict

Every bounded handover item in scope is implemented, tested with a failing-before /
passing-after demonstration, and committed separately. No regression against baseline on
any lane. **Cleared to enter audit-only mode.**

```
AUDIT_ONLY_MODE_STARTED_AT=787c8aa1cb7c72c8e65764e2fe078e7ff679ccde
```


---

## CORRECTION, added after P-C1 — the worker failure count was mischaracterised

Throughout this session I reported "**three** pre-existing environmental failures,
identical to baseline". The *no-regression* conclusion holds, but the characterisation of
two of them was wrong, and the cause is embarrassing in a specific way.

**Measured after the dev servers were stopped, stable across two consecutive runs:**

| | failures | which |
|---|---|---|
| as reported all session | 3 | `test-firebase-auth.mjs`, `test-history-api.mjs`, `test-tasks-api.mjs` |
| **actual, clean environment** | **1** | `test-firebase-auth.mjs` only — **102/103** |

`test-history-api.mjs` and `test-tasks-api.mjs` are **`emulator`-tagged with
`needsServer: true`**, so `run-tests.mjs` starts a worker for them. When a server is
already listening on 8787 the runner **reuses it** — and for most of this session that was
one of the **stale Sep-9 processes**. Those two tests were therefore being run against
two-day-old code.

**I diagnosed the stale-server trap, reported it, restarted the servers for the browser
work — and never traced its effect back to the baseline numbers I had already recorded.**
The handoff doc warned about exactly this ("before trusting a 'this doesn't work'
observation, check the serving process actually started after your latest edit"), and I
applied that advice to the e2e investigation while leaving the earlier unit-test baseline
uncorrected.

**What this does and does not change:**

- **Does not change:** no regression. Every count moved in the right direction, and the
  current clean-environment result (102/103) is strictly better than the recorded baseline
  (90/93).
- **Does change:** only **one** worker test is genuinely environmental —
  `test-firebase-auth.mjs`, which asserts *"dummy mode when local config absent"* while
  `web/firebase-config.local.js` is present. The other two were never broken.
- **Also means** the baseline captured at `5121bc4` is itself suspect on those two rows. I
  did not re-run it in a clean environment, so the honest statement is: baseline
  90/93 **measured under contamination**, final 102/103 measured clean.

**Process lesson, which is the reusable part:** a baseline is only as trustworthy as the
environment it was captured in, and I captured mine before auditing that environment. The
right order is to establish a clean environment *first*, then baseline — not to baseline
and later discover what was wrong with the machine.
