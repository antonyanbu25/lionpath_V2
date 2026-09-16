# Evidence index

Evidence IDs referenced by the audit package. Every ID maps to a file:line, a command,
a test, a SQL query, or a sanitized runtime observation.

| ID | Type | Source | Sanitized result |
|---|---|---|---|
| E-001 | command | `git fetch --all --prune` | `fatal: could not read Username for 'https://github.com': Device not configured` → B-01 |
| E-002 | command | `git rev-parse origin/main-with-functional-fix` / `origin/main` | both `5121bc4870a40dec793c98b98a38f8adbfef4789` — source and main are the same commit |
| E-003 | command | `stat .git/FETCH_HEAD` | last successful fetch `2026-09-11 16:01:10` — bounds freshness of all ref claims |
| E-004 | command | `git diff --stat origin/main-with-functional-fix HEAD` | empty — working branch is an exact copy of source ref |
| E-005 | file | `.git/hooks/pre-push:5` | `allowed_org_regex` excludes `Antony-sagayaraj`; `webhook_url=https://ghc.freshpo.com/ghctest` posts `GIT_PUSH_POLICY_VIOLATION` → B-06 |
| E-006 | command | tooling inventory | `postgres`/`psql`/`docker`/`gcloud`/`cloud-sql-proxy` absent; `java` absent; node `v24.20.0`; npm `11.19.0`; macOS 26.6.2 arm64 → B-02, B-03, B-04 |
| E-007 | SQL (read-only) | `select version()` on staging | `PostgreSQL 16.14` — contradicts `deploy/cloudsql/provision.sh` which provisions `POSTGRES_15` |
| E-008 | SQL (read-only) | `information_schema` counts on `public` | 64 base tables, 16 views, 213 routines — matches console |
| E-009 | SQL (read-only) | `pg_roles` | `janus_app, janus_owner, janus_readonly, janus_redactor, postgres` present |
| E-010 | SQL (read-only) | `pg_class.relrowsecurity` in `public` | 23 tables have RLS enabled (of 64) |
| E-011 | SQL (read-only) | `pg_stat_user_tables` top rows | `scorecard_line` 3990, `ai_run` 2802, `id_registry` 1839, `rubric_parameter` 1350, `sql_fallback_log` 1250, `scorecard_theme` 860, `deal_stage_history` 455, `deal` 454 |
| E-012 | file | `deploy/cloudsql/README.md`, `provision.sh` | reference instance `janus-pg-dev`; live instance is `janus-db` — repo/reality drift |
| E-013 | file | `docs/CLOUDSQL_SECURITY.md` | documents authorized networks `0.0.0.0/0`; live instance enforces `/32` allowlist — doc is `STALE` |
| E-014 | runtime | Cloud SQL authorized-networks list | pre-existing entries `claude-code (153.72.47.62/32)`, `gideon-report-access (89.58.33.163/32)` — stale ad-hoc DB network grants |
| E-015 | file | `worker/.dev.vars` (keys only, values redacted) | `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `DATABASE_URL_MIGRATIONS`. **No `DATABASE_URL`** → `janus_app` runtime/RLS verification blocked |
| E-016 | command | `npm ci` × 4 workspaces | all exit 0; worker 534 pkgs, rules-tests 483, web 5 |
| E-017 | command | `worker: tsc --noEmit` | exit 0 — clean typecheck baseline |
| E-018 | command | schema apply from zero on disposable local PG | 38 of 43 `janus/schema/*.sql` applied; reapply drift=none |
| E-019 | command | `comm` of present vs applied schema files | never applied: `19_history_tasks_feedback.sql`, `34_usage_and_leaderboard_views.sql`, `35_fix_account_rls_recursion.sql`, `36_add_research_deal_stage.sql` → J-004 |
| E-020 | SQL (read-only) | `pg_policies` diff local vs staging | staging-only: `activity_admin_write`, `post_call_admin_write`, `pre_call_admin_write`, all `FOR ALL TO public USING is_admin()`; declared in no schema file → J-004 |
| E-021 | SQL (read-only) | `pg_get_viewdef('v_se_score_leaderboard')` on staging | view present on staging; declared at `janus/schema/34_usage_and_leaderboard_views.sql:26` but that file is never applied → J-004 |
| E-022 | SQL (read-only) | `select version()` both sides + `pg_extension` | local 18.4 / btree_gist 1.8; staging 16.14 / btree_gist 1.7 → J-005, and explains the 24-routine gap as an extension artefact |
| E-023 | file | `worker/scripts/start-local-postgres.mjs:32,39-53` | rewrites `.dev.vars` in place and writes `PERSISTENCE_MODE=firestore` → J-006 |
| E-024 | file | `node-server.ts:119`, `types.ts:37,41`, `docker-compose.yml:29`, `setup-sql-secrets.sh:110`, `start-local-postgres.mjs:32` | five surfaces, three different `PERSISTENCE_MODE` defaults → J-007 |
| E-025 | file | `worker/src/node-server.ts:179` | `HISTORY_BACKEND_MODE \|\| PERSISTENCE_READ_MODE \|\| ""` — history backend not independent of read mode |
| E-026 | file | `worker/src/routes/domain-reads.ts:140` vs `:160-166` | POST discards `authContext` result and never asserts; GET sibling loads row and calls `assertCanReadResource` → J-001 |
| E-027 | file | `worker/src/routes.ts:997-1001` vs `:1002` | `global=1` returns before the only auth call → J-002 |
| E-028 | file | `worker/src/routes.ts:1470-1484` | no auth call; body parse is the first statement; drives `rerankWithEmbeddings` at `:1482` → J-003 |
| E-029 | command | `web: npm test` | unit lanes pass; 6+ e2e fail on `page.reload({waitUntil:"networkidle"})` 30s timeout; 16 web scripts use `networkidle`; `web/firebase-config.local.js` present → B-05 |
| E-030 | SQL (read-only) | `deal_stage_enum` values, local vs staging | staging has `research`; local (programmatic path) does not — migration 36 applied to staging only |
| E-031 | SQL (read-only) | `pg_policies` on `account`, local vs staging | staging has `_ins/_upd/_del` split (migration 35 applied); local has the single `FOR ALL` policy (35 never applied) |
| E-032 | SQL (read-only) | motion distribution, staging, rolled-back txn | post_call 345/345 `new_business`, source NULL 345/345; scorecard 62/62 `new_business`, source `resolved` 62/62; org_unit has 2 `expansion` → J-011 |
| E-033 | SQL (read-only) | `post_call.pipeline_state` distribution | `analysis_done` 345/345, all other states 0, while 62 scorecards exist → J-012 |
| E-034 | SQL (read-only) | `sql_fallback_log` grouped by reason/method/mode | `not_authorized` 1249; `updateAccount` 1130; mode `sql` 1015; range 2026-09-03→09-11 → J-008 |
| E-035 | file | `janus/schema/30_fallback_telemetry.sql:120`, `:129-131` | `lost_writes` is defined as `persistence_mode='sql'`; view comment confirms "LOST" semantics |
| E-036 | test | `set_config` evaluation-order repro on disposable local PG | same-target-list `current_user_id()` returns `null` while `set_config` returns `true` and `current_setting` returns `999`; next statement reads `''` (is_local discard); control with separate statement in explicit txn reads `999` → J-010 |
| E-037 | file | `worker/src/routes.ts:1941-1944`, `:1928-1931` | the predicate and its prerequisite `set_config` share one target list; adjacent comment already concedes writes "were effectively lost" |
| E-038 | file | `worker/src/routes.ts:1738-1755` | in `sql` mode an unwired method returns 501 — so `method_not_implemented` surfaces, but `not_authorized` returns via `fallback()` instead |
| E-039 | test | 60 runs of the pre-fix query shape on a pooled connection, disposable local PG, claimed account | write denied **60/60**; a `current_user_id()` column positioned *after* the setter observed the value 60/60 → the denial is deterministic and position-driven, not flaky → J-010 |
| E-040 | test | volatility probe: `STABLE` vs `VOLATILE` function reading `app.user_id` in the same statement as `set_config` | both saw the old value; only the inline `current_setting` positioned after the setter saw the new one. `account_writable_by_current_user`, `current_user_id`, `is_admin` are all `STABLE`, but volatility is not the discriminator — position is |
| E-041 | test | applying `34`/`35`/`36` to the disposable local cluster | all three apply cleanly; before applying `35`, `account_writable_by_current_user` aborted with `check_stack_depth` / `stack_depth.c:104` — infinite RLS recursion. J-004 escalated from "environments differ" to a reproduced crash |
| E-042 | test | `worker/scripts/test-account-writable-session.ts` post-fix | 5/5 assertions pass; fixture cleanup verified 0 leftover rows |
| E-043 | command | `worker npm test`, before vs after the J-010 fix | baseline at `5121bc4`: 90/93 with `test-firebase-auth.mjs`, `test-history-api.mjs`, `test-tasks-api.mjs` failing. After the fix: **identical** 90/93, same three. No regression. Cause is environmental — the auth test asserts dummy mode while `web/firebase-config.local.js` is present |
| E-044 | test | browser repro, stack-attributed `/resolve` calls, paste-then-correct + one click | 3 requests: `runZoomPreResolve`(link A), `runZoomPreResolve`(link B), `resolveWithZoomPendingRetry`(link B) → J-013 |
| E-045 | test | 5-scenario submit matrix incl. rapid double click and hard Zoom OAuth 400 | exactly 1 submit-path request in every clicking scenario; 0 for Enter → submit invariant holds → J-013 |
| E-046 | test | `#analyze-call` rAF trace from first existence, empty fields, pre-fix | `t=482ms disabled=false visible=true`, back to true at 569ms → ~87ms clickable window → J-014 |
| E-047 | test | same trace post-fix | `t=133ms disabled=true visible=false`; `t=495ms disabled=true visible=true`; no enabled-while-empty transition → J-014 |
| E-048 | test | fix reverted, gate re-run | INVARIANT B FAILS (`enabled at 482ms`); restored → PASSES. Failing-before/passing-after demonstrated |
| E-049 | file+test | `web/index.html:90` looping `<video>`; pending-request probe | 0 new requests after 5s yet `login-bg.webm` still outstanding at 15s; 16 `web/scripts` files use `networkidle` → J-015 |
| E-050 | command | `web npm run test:fast` after the postcall.js changes | **136/136 pass, exit 0** — no regression |
| E-051 | command | dev server provenance check | ports 8787/8788 were serving processes started **Sep 9 20:20/20:45**, two days stale; restarted before any measurement, per the handoff's own warning |
| E-052 | command | negative reachability probes for `debug-zoom*.mjs` | 0 hits in imports, package scripts, test manifest, CI, `deploy/**`, repo `scripts/**`; only doc mentions + generated `graphify-out/` → DEAD-PROVEN |
| E-053 | command | search of every tracked file for the debug-zoom literal | present in exactly those 5 files; `graphify-out/` does **not** embed it |
| E-054 | command | `git log --all -S<literal>` (value passed via variable, never printed) | 4 commits: `12dbbc6` 2026-07-15, `807f071` 07-17, `9cfd4bd` 07-28, `b31f2cd` 07-31 → history exposure not remediable by deletion |
| E-055 | test | `scripts/scan-secrets.mjs` before vs after deletion | 5 BLOCKING → 0 BLOCKING, exit 1 → exit 0 |
| E-056 | file | `worker/scripts/test-zoom-share-media.ts:117` | real `freshworks.zoom.us` recording URL with a 32-char random passcode; literal differs from the debug-zoom one; file is manifest-registered → J-016 |
| E-057 | file | `worker/scripts/test-zoom-api.ts` | six `access_token` literals, 7–10 chars — mock OAuth fixtures, not credentials (real Zoom tokens are JWTs) → classified SAFE |
| E-058 | command | `worker npm test` after deleting the 5 files | 90/93, identical to baseline; same three environmental failures → no regression |
| E-059 | test | `worker/scripts/test-route-authorization.ts` | 20/20 assertions pass; same-team manager can read but not write; org leader of a different org denied both ways; `assertCanWriteResource` throws 404 not 403 |
| E-060 | test | same gate with the feedback + RAG guards stashed | 4 FAILURES (both routes served unauthenticated callers in both auth modes); restored → 20/20 pass |
| E-061 | file | `worker/src/routes.ts:3541-3544` | `/api/analytics/director-summary` still unregistered — reachability not traded for security |
| E-062 | command | `worker npm test` after P4 | 91/94 (new test added and passing); same three pre-existing environmental failures |
| E-063 | command | `apply-janus-schema.mjs` re-apply after adding 34 to PHASE_FILES | `22_scoring_reshape.sql ... FAIL — cannot drop view v_scorecard_rankable because other objects depend on it` → J-017 |
| E-064 | test | from-zero apply on a wiped data dir, 42 files, then re-apply | both exit 0, **drift=none**; views 15→16, policies 46→50, indexes 286→288 → J-017 fixed |
| E-065 | command | `init_all.sql` vs `PHASE_FILES` diff | 42 files each, zero divergence in either direction, same order → J-004 automated-path drift closed |
| E-066 | command | migration 37 objects on the local cluster | `correlation_id`, `owner_public_id` present; **one** 8-arg `log_sql_fallback` overload (6-arg dropped); `idx_sfl_correlation`, `idx_sfl_owner_time` created |
| E-067 | test | `worker/scripts/test-fallback-telemetry.ts` | 18/18 pass; actor and owner asserted **different**; ambient correlation id picked up with no threading; all 11 reason codes present in `chk_sfl_reason`; 0 leftover rows |
| E-068 | file | `worker/src/request-context.ts:5` | correlation id held in a module-level `let`, not `AsyncLocalStorage` → mis-attribution under Cloud Run concurrency → J-018 |
| E-069 | command | repo-wide search for `_sqlDualWriteError` | no consumer in `web/` or `worker/` — the stack-trace response field was safe to remove |
| E-070 | command | `worker npm test` after P5 | 91/94; same three pre-existing environmental failures |
| E-071 | command | sweep of every outbound `fetch` in `worker/src` | 10 files unguarded (F-027 named 3); `auth.ts` JWK fetch among them, on the critical auth path |
| E-072 | test | `worker/scripts/test-provider-timeouts.ts` | 21/21 pass against a real hung loopback socket; timeout vs caller-abort distinguished; no pending `Timeout` handle after success |
| E-073 | test | pass-name drift guard, first run | FAILED with 6 unclassified namespaced passes my manual grep missed (`/` excluded from the character class) — same failure mode as F-027 itself; now 31 classified and passing |
| E-074 | file | `worker/src/postcall/{scorecard-verify,scorecard-calibrate,deck-validate,speaker-attribution,linkedin-identity}.ts` | all five are post-call by location, confirming F-027's list; each now gets 75000ms rather than 45000ms |
| E-075 | file | `web/scripts/run-tests.mjs:123` (pre-fix) | `if (alreadyUp \|\| results.every((r) => r.ok))` — one unit failure skipped all e2e, unreported |
| E-076 | command | each `janus/tests` gate with and without `--allow-skip`, no `DATABASE_URL` | no flag → exit **1** (all four); `--allow-skip` → exit 0. Previously exit 0 either way |
| E-077 | command | manifest-coverage scan | 13 orphan files found, matching F-038's count; all 13 run green before registration; worker 115/115, web 163/164 after |
| E-078 | command | `npx tsx janus/tests/ai_run_insert.harness.ts` (pre-fix) | `Top-level await is currently not supported with the "cjs" output format` — the harness could never start |
| E-079 | command | `ai_run_insert.test.mjs` after the harness fix | **15/15 checks pass** — closes the merge audit's "2 of 12 cannot run" limitation |
| E-080 | command | `worker npm run test:sql-gates` against the local cluster | **exit 0** end to end: grants, RLS fail-closed, view RLS, ai_run 15/15, J-010 gate, P5 telemetry gate, dual-write soak, `tsc --noEmit` |
| E-081 | command | suites after P15 | worker 100/103 (+8), web 140/140 (+4); the three worker failures unchanged from the 5121bc4 baseline |
| E-082 | SQL (read-only) | `ai_run` attribution counts on staging | total 2816, `activity_id` non-null **4** (0.14%), `user_id` non-null 466; cost $1.1365; 16.7M input tokens → J-019 |
| E-083 | SQL (read-only) | post_call vs scorecard join | 345 post_calls, **283 with no scorecard (82%)**, 62 scorecards, 3900 lines, 0 orphan lines → J-020 |
| E-084 | SQL (read-only) | `sync_outbox` by status | **pending 236**, completed 51 — up from the 107 the datamodel log recorded → J-021 |
| E-085 | SQL (read-only) | `app_user` org coverage | 37 active; **16 without `org_unit_id` (43%)**; 32 own ≥1 activity; 5 own none → J-022 |
| E-086 | SQL (read-only) | usage tables | `user_usage_logins` 172 vs `user_usage_daily` **2** → J-023 |
| E-087 | SQL (read-only) | leaderboard chain | `scorecard` 62 → `v_scorecard_rankable` 46 → `v_se_score_leaderboard` **3, all new_business** → J-024 |
| E-088 | SQL (read-only) | activity/pre_call parity | `activity_type='meeting'` 92 = `pre_call` 92; 0 activities lacking both pre_call and post_call — parity holds |
| E-089 | SQL (read-only) | `ai_run` by run_type | analysis 1009, pre_call 554, scoring 454, detail 433, signal_extract 131, transcript_infer 90, NULL 55, contact_enrich 51, vision 39 |
| E-090 | file | `web/postcall.js:385` → `web/domain/se-motion.js:56-64` | the BROWSER computes motion from a hardcoded Set of 5 team ids, falling through to `return "new_business"` at `:63` |
| E-091 | file | `worker/src/domain-model/se-motion.ts:32-42`, called at `routes.ts:2855`, `:3263` | server reads motion straight out of the client document; `org_unit.default_se_motion` never consulted on the post_call path → J-025 |
| E-092 | file | `postgres-repository.ts:570-590` vs the post_call insert list | `resolve_se_motion_for_user` is called ONLY for `scorecard`, never for `post_call` |
| E-093 | SQL (read-only) | `org_unit` rows on staging | 10 units; all 8 hardcoded literals match real ids, so the allowlist is NOT stale; teams have NULL motion and inherit from `seg_digital`/`seg_nurture`, both `expansion` |
| E-094 | SQL (read-only) | `resolve_se_motion_for_user()` per owner org unit vs stored `se_motion` | `team_akshita` 6, `team_varun` 2, `team_mary` 1 all resolve to **expansion** but are stored new_business = **9 mis-stamped**, independently reproducing the mandate's historical figure; 112 owned by users with NULL `org_unit_id` resolve to NULL |
| E-095 | SQL (read-only) | `ai_run` field population + per-pass latency | `latency_ms` 2816/2816 (100%), `retry_count` 100%, `input_tokens` 100%, **`cost_usd` 2060/2816 (73%)**; mean 2775ms, max 30,289ms |
| E-096 | SQL (read-only) | mean latency by pass | `synthesize` 9569ms (n=69), `scorecard` 7037ms (159), `analyze` 4890ms (170), `video/vision` 4236ms (39), `commit` 4207ms (173), `rivals` 4025ms (41), `demo-guidance` 3229ms (41), `research` 3178ms (200) — validates P10's budgets at 9–18× headroom |
| E-097 | command | staging network gate timings | TCP 65ms vs PostgreSQL auth handshake **2358ms** — a ~36× gap, single sample, flagged as a lead |
| E-098 | file | `postgres-repository.ts` `upsertPostCall` | `detail = $6` in the UPDATE branch and `detail = EXCLUDED.detail` in ON CONFLICT, with `$6 = row.detail ? … : null` — a falsy detail writes NULL rather than preserving |
| E-099 | file | the two `upsertPostCall` callers in `routes.ts` | `upsertPostCallWithSummary` passes a real `detail`; `tryHistoryPostCallSqlWrite` passes `detail: null` |
| E-100 | SQL (read-only) | `post_call.detail` population on staging | total 345, **detail NULL 21 (6%)**, present 324; `analysis` NULL 63; `transcript_ref` NULL 176 — **refutes** a delegated claim of uniform erasure |
| E-101 | SQL (read-only) | detail presence among scored calls | **15 of the 62 calls with a scorecard have NO detail** — the population most consistent with erasure landing |
| E-102 | file | `worker/src/history-pg.ts` + its importers | file EXISTS (4666 bytes), imported at `node-server.ts:12` and `tasks-pg.ts:8` — **falsifies a manifest reason I wrote myself** → J-027 |
| E-103 | file | `read-repository.ts:896-897` + `routes/domain-reads.ts:70` | `PERSISTENCE_READ_MODE` defaults to **`firestore`**; `persistenceReadReady` is true only for `"pg"`; every domain read handler falls back to Firestore when false → **Postgres write-only by default** → J-028 |
| E-104 | SQL (read-only) | live row counts, all 64 base tables | 37 non-empty, **27 empty** — confirms the ORPHAN-CANDIDATE classifications empirically → J-030 |
| E-105 | SQL (read-only) | identity table counts | `app_user` **37**, `user_identity` **13**, `user_role` 38 → 65% of users lack the UID-based binding → J-029 |
| E-106 | SQL (read-only) | notable counts | `user_kv` **39** (third store actively used) vs `task` **2**; `product_signal` 313 vs `signal_cluster` **0**; `deal_stage_history` 523 vs `deal` 522 |
| E-107 | test | `test-concurrency-hazards.ts` H1, disposable local PG | two concurrent read-modify-writes on one `user_kv.history` row → **1 of 2 entries survived** → J-031 |
| E-108 | test | H2 | `detail` seeded with 2 items, then one `detail:null` upsert → **NULL, both items lost** → J-032 upgrades J-026 to TEST-REPRODUCED |
| E-109 | test | H3, 12-attempt race | raw `duplicate key value violates unique constraint "post_call_activity_id_…"` — **not** `public_id`. **Intermittent**: runs 1–2 HAZARD, run 3 SAFE → J-033 |
| E-110 | test | H4 | after a second `public_id` for one `internal_id`, the first no longer resolves; on run 1 this orphaned the shared fixture and **broke every later scenario** → J-034 |
| E-111 | test | H7 | same user as primary SE and internal leader → `uq_cp_activity_user` violation, **0 participants persisted** including the unconflicted room → J-035 |
| E-112 | test | H5, H8, H9 | 3 sequential identical upserts → 1 row; two concurrent `claim_outbox_batch` → claimed **once** (SKIP LOCKED holds); idempotency-key reuse **absorbed** by the existing-row CTE → corrects the twelve-constraint claim |
| E-113 | test | suite teardown, all runs | **0 fixture rows remain**; loopback-only guard enforced |
| E-114 | command | `worker npm test` ×2 with dev servers stopped | **102/103, stable**, single failure `test-firebase-auth.mjs`. Corrects the "three environmental failures" reported all session |
| E-115 | file+command | `test-history-api.mjs` / `test-tasks-api.mjs` manifest entries | both `emulator`-tagged with `needsServer: true`; `run-tests.mjs:109` reuses an already-listening server, which for most of this session was a **stale Sep-9 process** — so those two were run against two-day-old code |
