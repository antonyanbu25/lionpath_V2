# Astra Forensic Audit — Audit State (checkpoint)

**Auditor:** Claude Opus 5 (executing `Astra_Forensic_Audit_Master_Prompt.md`)
**Audit start:** 2026-09-08
**Last updated:** see bottom of file

---

## 1. Snapshot identity (recalculated, not trusted from prompt)

| Fact | Master-prompt claim | Actual (verified) | Verdict |
|---|---|---|---|
| Repository root | `/Users/nradha/Desktop/Janus` | `/Users/nradha/Desktop/Janus/SE-Labs` | **DISCREPANCY** — the working dir is a wrapper; the repo is one level down |
| Product name | Lionpath / SE Singha Paathai | `SE-Labs` dir; `package.json`/README refer to Lionpath / prep-portal | Consistent enough |
| Commit-like value | `c58d78d34c5dd1a1019a5eba4d49dbcf8a16eb6b` | `git rev-parse HEAD` = **`c58eac930f8676e73a8406b9909c87b3f179b21c`** | **DISCREPANCY** — prompt's value is not this HEAD |
| HEAD commit date | n/a | `Tue Sep 8 19:40:48 2026 +0530` | recorded |
| HEAD subject | n/a | `fix(web): wire the manager "run for SE" picker into precall/postcall (Cause A)` | recorded |
| `VERSION` | `2.1.30` | `2.1.30` | **CONFIRMED** |
| `.git` present? | "archive does not appear to contain `.git`" | **`.git` IS present**; branch `main`, tracking `origin/main` | **DISCREPANCY** — full history IS available |
| Approx in-scope size | ~203,000 lines / ~871 files | ~204,374 lines across ~1,142 in-scope files (see §3) | Close; recalculated below |

### Working tree status (uncommitted at audit time)
`git status --porcelain` → 3 modified files, all dev-tooling only:
- `web/package.json` — adds `allowScripts` block
- `worker/package.json` — adds `allowScripts` block
- `worker/wrangler.toml` — adds `compatibility_flags = ["nodejs_compat"]` **(materially relevant: see H12 — this flag is NOT committed, so deployed Cloudflare config differs from local)**

Branches on `origin`: `main`, `2.0.7.3`, `2.0.7.4`, `2.0.8.1-merge`, `2.0.8.2`, `2.1`, `2.1.1`, `chore/cloudbuild-trigger-main`, `feat/ai-run-telemetry`.
`.cursor/rules/push-antony-2.1.mdc` states branch `2.1` deploys to production VPS via a **different remote** (`antonyanbu25/lionpath_V2`), i.e. `main` is not necessarily what production runs.

## 2. Repository instruction files

- **No `AGENTS.md` anywhere** (searched `find . -maxdepth 3 -iname 'AGENTS.md'`).
- **No `CLAUDE.md` anywhere.**
- `.cursor/rules/push-antony-2.1.mdc` — `alwaysApply: true`; scope = git push/deploy discipline only, not code behavior.
- `.claude/skills/**`, `.agents/**`, `agent/skills/**` = bundled skill libraries, treated as noise per scope rules.
- `.claude/launch.json`, `.claude/settings.local.json` = local harness config, not product instructions.

## 3. Recalculated inventory

In-scope files (excluding `node_modules`, `skills`, `dist`, `coverage`, generated rubric files, lockfiles):

| Subsystem | Files (all types) | Lines (code/config/sql/html/css) |
|---|---|---|
| `web/` | 350 | 110,098 |
| `worker/` | 469 | 79,770 |
| `janus/` | 62 | 10,495 |
| `deploy/` | 56 | 1,979 |
| `rules-tests/` | 13 | 1,196 |
| `scripts/` | 13 | 549 |
| `.github/` | 3 | 287 |
| `tools/` | 1 | — |
| **Total** | **~967** | **~204,374** |

By extension (in-scope): 350 `.ts`, 278 `.mjs`, 153 `.js`, 43 `.sh`, 41 `.sql`, 33 `.json`, 11 `.md`, 9 `.css`, 8 `.ps1`, 4 `.yml`, 4 `.html`.

