# 11 — Tests, deployment parity, observability and operations

---

## 1. Does the test suite protect the architecture?

**Before this session: no, and the reasons were structural.**

| Property | Before | After |
|---|---|---|
| manifest completeness | **13 orphan files** — present, never run, looking like coverage | worker 115/115, web 163/164 (the one is the manifest itself); guarded by `test-ci-foundation.mjs` |
| a unit failure's effect on E2E | **silently suppressed every e2e file** — not run, not reported, not counted (`run-tests.mjs:123`) | e2e runs regardless; only a dev-server failure skips, and that is recorded as a FAIL |
| DB gates without a database | **exited 0** — green in the one environment where they verify nothing | exit 1, with `--allow-skip` as the explicit opt-out |
| PostgreSQL in CI | **none** | `postgres:16` service, schema from zero, schema re-applied, DB gates + `tsc` |
| typecheck in CI | **never ran** | `tsc --noEmit` via `test:sql-gates` |
| `ai_run_insert` | **2 of 12 checks structurally impossible** (top-level await → CJS) | **15/15** |
| schema-path drift | two paths, 3 files divergent, no gate | both list 42 files in the same order, gated |
| tautological tests | 2, orphaned and invisible | 2, registered with `TAUTOLOGY` reasons and flagged for deletion |

**What the suite still does not protect** — stated because the above reads as a clean
sweep and it is not:

- **16 e2e specs cannot pass on this machine** (J-015). `waitUntil: "networkidle"` cannot
  settle because `web/index.html:90` loops a background video that holds a media request
  open. Those specs are the ones that would cover the journeys in `05`. Converting them to
  explicit element waits is mechanical; it was out of scope here.
- **No test asserts motion correctness end to end.** AT-2 asserts `post_call.se_motion`
  equals the resolved motion, but the acceptance suite runs against fixtures it creates
  itself, so it cannot catch J-025 — the browser-computed motion never enters that path.
- **No test exercises concurrency.** No two-tab, two-writer, or retry-after-commit case
  exists anywhere in the suite.
- **The acceptance suite (AT-1..AT-7) tests repository methods, not HTTP handlers.** The
  mandate asks for AT-1..AT-N to exercise "current HTTP handlers and current database
  code, not only direct repository methods". They do not: `BRANCH_REAUDIT…:216` defines
  them as `SELECT`s, and `RUN_LOG.md:569` records the only HTTP touch as a 401.

## 2. Test lane inventory

| Lane | Selector | Runs in CI | Count |
|---|---|---|---|
| worker default | `npm test` | yes | **100/103** |
| worker `unit` | `--tag=unit` | yes | subset |
| worker `emulator` | `--tag=emulator` | yes (Java 21 present) | 3 files |
| worker `sql` | `--tag=sql` / `test:sql-gates` | **yes, new** | 2 files + 4 janus gates + soak + tsc |
| worker `live-api` | `--tag=live-api` | **never** — costs money | 9 files |
| worker `manual-only` | explicit | **never** | 1 file |
| web default | `npm test` | yes | unit + e2e |
| web `unit` | `test:fast` | yes | **140/140** |
| web `e2e` | `test:e2e` | yes (Chromium installed) | 16 of these are blocked by J-015 |
| rules | `test:rules` | yes (JDK 21) | blocked locally (no JDK) |

Every tag in use is known to a lane — asserted by `test-ci-foundation.mjs` §3.

## 3. The three persistent worker failures

Unchanged from the `5121bc4` baseline, and **environmental, not product**:

| Test | Cause |
|---|---|
| `test-firebase-auth.mjs` | asserts *"dummy mode when local config absent"*; `web/firebase-config.local.js` is present on this machine, so `authMode()` is `firebase` |
| `test-history-api.mjs` | same root: expects dummy-auth behaviour |
| `test-tasks-api.mjs` | same root |

They pass in CI, where no local Firebase config exists. **This is a test-design smell
rather than a bug:** three tests assert behaviour that depends on the *absence* of a
gitignored file, so they are guaranteed to fail for any developer who has configured local
Firebase — which is every developer doing live UI work. Worth converting to explicit
fixture control. Not done: they are correct in CI, and changing them was outside every
named prompt.

## 4. Observability

