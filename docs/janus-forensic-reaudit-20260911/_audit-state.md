# Janus forensic re-audit — audit state

**Session start:** 2026-09-11 (UTC+0530 host)
**Operator model:** Claude Opus 5
**Prompt:** `JANUS_OPUS5_HANDOVER_FIX_AND_FORENSIC_REAUDIT_MASTER_PROMPT.md`

---

## Current phase

`MODE 1 / Phase 0` — **COMPLETE** (2 gates RUNTIME-BLOCKED)
`MODE 1 / Phase 1` — **substantially complete**; reconciliation drafted
`MODE 1` — **COMPLETE**. Phase 2 (triple-resolve, root-caused), Phase 3 (transient
Analyse enable, fixed), Phase 4.1 (P1), 4.3 (P4), 4.4 (P5), 4.5 (P10), 4.2 (P15), plus
J-010 pulled in on explicit user authorisation. Phase 5 release gate passed — see
`bounded-fix-validation.md`.

`MODE 2 / audit-only` — STARTED.

```
AUDIT_ONLY_MODE_STARTED_AT=787c8aa1cb7c72c8e65764e2fe078e7ff679ccde
```

From this point product code, schema, tests, dependencies, infrastructure, deployment
files, environment files and CI are frozen for this session. Only documentation,
evidence, disposable local fixtures and approved `JANUS_AUDIT_TEST` staging records
may be created.

---

## Ref facts (Gate A)

| Key | Value |
|---|---|
| `SOURCE_BRANCH` | `main-with-functional-fix` |
| `SOURCE_SHA` | `5121bc4870a40dec793c98b98a38f8adbfef4789` |
| `MAIN_SHA` (origin) | `5121bc4870a40dec793c98b98a38f8adbfef4789` |
| `MAIN_SHA` (local) | `f6cfbbd1625c328822ccb4ca7f12f0118b7c91d7` |
| `MERGE_BASE_WITH_MAIN` | `5121bc4870a40dec793c98b98a38f8adbfef4789` |
| `WORKING_BRANCH` | `fix/janus-handover-and-forensic-reaudit-20260911` |
| `WORKING_BASE_SHA` | `5121bc4870a40dec793c98b98a38f8adbfef4789` |

**Material observation:** `origin/main-with-functional-fix` and `origin/main` are the
**identical SHA** (`5121bc4`). The prompt treats them as distinct refs with distinct
roles; on the last-fetched state they are the same commit. Any reasoning that depends
on them differing is `STALE`.

**Local `main` is 1 commit ahead of `origin/main`** (`f6cfbbd`, adds
`docs/astra-audit/13-handoff-next-session.md`). That commit is NOT on the working
branch base. The handoff doc is readable via
`git show f6cfbbd:docs/astra-audit/13-handoff-next-session.md`.

Working branch upstream was deliberately **unset** so that no default `git push`
can reach a protected branch.

---

## BLOCKERS (Phase 0)

| ID | Blocker | Status | Impact |
|---|---|---|---|
| B-01 | `git fetch` fails: `could not read Username for 'https://github.com'` — no credential helper | `RUNTIME-BLOCKED` | Cannot prove source ref is *latest*. Baseline uses refs last fetched **2026-09-11 16:01:10**. Prompt Phase 0.2 requires "exact latest origin/main-with-functional-fix" — UNPROVEN. |
| B-02 | ~~No local PostgreSQL~~ | **RESOLVED** | `embedded-postgres@18.4.0-beta.17` is a worker devDependency with darwin-arm64 support. Disposable cluster stood up on port 55432, data dir in session scratchpad. Schema applied from zero and reapplied: **idempotent, drift=none**. Phase 10 is therefore unblocked. |
| B-03 | No Java runtime | `RUNTIME-BLOCKED` | Firestore-emulator tests cannot run. Phase 4.2 explicitly requires adding Java for emulator tests. |
| B-04 | No `gcloud` / `cloud-sql-proxy` | `RUNTIME-BLOCKED` | Cloud Run config/log/IAM read-only inspection (Phases 6, 11, 12, 14) cannot run. |
| B-05 | Playwright installed, but 6+ e2e specs fail on `page.reload({waitUntil:"networkidle"})` timeout | **PARTIAL / environment** | Browser launches and the dev server answers on `127.0.0.1:8788`, so this is not a missing-browser problem. `networkidle` cannot settle while a live Firebase socket is open, and `web/firebase-config.local.js` is present so `authMode()` is `firebase`, not `dummy`. 16 web scripts use `networkidle`. Classified **environment-dependent test design**, not a product defect — but it means Phase 2/3 request-count E2E cannot run as written on this machine. |
| B-06 | Push to `origin` is blocked by `.git/hooks/pre-push` corporate org allowlist, which also POSTs a `GIT_PUSH_POLICY_VIOLATION` webhook to `ghc.freshpo.com` | NEEDS USER DECISION | Phase 5 requires pushing the working branch. Bypassing a corporate DLP control requires explicit human authorization; not taken unilaterally. See J-009. |
| B-07 | No `janus_app` credential — only the `postgres` superuser is configured | `RUNTIME-BLOCKED` | Phase 7 explicitly requires proving "RLS and grants operate as `janus_app`, not only as a superuser". The one available staging credential is the one the prompt says is insufficient. Every RLS/grant claim against **staging** is therefore unprovable; the local disposable cluster seeds `janus_app` and can carry those gates instead. |