## 4. Scope and exclusions

**Excluded at first pass** (per master prompt), revisit only on proven runtime import:
`.agents/**`, `.claude/skills/**`, `agent/skills/**`, `graphify-out/**`, `node_modules/**`, `dist/`, `coverage/`, `web/assets/**`, `web/audio/**`, images/fonts/media, `singapaathai-source-20260717.zip`, `package-lock.json` (except dependency/security questions), `web/rubric-profiles.generated.js`, `worker/src/rubric-profiles.generated.ts`, standalone prototype HTML at repo root (`qip-star (1).html`, `se-labs-*.html`), historical `docs/*.md` (used as historical evidence only).

## 5. Phase checklist

| Phase | Status | Notes |
|---|---|---|
| 0 — Baseline / inventory / plan | **complete** | §1–§4 above; snapshot discrepancies recorded |
| 1 — As-built architecture | **complete** | `01-system-architecture.md`; 2 diagrams + runtime truth table |
| 2 — Post-call dependency DAG | **complete** | `02-postcall-dag.md`; all 8 hypothesis points verified/corrected |
| 3 — Click-to-durable-state trace | **complete** | `03-postcall-write-ledger.md`; 29 writes, 7 scenarios |
| 4 — H1–H21 hypotheses | **complete** | 21/21 resolved, none runtime-blocked; `06-bugs-and-risks.md` §3 |
| 5 — Write/read parity | **complete** | `04-sql-persistence-map.md` |
| 6 — Runtime SQL proof | **complete for what is reachable** | `05-runtime-sql-verification.md`; 2 reproductions + 4 executed gate suites. Production/staging DB not classifiable → not touched |
| 7 — Database correctness | **complete** | folded into `04` §3 and `05`; DDL, constraints, ON CONFLICT targets, RLS all inspected |
| 8 — Performance and cost | **complete, as a labelled static model** | `07-performance-and-cost.md`; real measurement is blocked by F-023 |
| 9 — LLM pipeline quality | **complete** | `07` §2; 15–18 gC + ≤12 eC counted per pass |
| 10 — Broader correctness/security | **complete** | `06`; 3 authz holes, dead surface, timeouts, dead code |
| 11 — Test audit | **complete** | `08-test-coverage.md`; 286 files, 13 orphans, silent-skip catalogue |
| 12 — Architecture options | **complete** | `09-architecture-options.md`; A/B/C on 12 dimensions |
| 13 — Prioritized findings | **complete** | `06` §1; 39 findings |
| 14 — Remediation order | **complete** | `10-remediation-plan.md`; 20 changes, 5 phases |
| 15 — Implementation prompts | **complete — created, NOT executed** | `11-implementation-prompts.md`; 15 prompts + dependency graph |

## 6. Files and subsystems inspected

**Traced in full by the primary agent:** `web/postcall.js` (intake, confirm, hydration), `web/history.js`, `web/app.js` (hooks), `web/domain/dual-write.js`, `web/domain/lifecycle-service.js`, `web/domain/store.js`, `web/call-identity.js`, `web/crayons-ui.js`, `worker/src/routes.ts` (history + domain-write + config), `worker/src/history.ts`, `worker/src/postcall/generate.ts`, `worker/src/data/persistence/{postgres-repository,id-registry,session-context,read-repository,dual-write-repository,postgres-pool,types}.ts`, `janus/schema/02_phase2_activities.sql`, `janus/schema/03_phase3_ai_pipeline.sql`, `deploy/vps/docker-compose.yml`, `worker/wrangler.toml`.

**Delegated inventories, each spot-verified against source before acceptance:** schema deployment parity; route registration; Zoom acquisition; test manifests; render lifecycle; LLM counts and telemetry. Two delegated claims were found wrong on verification and corrected: (a) that `upsertActivity` was the statement raising the unique violation — its CTE is correct, `upsertPostCall` is the failure point; (b) that `test-postcall-update-idempotency-conflict.ts` covers the same-public-id/different-key case for `post_call` — it applies the divergent keys only to `activity`.