| Mandate item | Status |
|---|---|
| correlation from gesture → request → `activity`/`post_call`/`scorecard`/`ai_run` | **BROKEN.** `X-Request-Id` exists end to end (`index.ts:56`), and P5 now records it on fallbacks — but `ai_run` has **no correlation id at all** and only 4 of 2816 rows carry an `activity_id` (J-019). The chain breaks at the most expensive link |
| actor vs owner identity | **PARTIAL.** P5 added `owner_public_id` to `sql_fallback_log`, so failures now distinguish them. Elsewhere `ai_run.user_id` is populated on 16.5% of rows |
| per-pass latency / cost / errors | **latency and tokens: available and measured** (E-095, E-096). **cost: 73% populated. attribution to a call: 0.14%** |
| database commit / failure metrics | **NOW AVAILABLE** — `sql_fallback_log` + `v_sql_coverage`, with `lost_writes` defined as `persistence_mode='sql'`. 1341 rows and growing |
| fallback / skip counters | **NOW COMPLETE** — the seven previously-silent skips in `tryHistoryPostCallSqlWrite` all log a reason code |
| pipeline-state distribution | **exists and is useless** — one value on 345/345 rows (J-012) |
| missing-child-row detection | **absent.** 283 post-calls without a scorecard are detectable by query but nothing detects them |
| retry / replay counters | `ai_run.retry_count` 100% populated; outbox has no retry telemetry |
| RLS / authz rejection metrics | **absent.** A 403 or an RLS-denied read is not counted anywhere |
| logs actionable without sensitive data | **improved** — the `_sqlDualWriteError` stack-trace leak is removed; `sql_fallback_log` carries no payload by design |
| alerts, dashboards, SLOs, runbooks | **none found.** `usage-anomaly.ts` posts a cost webhook; that is the only alerting path, and it reads the table that cannot attribute 99.86% of its rows |

**The observability verdict:** write-failure observability went from near-zero to good.
Cost and attribution observability remains the weakest area in the system, and it is
weakest precisely where spend happens.

## 5. Deployment parity

| Item | Repository says | Reality | Status |
|---|---|---|---|
| Cloud SQL instance | `janus-pg-dev` (`provision.sh:19`) | **`janus-db`** | **drift** |
| PostgreSQL version | `POSTGRES_15` (`provision.sh:33`) | staging **16.14**; local dev **18.4**; CI now pinned **16** | **three versions**, CI aligned to staging (J-005) |
| authorized networks | `0.0.0.0/0` (`CLOUDSQL_SECURITY.md:11`) | `/32` allowlist | doc **stale**, reality safer |
| RLS policies | 46 from schema source | **53 on staging** — 3 undeclared `*_admin_write` policies | **drift, security-relevant** (J-004) |
| `deal_stage_enum` | no `research` from the programmatic path | staging **has** `research` | was drift; **fixed** (34/35/36 now applied by both paths) |
| `PERSISTENCE_MODE` | three different defaults | unknown | **`RUNTIME-BLOCKED`** (B-04) |
| Cloud Run probes | `deploy/cloudrun/README.md:21` references health paths | handlers now registered (P6) | **plausible, unverified** — needs deployed probe config |
| `nodejs_compat` | flagged A-07 | unresolved | **`RUNTIME-BLOCKED`** |

**Two stale `/32` grants** remain on the instance: `claude-code (153.72.47.62/32)` and
`gideon-report-access (89.58.33.163/32)`. Ad-hoc network grants that accumulate and are
never revoked are exactly what the Auth Proxy exists to avoid.

## 6. Operational readiness

| Item | Status |
|---|---|
| health / readiness truthfulness | **questionable.** `/api/health/ready` reports readiness without checking PostgreSQL reachability — `routes/health.ts` gates its `checks` detail on admin, and the base response is static. A ready signal that does not test the system of record is not a readiness signal |
| Cloud Run timeout / concurrency / instances | **`RUNTIME-BLOCKED`** |
| pool sizing vs concurrency | **`RUNTIME-BLOCKED`**, and the 2358ms auth handshake makes it the likeliest real bottleneck |
| migrations and release ordering | **materially improved** — both paths agree, idempotency gated in CI. Migration 37 is unapplied on staging and is a **deploy prerequisite** (B-09) |
| feature flags and rollback | `feature_flag` table exists with a cutover guard trigger (`28_roadmap_gaps.sql:208`); **no reader in `worker/src`** |
| scheduler / outbox ownership | **nothing owns them.** The outbox projector, `rollup-user-usage.mjs` and `redact_pii()` all exist and none are scheduled — 236 pending rows, 2 rollup rows, no retention enforcement |
| backup / restore validation | **not audited** — needs Cloud SQL console access |
| data retention and deletion | **not enforced.** `redact_pii()` exists, nothing calls it. `DATA_RETENTION_POLICY.md` describes a policy with no runtime |
| incident response / credential rotation | **three rotations owed** and no documented rotation runbook was found |
| DR / RPO / RTO | **not documented anywhere** found |

## 7. The pattern worth naming

Four separate mechanisms exist, are correct, and are **not invoked by anything**:

| Mechanism | Exists at | Invoked by |
|---|---|---|
| outbox projector | `/api/internal/outbox/project`, `claim_outbox_batch` | **nothing** — 236 pending |
| usage rollup | `worker/scripts/rollup-user-usage.mjs` | **nothing** — 2 rows |
| PII redaction | `redact_pii()` (`06_phase6_…sql:249`) | **nothing** |
| audit log | three triggers write `audit_log` | **nothing reads it** |

This is the single most repeated defect class in the system: **the mechanism is built, the
scheduler is not**. It is also the cheapest class to fix — each needs a Cloud Scheduler
entry or a cron line, not new code. `deploy/vps/cron-batch.sh` shows the pattern already
exists for other jobs, so the gap is configuration, not capability.