---

## Staging database authority — as configured this session

- Credential present: `DATABASE_URL_MIGRATIONS` in `worker/.dev.vars` (**`postgres` superuser**).
- `DATABASE_URL` (the `janus_app` RLS-enforced runtime role) is **NOT configured**.
- Consequence: prompt Phase 7 requires proving "RLS and grants operate as `janus_app`,
  not only as a superuser". That is currently **`RUNTIME-BLOCKED`** — the only available
  credential is the one the prompt says is insufficient.
- Staging instance: `janus-db` / `8.231.110.188:5432` / db `janus` / PostgreSQL **16.14**.
- Access granted by adding egress IP `134.231.182.20/32` to instance authorized networks.
- **No DDL, no DML, no mutation performed.** Read-only inspection only.

---

## Repository instruction files (Phase 0.1)

| File | Applies? |
|---|---|
| `AGENTS.md` | ABSENT |
| `CLAUDE.md` | ABSENT |
| `.cursorrules` | ABSENT |
| `.cursor/rules/push-antony-2.1.mdc` | PRESENT but `NOT-APPLICABLE` — governs branch `2.1` of a *different* repo (`antonyanbu25/lionpath_V2`); no bearing on SE-Labs refs in scope |
| `.claude/settings.local.json` | PRESENT — permission allowlist only; contains no engineering policy |
| `.git/hooks/pre-push` | PRESENT and ACTIVE — corporate org allowlist + violation webhook (see B-06) |

---

## Completed coverage

- [x] Phase 0.1 instruction files recorded
- [x] Phase 0.2 working branch created from source ref (exact copy verified, empty diff)
- [x] Phase 0.3 worktree confirmed clean
- [x] Phase 0.4 runtime/tooling inventory recorded
- [x] Phase 0.5 lockfile dependency install — `npm ci` exit 0 in worker (534 pkgs), web, rules-tests, root
- [x] Phase 0.6 baseline gates — captured, see below
- [x] Phase 0.7 disposable local PostgreSQL — stood up via `embedded-postgres`, `.dev.vars` untouched
- [x] Phase 0.8 schema from zero + idempotent reapply — 38/43 applied, reapply drift=none, **5 files never applied (J-004)**
- [x] Phase 1 inherited-evidence inventory — astra-audit, merge-audit, datamodel, SQL docs, route matrix, schema inventory
- [x] Phase 4.3 targets re-verified in source ahead of implementation — J-001/J-002/J-003 all STILL-OPEN

## Baseline gate results (pre-change)

| Gate | Result | Notes |
|---|---|---|
| `worker: tsc --noEmit` | **exit 0** | clean baseline; TypeScript 5.9.3 |
| `web: npm test` | unit lanes PASS; **6+ e2e FAIL** | failures are `networkidle` timeouts, see B-05 |
| schema from zero (local) | **PASS** | 64 tables, 15 views, 237 routines, 13 triggers, 46 policies, 286 indexes, 23 RLS tables, 13 enums |
| schema idempotent reapply | **PASS** | drift=none across all 8 object classes |
| staging object counts | 64 tables, **16** views, **213** routines, **53** policies | differs from schema source — J-004 |
| `test:rules` | `RUNTIME-BLOCKED` | no Java runtime (B-03) |
| SQL gates as `janus_app` | `RUNTIME-BLOCKED` on staging | no `janus_app` credential (B-07) |
| Cloud Run config/log inspection | `RUNTIME-BLOCKED` | no `gcloud` (B-04) |

---

## Next exact action

**Awaiting two user decisions before Mode 1 implementation proceeds** (see report):

1. **B-06/J-009** — whether to push the working branch, given the corporate pre-push
   hook blocks the destination and reports a violation to `ghc.freshpo.com`.
2. **B-07** — whether to supply a `janus_app` credential, without which no RLS or
   grant claim about staging can satisfy the prompt's own evidence bar.

**Next action not requiring a decision:** Phase 2 — instrument every current call site
of `RESOLVE_URL` / `postJson(RESOLVE_URL, ...)` in `web/postcall.js` and reproduce the
triple-resolve defect. Note the E2E harness constraint in B-05: request-count
assertions will need a driver that does not depend on `networkidle`, since a live
Firebase socket prevents it from ever settling. Do not weaken the assertion to
accommodate this — build a request-count driver that does not wait on idle.


---

## Audit-only mode exited — 2026-09-11T14:07:30Z

Exited on **explicit user instruction** to execute implementation prompt **P-C1**
(the concurrency and failure-injection suite), which the audit itself identified as its
largest unclaimed gap.

```
AUDIT_ONLY_MODE_ENDED_AT=f22a5e7a5e5cdde5954df39f2f64969424b04e23
REASON=user authorised P-C1
```

Recorded rather than silently crossed: the marker above was set by this session, so
stepping past it is a deliberate, attributable act. Scope of the change was limited to
adding one test file, its manifest entry, and its `test:sql-gates` wiring. **No product
code, schema, migration, dependency, infrastructure or CI file was modified.**

Result: 5 of 9 hazards are real, 3 are defended, 1 is unmeasurable on this cluster. Two of
the audit's own static-analysis predictions were wrong and are corrected in
`12-findings-ledger.md` (J-033, and the H9 correction to the twelve-constraint claim).