## 7. Tests run, skipped, failed

**Run against the disposable local database** (created in the session scratchpad on port 55432; `worker/.dev.vars` never modified):

| Test | Result |
|---|---|
| `worker/scripts/apply-janus-schema.mjs` | 38/38 files applied `ok`, ending at `33_user_usage.sql` → migration 34 confirmed absent |
| `janus/tests/grants_smoke.test.mjs` | **18/18 PASS** |
| `janus/tests/rls_fails_closed.test.mjs` | **8/8 PASS** |
| `janus/tests/view_rls.test.mjs` | **4/4 PASS** |
| `janus/tests/ai_run_insert.test.mjs` | **FAIL (exit 1)** — harness cannot load: top-level `await` under CJS |
| `worker/scripts/test-postcall-update-idempotency-conflict.ts` | **PASS** — a real guard that CI never runs |
| `docs/astra-audit/repros/repro-h2-…ts` | **reproduced F-001**: `23505` on `post_call_public_id_key` |
| `docs/astra-audit/repros/repro-h1-…ts` | **reproduced F-005/F-006**: `detail`→NULL, `transcript_ref`→NULL, shape 2→1, `signals_done`→`analysis_done` |

**Deliberately not run:** anything tagged `live-api` or `manual-only` (real Gemini/Zoom spend, unauthorised); `worker/scripts/debug-zoom*.mjs` (live Zoom calls with committed credentials); the web e2e suite (needs a dev server + Playwright, i.e. environment changes outside audit scope).

## 8. Runtime access

| Target | Status |
|---|---|
| Production / staging Cloud SQL | **not reachable, not classifiable → never touched** |
| Firestore | not contacted |
| Disposable local PostgreSQL 18.4 | **created in the scratchpad, port 55432, used for all runtime proof.** Contains only this audit's fixtures; cleanup proven (`{"pc":0,"act":0,"acct":0,"usr":0,"org":0}`) |
| Paid external APIs (Gemini, Anthropic, Zoom, Freshdesk, email, enrichment) | **none called** |

## 9. Scope compliance

Files created: only under `docs/astra-audit/`. **Zero** modifications to application source, tests, migrations, schema, dependency manifests, deployment files, infrastructure, environment files, secrets, CI/CD or runtime configuration. `worker/.dev.vars` was deliberately **not** used via `start-local-postgres.mjs` because that script rewrites it. No deploy, push, PR, migration application, cloud-resource change or credential rotation. No implementation prompt executed.

The three pre-existing uncommitted working-tree changes (`web/package.json`, `worker/package.json`, `worker/wrangler.toml`) were left untouched and are recorded in §1.

## 10. Unresolved questions

1. Effective `PERSISTENCE_MODE` / `PERSISTENCE_READ_MODE` / `HISTORY_BACKEND_MODE` in staging and production.
2. Historical blast radius of F-001/F-002 (row counts).
3. `pipeline_state` distribution in production.
4. Whether `ai_run` holds `call_pending_*` orphans in production.
5. Whether Cloud Run probes really target the 404ing health paths.
6. How far the deployed branch (`2.1` on the `antony` remote) has diverged from `main`.
7. Whether any `sync_outbox` projector runs.
8. Core Web Vitals / network waterfall — needs a Playwright run.
9. Real per-pass p50/p95/cost — blocked on F-023.

Exact redacted queries and commands for 1–4 and 7 are in `05-runtime-sql-verification.md` §8.

## 11. Next exact action

**Audit is complete.** All eight completeness gates satisfied; the two limitations (production runtime configuration, browser trace) are recorded above as runtime-blocked rather than open work.

Handover: start with `00-executive-summary.md`, then act on `10-remediation-plan.md` Phase 1 using the prompts in `11-implementation-prompts.md`. **Observe the ordering constraint in `10` §0 — P2 must land before P3.**

*Last updated: 2026-09-08, end of audit.*
