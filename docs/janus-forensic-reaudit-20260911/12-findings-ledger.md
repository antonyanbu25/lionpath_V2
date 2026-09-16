# 12 — Findings ledger

Only findings **I verified personally** against current source, the current schema, or
live staging are listed with a proven status. Delegated inventories were used to locate
candidates; per the master prompt's operating protocol item 7, no delegated summary is
treated as evidence on its own.

Branch `fix/janus-handover-and-forensic-reaudit-20260911`, base `5121bc4`.

---

## J-001 · Cross-tenant IDOR write on offload-payload · CRITICAL · `CODE-PROVEN`

**Status vs prior audit:** F-004 (P0) — **STILL-OPEN**, unchanged by the functional merge.

`worker/src/routes/domain-reads.ts:140` calls `await authContext(request, env);` and
**discards the returned context**. The handler never loads the call, so it cannot and
does not call `assertCanReadResource`. The caller-supplied body is written straight to
storage at `domain-reads.ts:149` keyed only by the path `id`.

Its GET sibling is correctly guarded: `handleCallPayloadGet` loads the row
(`domain-reads.ts:160-164`), 404s on absence (`:165`), then asserts
(`assertCanReadResource(ctx, resourceFromRow(postCall))`, `:166`). The read path is
authorized; the write path is not.

**Failure scenario:** any authenticated user POSTs to
`/api/calls/<someone-elses-call-id>/offload-payload` and overwrites that call's
offloaded analysis/transcript payload. No ownership, org, or tenant check executes.
Destructive and cross-tenant.

**Owner:** P4. **Repair dependency:** none — self-contained.
**Rollback:** additive check only; revert is a one-line removal.

---

## J-002 · Unauthenticated cross-user feedback read · HIGH · `CODE-PROVEN`

**Status vs prior audit:** F-010 (P1) — **STILL-OPEN**.

`worker/src/routes.ts:997-1001`: the `global=1` branch returns at `:1000`. The only
auth call in the function, `resolveHistoryEmail`, is at `:1002` — after the return, so
unreachable on that branch.

**Failure scenario:** an unauthenticated caller requests `GET /api/feedback?global=1`
and receives every user's feedback entries. Entries carry submitter email and message
(`routes.ts:1039-1044`), so this is a PII disclosure, not merely a data leak. The
per-IP rate-limit bucket is the only control — `/api/feedback` is not in the
rate-limit exemption list (`worker/src/rate-limit.ts:131-137`), but a bucket is not
authentication.

**Owner:** P4. **Note:** the fix must add authn *and* admin authorization — the branch's
purpose is cross-user aggregate reading, so authn alone would still over-share.

---

## J-003 · Unauthenticated compute spend on /api/search/rag · HIGH · `CODE-PROVEN`

**Status vs prior audit:** F-011 (P1) — **STILL-OPEN**.

`worker/src/routes.ts:1470-1484` contains **no auth call of any kind**. The first
statement is the body parse (`:1476`). It then drives `rerankWithEmbeddings(env, query,
candidates)` at `:1482` using the server's own provider credentials.

**Failure scenario:** an unauthenticated caller posts arbitrary `query` and
`candidates` and bills embedding API usage to the deployment — denial-of-wallet — with
no attribution, because no identity was ever established.

**Owner:** P4. **Repair dependency:** pairs with cost controls in P10.

---

## J-004 · Four schema files exist that no automated path applies · HIGH · `TEST-REPRODUCED` + `STAGING-VERIFIED`

**Status vs prior audit:** F-020 / R-003 — **CONFIRMED and now quantified in both directions.**

A schema apply from zero against a disposable local PostgreSQL applied **38 of 43**
files in `janus/schema/`. Never applied:

- `19_history_tasks_feedback.sql`
- `34_usage_and_leaderboard_views.sql`
- `35_fix_account_rls_recursion.sql`
- `36_add_research_deal_stage.sql`
- (`init_all.sql` is an aggregate, not a phase file)

**Both directions of drift are now proven:**

1. **Objects the source declares but a fresh environment never gets.**
   `v_se_score_leaderboard` IS declared — `janus/schema/34_usage_and_leaderboard_views.sql:26`
   — but file 34 is never applied, so a from-zero install lacks it. Live staging **has**
   it, meaning file 34 was applied to staging by hand outside any automated path.
   `35_fix_account_rls_recursion.sql` is named as an RLS-recursion *fix*: a fresh
   environment would carry the unfixed recursion.

2. **Objects live on staging that the source never declares.** Three RLS policies exist
   on staging with no declaration anywhere in `janus/schema/`:

   | Policy | Table | Definition on staging |
   |---|---|---|
   | `activity_admin_write` | `activity` | `FOR ALL TO public USING is_admin() WITH CHECK is_admin()` |
   | `post_call_admin_write` | `post_call` | same |
   | `pre_call_admin_write` | `pre_call` | same |

   A repo-wide grep of `janus/schema/*.sql` for these names returns nothing; the only
   declared `*_admin_write` policy is `ai_run_admin_write`
   (`janus/schema/18_ai_run_rls.sql:38-39`). So staging grants admin write on the three
   core call tables via unreviewed, unversioned policy — and a fresh deploy would not
   have that grant, silently changing admin behaviour between environments.

   Policy shape also diverges: the source declares `account_se_team_owner_write` and
   `account_se_team_write` as single policies; staging carries them split into
   `_ins`/`_upd`/`_del` triples. 46 policies locally vs 53 on staging.

**Failure scenario:** deploying to a new environment from the repo produces a database
that differs from staging in RLS enforcement and lacks the leaderboard view. There is
no drift gate to catch it.

**Owner:** P15 item 8 (schema-path comparison + drift failure).

---

## J-005 · Three PostgreSQL major versions across the stack · HIGH · `STAGING-VERIFIED`

| Layer | Version | Evidence |
|---|---|---|
| Local dev / test | **PostgreSQL 18.4** | `embedded-postgres@18.4.0-beta.17`, measured `select version()` |
| Live staging | **PostgreSQL 16.14** | measured `select version()` on `janus-db` |
| Provisioning script | **POSTGRES_15** | `deploy/cloudsql/provision.sh:33` |

Tests and schema validation run on 18.4; staging runs 16.14; the script that would
create a new instance asks for 15. `btree_gist` differs accordingly (1.8 local vs 1.7
staging), which fully accounts for the 24-routine count gap — that part is an
environment artefact, **not** product drift, and is classified as such.

**Failure scenario:** a query plan, a collation-dependent result, or version-gated SQL
that passes locally on 18.4 can behave differently on 16.14, and differently again on a
freshly provisioned 15 instance. Gate results carry an unstated version assumption.

---

## J-006 · `start-local-postgres.mjs` overwrites developer credentials and forces Firestore mode · MEDIUM · `CODE-PROVEN`

`worker/scripts/start-local-postgres.mjs:39-53` (`upsertDevVars`) rewrites
`DATABASE_URL` and `DATABASE_URL_MIGRATIONS` in `worker/.dev.vars` in place, and
`:32`/`:50` write `PERSISTENCE_MODE=firestore`.

Two consequences:

1. Running the documented local-Postgres command destroys any staging credential a
   developer has configured in that file. This is why Phase 0.7 of the master prompt
   says "Do not rewrite `.dev.vars`"; this audit used an equivalent harness instead.
2. It is direct evidence for the Phase 7 question *"local development does not silently
   force Firestore"* — **it does**, by writing the mode into the env file rather than
   leaving it unset.

---

## J-007 · `PERSISTENCE_MODE` resolves to three different defaults by deploy target · HIGH · `CODE-PROVEN`

| Surface | Default | Evidence |
|---|---|---|
| Node / Cloud Run entry point | `sql` | `worker/src/node-server.ts:119` |
| Persistence port | `sql`, with invalid values falling back to `firestore` | `worker/src/data/persistence/types.ts:37`, `:41` |
| VPS docker-compose | `firestore` | `deploy/vps/docker-compose.yml:29` |
| Cloud Run secret attach script | `dual` | `deploy/cloudrun/setup-sql-secrets.sh:105`, `:110` |
| Cloud SQL README | `dual` | `deploy/cloudsql/README.md:44` |
| Local bootstrap | `firestore` | `worker/scripts/start-local-postgres.mjs:32` |

There is no single answer to "what persistence mode is production in" that the
repository can give. The settled decision in the master prompt is that PostgreSQL is
the only authoritative store; the deployed default depends entirely on which target
ran last and whether an operator set the variable.

`HISTORY_BACKEND_MODE` compounds it: `worker/src/node-server.ts:179` coalesces
`HISTORY_BACKEND_MODE || PERSISTENCE_READ_MODE || ""`, so history backend selection is
not independent of read mode, and `deploy/vps/docker-compose.yml:19` sets
`HISTORY_FILE_DIR` unconditionally — a flat-file history backend on VPS.

**This is the crux of the Firestore-authority question and must be resolved from
deployed configuration, which is currently `RUNTIME-BLOCKED` (no `gcloud`).**

---

## J-008 · `sql_fallback_log` holds 1250 rows on staging · HIGH · `STAGING-VERIFIED`

`pg_stat_user_tables` reports 1250 live rows in `sql_fallback_log` — the table
`janus/schema/30_fallback_telemetry.sql` created to record durable-write fallbacks and
skips. Non-empty at this scale means the fallback path has been taken at scale.

Not yet established (requires read-only content analysis, next action): which methods,
which reasons, what time range, and whether any correspond to user-visible successes.
Counted here because P5's entire premise is that these events were previously invisible.

---

## J-009 · Corporate pre-push hook blocks the required push and reports a violation · PROCESS · `CODE-PROVEN`

`.git/hooks/pre-push:5` defines an approved-org allowlist that does **not** match
`Antony-sagayaraj/SE-Labs`, and `:6` sets
`webhook_url=https://ghc.freshpo.com/ghctest`. On a disallowed remote the hook writes
`violations.log` and POSTs a `GIT_PUSH_POLICY_VIOLATION` payload carrying git user name,
email, and repo path.

Phase 5 of the master prompt requires pushing the working branch. Doing so requires
either allowlisting the destination or bypassing a corporate DLP control. **Not taken
unilaterally — awaiting explicit human authorization.**

---

## Prior claims now demonstrably STALE

| Prior claim | Source | Current reality |
|---|---|---|
| `main-with-functional-fix` and `main` are distinct refs with distinct roles | master prompt § Repository direction | Both are `5121bc4` — the same commit |
| Authorized networks are `0.0.0.0/0` | `docs/CLOUDSQL_SECURITY.md:11` | Instance enforces a `/32` allowlist; the doc overstates exposure |
| Instance is `janus-pg-dev` | `deploy/cloudsql/README.md:33`, `provision.sh:19` | Live instance is `janus-db` |
| Target is Postgres 15 | `deploy/cloudsql/provision.sh:33` | Staging runs 16.14 |

---

## J-010 · `account_writable_by_current_user` is called with a NULL user — root cause of 1130 refused account writes · CRITICAL · `TEST-REPRODUCED`

The "P0 fix (Sep 7)" at `worker/src/routes.ts:1937-1953` intends to defer SE account-write
authorization to the RLS predicate. The query it issues is:

```sql
SELECT account_writable_by_current_user(resolve_internal_id('account', $1)) AS ok
     , set_config('app.user_id', $2, true) IS NOT NULL AS ctx_ok
```

**Two independent defects, both reproduced on a disposable local PostgreSQL:**

1. **Evaluation order — deterministic, not flaky.** The predicate and the `set_config()`
   that establishes the variable it depends on are in the **same SELECT target list**.
   PostgreSQL does not guarantee target-list evaluation order and in practice evaluates
   left to right; the production query lists the predicate **first** and the setter
   **second**, so the predicate always evaluates against the pre-statement value of
   `app.user_id`, which is unset.

   Measured over 60 runs of the exact pre-fix query on a pooled connection against a
   claimed account:

   | observation | result |
   |---|---|
   | write denied (`ok !== true`) | **60 / 60** |
   | `current_user_id()` column positioned *after* the setter | non-null 60 / 60 |
   | predicate's own view of the user | unset — hence the denial |

   Position is what decides it: an expression after the setter sees the new value, one
   before it does not. `account_writable_by_current_user`, `current_user_id` and
   `is_admin` are all declared `STABLE`, but volatility is not the discriminator here —
   a `VOLATILE` probe placed before the setter also saw the old value.

2. **Scope.** `set_config(..., true)` is *transaction*-local. The call is a standalone
   `pool.query`, not inside `withSessionContext`, so it runs in its own implicit
   transaction and the setting is discarded at statement end. Measured: the following
   statement reads `''` / `null`. A control that sets it in a separate earlier statement
   inside an explicit transaction correctly reads `999`.

**Consequence:** `account_writable_by_current_user()` evaluates with
`current_user_id() = NULL`, so it returns false for every account that has an
`account_se_team` mapping. The branch then returns
`fallback({reason:"not_authorized", detail:"(rls-writable check false)"})`.

**This is the root cause of the single largest fallback bucket on staging:**
`updateAccount` = **1130** `not_authorized` rows. The code comment at `routes.ts:1928-1931`
already acknowledges the class of harm ("those writes were effectively lost — 115
not_authorized entries on Sep 7 alone") — the fix intended to stop it did not work.

**Fix applied.** Extracted the check into `accountWritableBySession()` in
`worker/src/data/persistence/session-context.ts`, which runs the predicate inside
`withSessionContext` — that helper opens a transaction and sets `app.user_id`,
`app.org_unit_path` and `app.is_admin` in an **earlier statement**, which is the shape
measured to work. `worker/src/routes.ts` now calls it.

**Regression gate:** `worker/scripts/test-account-writable-session.ts`, five assertions:
mapped SE is writable (the regression), unmapped SE is **not** (so the fix cannot pass by
being always-true), a claimed account is not writable with no `app.user_id`, that
`current_user_id()` is then null, and that a transaction-local setting does not survive to
the next statement. The gate deliberately does **not** assert target-list evaluation order
— that is unspecified behaviour, and pinning it would test a PostgreSQL implementation
detail rather than our contract. Fixtures are `JANUS_AUDIT_TEST`-stamped, committed then
deleted by exact id, with leftover rows asserted to be zero; the test refuses any
non-loopback host unless `--allow-remote` is passed.

**Correction to an earlier reading of this finding:** an intermediate measurement showed
the predicate observing the user id and I briefly recorded the defect as non-deterministic.
The 60-run measurement above settles it — the denial is deterministic; what varies is only
whether a *separately positioned* column observes the setter.

---

## J-011 · SE motion is uniformly New Business on staging despite two Expansion-configured org units · CRITICAL · `STAGING-VERIFIED`

Read-only distribution, staging, admin session context, inside a rolled-back transaction:

| Measure | Result |
|---|---|
| `post_call` rows | **345** |
| `post_call.se_motion` | `new_business` — **345 / 345 (100%)** |
| `post_call.se_motion_source` | `NULL` — **345 / 345 (100%)** |
| `scorecard` rows | **62** |
| `scorecard.se_motion` | `new_business` — **62 / 62 (100%)** |
| `scorecard.se_motion_source` | `resolved` — **62 / 62 (100%)** |
| `org_unit.default_se_motion` | **2 units configured `expansion`**, 1 `new_business`, 7 inherit |
| `app_user` rows | 37 |

Two org units are configured for Expansion, and **not one** Expansion `post_call` or
`scorecard` exists. This fails four of the Phase 9 motion requirements outright:

- "a configured Expansion call owner produces an Expansion `post_call`" — **0 of 345**
- "missing configuration is visible and does not silently become New Business" — it
  silently becomes New Business
- "`se_motion_source` populated with the real resolution provenance" — **NULL on every
  `post_call` row**
- consistency across `post_call` and `scorecard` — both say `new_business`, but they
  disagree about provenance

**The scorecard side is worse than the post_call side.** All 62 scorecards assert
`se_motion_source = 'resolved'` — a positive claim that motion *was* resolved from
canonical data. Given two Expansion-configured org units and zero Expansion scorecards,
that provenance value is not trustworthy. A row that is wrong is less recoverable than a
row that is NULL, because nothing downstream can tell it apart from a correct one.

**Why `post_call.se_motion_source` is always NULL:** the column is declared
(`janus/schema/22_scoring_reshape.sql:696`) and constrained (`:701-702`), but is not in
the `post_call` insert/update column list in
`worker/src/data/persistence/postgres-repository.ts` — only the `scorecard` upsert writes
a source. So the guarantee stated at `22:709-711`, that call and score can never
disagree about motion, is not met on the `post_call` side.

**Also note:** the CHECK `se_motion_source IN ('resolved','override','defaulted')` admits
NULL, because in SQL `NULL IN (...)` is NULL, not false. The constraint cannot enforce
presence.

**Business impact:** an Expansion SE is scored against a New Business rubric. Per
`22:340-345` that is a 32-credit profile instead of 27 — so scores, and therefore the
leaderboard, are not comparable across motions. This is a scoring-fairness defect, not
just a data-hygiene one.

**Historical leads recalculated as instructed:** the prior figure was 288 post-calls all
New Business with NULL source. It is now **345** — the pattern is unchanged and the
population has grown. No rows were repaired.

---

## J-012 · `pipeline_state` never advances past `analysis_done` · HIGH · `STAGING-VERIFIED`

`post_call.pipeline_state` distribution on staging: **`analysis_done` = 345 / 345 (100%)**.
Zero rows in `ingested`, `detail_done`, `scoring_done`, `signals_done`, or `failed`.

62 scorecards exist, so scoring demonstrably happened — yet no row ever reached
`scoring_done`. This confirms prior F-006 (two writers both hardcoding `analysis_done`)
as **STILL-OPEN**, and proves the Phase 8 invariant fails: state is not derived from
persisted artefact presence and does not advance monotonically. It carries no information,
so nothing can detect a partially-completed pipeline.

---

## J-008 (updated) · `sql_fallback_log` — 1280 rows, and the schema calls 1015 of them lost writes · CRITICAL · `STAGING-VERIFIED`

| Reason | Count |
|---|---|
| `not_authorized` | **1249** |
| `no_sql_session` | 22 |
| `unmapped_parent` | 4 |
| `shape_validation_failed` | 3 |
| `method_not_implemented` | 2 |

| Method | Count |
|---|---|
| `updateAccount` | **1130** |
| `updateContact` | 103 |
| `createAccount` | 14 |
| `createContact` | 11 |
| `createPrepBrief` / `upsertScorecardLine` | 5 each |
| `thisMethodDoesNotExist` | 3 |

By mode: **`sql` = 1015**, `dual` = 265. Active range **2026-09-03 → 2026-09-11** (today).

`janus/schema/30_fallback_telemetry.sql:120` defines the view column literally:
`count(*) FILTER (WHERE persistence_mode = 'sql') AS lost_writes`, and the view comment at
`:129-131` says these are "LOST (mode = sql, so Firestore did not catch them)". By the
schema's own definition there are **1015 lost writes** on staging, still accruing today.

`updateAccount` alone accounts for 1130 of the 1249 `not_authorized` entries, and **J-010
is its proven root cause.**

Two secondary observations:
- `thisMethodDoesNotExist` (3 rows) is test traffic recorded in the same telemetry table
  as real production failures, with no flag to separate them.
- `createPrepBrief` failures corroborate the prior note that the prep flow's account
  provisioning aborts alongside these denials.

---

## J-013 · The reported "triple resolve" is two warm-ups plus one submit — the submit invariant holds · `TEST-REPRODUCED`

**Status vs the handoff:** the handoff recorded one Analyse click firing three
`POST /api/postcall/resolve` requests, with one identified as the warm-up and *"the
other two unexplained"*. Both are now explained, and the diagnosis in the handoff was
wrong about which path duplicated.

Reproduced in a real browser with per-request stack attribution. A realistic
paste-then-correct sequence followed by a single click produced exactly three requests:

| # | t | call site | link carried |
|---|---|---|---|
| 1 | 2783ms | `runZoomPreResolve` | link **A** |
| 2 | 6233ms | `runZoomPreResolve` | link **B** |
| 3 | 7277ms | `resolveWithZoomPendingRetry` | link **B** |

So it is **two warm-ups and one submit**, not a duplicated submit.
`zoomPreResolveWarmedKey` is keyed on the recording link
(`web/postcall.js:659`), so editing or re-pasting the link re-arms the warm-up.
Appending `?pwd=` did **not** re-fire it — `parseRecordingInput` strips the passcode, so
the key is unchanged — but a genuinely different link does.

**The submit-path invariant required by the prompt holds.** Measured across five
scenarios, each producing exactly one submit-path request:

| scenario | submit-path requests |
|---|---|
| one ordinary click (200) | 1 |
| rapid double click, slow server | 1 |
| hard Zoom OAuth 400 — *the originally reported condition* | 1 |
| rapid double click + hard 400 | 1 |
| Enter key on the focused button | 0 (no submit binding) |

The mechanism that prevents duplication: `startPipeline` sets `pass0Busy = true`
synchronously before any `await` (`web/postcall.js:5757`), it early-returns when
`btn?.disabled`, and `bindActionOnce` collapses the paired `fwClick`+`click` within
400ms (`web/crayons-ui.js:240-253`). None of that was changed.

**Change made:** a superseded warm-up is now aborted rather than left running against a
stale link (`AbortController`, `web/postcall.js:705-707`, cleared in
`resetPostCallView`). **A count cap was considered and deliberately rejected** — the
dedup key is the link, so a cap would starve the *last* link of its warm-up, and the last
link is the one actually submitted.

**Not fixed, and stated as a limitation:** three requests for one click remains the
user-visible behaviour, because two of them are legitimate warm-ups for two different
links. The behaviour is correct; it is the *observability* that misled a user and then an
engineer. Making warm-ups distinguishable in telemetry is a separate change and is left
for the audit package.

**Regression gate:** `web/scripts/test-postcall-intake-invariants.mjs`, registered
`e2e`. Asserts request counts, not UI output, and attributes warm-ups to
`runZoomPreResolve` so a future submit-path duplication cannot hide inside the warm-up
count.

---

## J-014 · `#analyze-call` was enabled for ~89ms with empty fields · HIGH · `FIXED-AND-VERIFIED`

`setButtonLoading(button, loading)` assigns **both** `loading` and `disabled`
(`web/crayons-ui.js:209-213`). `resetPostCallView()` calls
`setButtonLoading($("analyze-call"), false)`, which therefore **enabled the submit button
unconditionally**, regardless of field validity. The gate only reasserted itself later:
the function's only route to `updateAnalyzeButtonState` was the async `onChange` callback
of `wireProxySeSelectors`.

Measured before the fix, sampling from the instant the button existed:

```
t=141ms  disabled=true   visible=false
t=482ms  disabled=false  visible=TRUE    <-- clickable, all fields empty
t=569ms  disabled=true   visible=true
```

After the fix — `updateAnalyzeButtonState()` called synchronously right after
`setButtonLoading`, making the gate the single authority:

```
t=133ms  disabled=true   visible=false
t=495ms  disabled=true   visible=true
```

No enabled-while-empty transition, and the button reaches a disabled state **before** it
becomes visible. The earlier merge report described this as settling "about 2.5 seconds
later"; on this branch the window was ~87ms — smaller, equally real, and not timing-
dependent in a way a wait could paper over. **No arbitrary wait was added**, as Phase 3
requires; failing-before/passing-after was demonstrated by reverting the one-line fix.

---

## J-015 · 16 e2e specs cannot pass on this machine: `networkidle` vs a looping background video · MEDIUM · `TEST-REPRODUCED`

`web/index.html:90` renders
`<video class="login-bg-video" autoplay muted loop playsinline preload="auto">` for
`assets/login-bg.webm`. A looping media element holds its request open, so
`waitUntil: "networkidle"` has no reliable settling point.

Measured: 15s after `domcontentloaded`, **zero** new requests had been issued, yet
`/assets/login-bg.webm` was still the one outstanding request. `page.reload({ waitUntil:
"networkidle" })` times out at 30s, which is precisely how
`test-auth-login-f5acac.mjs`, `test-cache-accounts-contacts-e2e.mjs` and the four
`test-dashboard-*` specs fail. **16 files under `web/scripts/` use `networkidle`.**

This is a **test-design defect, not a product defect**, and it is the correct
classification of the failures recorded as B-05 in `_audit-state.md`. My original
hypothesis — a live Firebase socket — was wrong: the failures reproduce identically with
`web/firebase-config.local.js` removed and auth in dummy mode.

The new invariants gate deliberately uses `domcontentloaded` plus explicit element-state
waits. Converting the other 16 is mechanical but out of this phase's scope; it belongs
with P15 and is filed for the remediation roadmap rather than done here.

---

## J-016 · A SECOND real Zoom recording passcode, in a live registered test — not covered by F-025 · HIGH · `CODE-PROVEN`

F-025 named five files: `worker/scripts/debug-zoom{,2,3,4,5}.mjs`. Scanning every
tracked file for credential-shaped literals found a sixth exposure the original audit
missed:

**`worker/scripts/test-zoom-share-media.ts:117`** contains a real `freshworks.zoom.us`
recording URL with a **32-character random passcode in its query string**. It is a
*different* literal from the debug-zoom one (verified by direct comparison), so rotating
the debug-zoom passcode does not remediate it.

Why it was not deleted:

- it is **registered in `worker/scripts/test-manifest.mjs`**, so it is live, not dead;
- it is referenced by `worker/scripts/test-zoom-share-network.ts`;
- P1 explicitly says *"Do not delete legitimate manual Zoom test tools"* and limits
  deletion to files **proven** dead. This one is proven **alive**.

**Owed, and outside what I can do:** rotate that recording's passcode, then move the URL
to an env var or sanitise it. Tracked in the scanner's `ACCEPTED` list with that reason
so it prints on every CI run rather than being silenced.

**Also checked and cleared:** `worker/scripts/test-zoom-api.ts` holds six `access_token`
literals of 7–10 characters. Real Zoom access tokens are JWTs of several hundred
characters, so these are mock OAuth response fixtures, not credentials. Recorded as SAFE
with that reasoning rather than left ambiguous. Same for `web/firebase-config.js` (Firebase
Web API keys are public by design and scoped by security rules, not secrecy),
`web/dummy-users.js`, and the intercepted fixture URL in `test-postcall-intake-e2e.mjs`.

---

## P1 COMPLETE — credential purge

**Deleted** (each proven dead before removal, not merely grep-negative):
`worker/scripts/debug-zoom.mjs`, `debug-zoom2.mjs`, `debug-zoom3.mjs`,
`debug-zoom4.mjs`, `debug-zoom5.mjs`.

Negative reachability evidence gathered for every one:

| probe | result |
|---|---|
| `import`/`require` anywhere in `worker/src`, `web` | 0 |
| `worker/package.json` / root `package.json` scripts | 0 |
| `worker/scripts/test-manifest.mjs` | 0 |
| `.github/workflows/**` | 0 |
| `deploy/**` | 0 |
| repo `scripts/**` | 0 |

The only references were documentation (the audit docs naming them as targets) and
`graphify-out/`, a tracked but generated static-analysis artifact that references
filenames only and does **not** embed file contents — verified by searching it for the
literal. Worker suite after deletion: **90/93, identical to the pre-change baseline**,
same three environmental failures.

**History exposure — NOT remediated, and not remediable by deletion.** The literal
appears in **4 commits**, earliest `12dbbc6` (2026-07-15), then `807f071` (07-17),
`9cfd4bd` (07-28), `b31f2cd` (07-31). Git history was **not** rewritten, per the prompt's
instruction. Located with `git log --all -S` driven from a variable so the value was
never printed.

**MANDATORY EXTERNAL ACTION — rotate the Zoom recording passcode.** Deleting the files
does not remediate an already-pushed secret. Two separate recordings now need rotation:
the debug-zoom passcode (4 commits of history) and the J-016 passcode in
`test-zoom-share-media.ts`. I cannot perform rotation and did not attempt it.

**Disclosure note against myself:** while reading those files I printed one of the two
passcodes into the session transcript through an under-specified redaction pattern — it
matched `passcode`-prefixed forms but not `pwd = "…"`. That value was already exposed in
git history, so the rotation requirement is unchanged, but the transcript is now an
additional disclosure surface and the rotation should be treated as urgent rather than
routine.

**Secret scanning added:** `scripts/scan-secrets.mjs`, wired as a required `secrets` job
in `.github/workflows/ci.yml` on every push and PR. Self-contained — no third-party
action, no network, no added supply-chain surface. Five rules (Zoom recording URL with
inline passcode, credential-shaped assignment, known provider key prefixes, private-key
blocks, PostgreSQL URL with inline password). It reports `file:line` with a **masked**
value and never prints a match.

Proven working, failing-before/passing-after: **5 blocking findings before the deletion
(exactly the five target files), 0 after.** An initial version produced 30 findings,
almost all shell substitutions and markdown prose; it was tightened because a scanner
that cries wolf gets switched off. Pre-existing findings are listed in `ACCEPTED` with a
per-item reason and still print on every run, so the two items of real debt stay visible
instead of being suppressed.

---

## P4 COMPLETE — authorization holes closed

All four targets were re-verified as still open in source before being changed
(J-001, J-002, J-003 above, plus the merge report's `/api/read-models/schedule` gap).

### The design decision worth stating

`canReadResource` grants a manager access to anything in their team or org subtree.
That is right for reading and **wrong for writing** — it would let one manager overwrite
another SE's analysis payload. So rather than reuse the read check, a narrower
`canWriteResource` (owner-or-admin) was added to `worker/src/data/scope.ts`, mirroring
the database's own `post_call_owner_write` policy
(`janus/schema/14_rls_owner_write_calls.sql`). App layer and RLS now agree instead of the
app layer being the looser of the two. The test asserts that asymmetry directly: a
same-team manager **can read and cannot write** the same resource.

`assertCanWriteResource` throws **404, not 403**, on purpose. A 403 confirms the id
exists, which is an enumeration oracle for a caller not entitled to know. "Not yours" and
"not there" are deliberately indistinguishable, which is what P4's "unknown resources
should not leak their existence" requires.

### Changes

| Target | Fix |
|---|---|
| `POST /api/calls/:id/offload-payload` (F-004) | Now binds the `authContext` result, loads the authoritative call, 404s if absent, and calls `assertCanWriteResource`. `domain-reads.ts:141-168` |
| `GET /api/feedback?global=1` (F-010) | Auth moved **before** the branch, and the branch now requires `ctx.role === "admin"` — authn alone would still over-serve, since the branch exists to read across users. `routes.ts:997-1017` |
| `POST /api/search/rag` (F-011) | `requireUser` added, plus per-request cost ceilings (`RAG_MAX_CANDIDATES` 200, `RAG_MAX_QUERY_CHARS` 4000 → 413). Authentication bounds *who* spends; the ceilings bound *how much* one request can spend, since both candidate count and text length are caller-controlled. |
| `POST /api/read-models/schedule` | Loads the referenced call and applies the same owner-or-admin rule. |

`/api/analytics/director-summary` was confirmed **still unregistered**
(`routes.ts:3541-3544`), as P4 requires — reachability was not traded for security.

### Residual, filed rather than fixed

`/api/read-models/schedule` still rebuilds from the **caller-supplied document**, not the
row it just loaded. Ownership is now enforced, so a caller can only affect their own
call — but they can still supply arbitrary field values for it. Switching the rebuild to
read from the loaded row changes the route's payload contract and the shape
`rebuildReadModelsNow` consumes, which is beyond a bounded authorization fix. Marked with
an inline `NOTE (residual, filed rather than fixed)` at the call site.

### Gate

`worker/scripts/test-route-authorization.ts`, registered `unit`. **20 assertions**,
covering read-vs-write asymmetry, two users in different org subtrees, an org leader of a
*different* org, a resource with no owner, the 404-not-403 rule, and unauthenticated
refusal of both previously-open routes in dummy **and** enforced auth modes.

Failing-before/passing-after demonstrated by stashing the guards: **4 failures reverted,
all 20 pass restored**.

**Honest coverage limit:** `offload-payload` and `read-models/schedule` are
Firestore-backed and cannot be driven in-process without the emulator, which needs a JDK
this machine does not have (blocker B-03). Their authorization *decision* is tested
through the predicate they now call; their *wiring* rests on the typechecker. That gap is
stated rather than hidden behind a mock that would prove nothing. Worker suite: **91/94**,
the three failures identical to the pre-change baseline.

---

## P5 COMPLETE — failed durable writes are now queryable and attributable

The invariant, restated against the SQL-only target rather than the Firestore-era
mechanics: *every requested durable write either commits to PostgreSQL or produces a
queryable, attributable failure and a truthful user-visible state.*

`sql_fallback_log` and `log_sql_fallback` already existed and are well-built — they
already distinguish `[LOST WRITE]` in sql mode. Three gaps remained.

### 1. Seven silent skips in `tryHistoryPostCallSqlWrite`

Every early return was invisible. A history POST returns 200 whether or not the
dual-write happened, so a skip showed up in neither the response nor any queryable
record. Each now logs with a stable reason code:

| condition | reason |
|---|---|
| `!port \|\| !postgresReady` | `postgres_not_configured` |
| `!verified?.uid` | `no_verified_user` |
| `!id \|\| !analysis` | `missing_required_field` |
| no `accountId` and no account name to mint from | `missing_required_field` |
| `!session` (was console-only) | `no_sql_session` |
| `!ownerId \|\| !orgUnitId` (was console-only) | `unmapped_parent` |
| shape validation threw (was console-only) | `shape_validation_failed` |

The original error is carried into `detail` rather than discarded.

### 2. A thrown write error was not queryable, and leaked a stack trace

The caller caught, logged loudly, and returned the **full stack trace to the client** in a
`_sqlDualWriteError` response field — labelled `TEMP DEBUG (remove after diagnosing the
2026-09-08 ... gap)`. A stack trace in an API response is exactly the sensitive payload
P5 says must not be exposed, and it had **no consumer anywhere** in `web/` or `worker/`
(verified by repo-wide search). Replaced with a queryable `write_error` row; the stack
stays in the server log only.

### 3. No correlation id, and actor conflated with owner

`user_public_id` records the **actor**. In a manager/admin proxy flow the actor is not the
owner, so a lost write was attributed to the wrong person's data. And without a
correlation id a fallback row cannot be joined to the request that caused it, so a user
reporting "my call did not save" could not be traced to the row explaining why.

`janus/schema/37_fallback_correlation.sql` adds `correlation_id` and `owner_public_id`
(both nullable, additive), two partial indexes, and replaces `log_sql_fallback` with an
8-arg version. The old 6-arg function is **dropped** rather than left alongside: keeping
both overloads would make every existing 6-arg call site ambiguous at runtime.

The worker already mints a per-request id (`worker/src/request-context.ts`, returned as
`X-Request-Id`), so `logFallback` reads it ambiently via `getCorrelationId()` — no call
site threads it.

### Gate

`worker/scripts/test-fallback-telemetry.ts`, registered `sql` and wired into
`test:sql-gates`. **18 assertions**: row queryable by correlation id, method/reason
recorded, actor and owner recorded *separately and asserted different*, entity recorded,
sql mode marked so `v_sql_coverage` counts it as a lost write, the ambient correlation id
picked up with no threading, and all 11 reason codes verified present in `chk_sfl_reason`
— a mismatch there makes the INSERT fail and be swallowed, so the failure would itself be
silent. Fixtures deleted, leftover rows asserted zero.

---

## J-017 · The schema was not idempotent once migration 34 was included · HIGH · `TEST-REPRODUCED` → `FIXED-AND-VERIFIED`

Adding 34/35/36 to `PHASE_FILES` (the J-004 fix) immediately broke re-apply:

```
==> 22_scoring_reshape.sql ... FAIL
cannot drop view v_scorecard_rankable because other objects depend on it
```

`22_scoring_reshape.sql:778` drops `v_scorecard_rankable`; migration 34's
`v_se_score_leaderboard` SELECTs from it. From zero the order is fine (22 before 34), so
this was **latent for exactly as long as 34 went unapplied** — the two defects were
hiding each other. My earlier idempotency pass reported `drift=none` only because 34 was
not in the list at the time.

Fixed by dropping the dependent view explicitly in 22 before dropping its base.
Deliberately **not** `CASCADE`: cascade would silently remove any future dependent too,
which is how a view disappears without anyone noticing — and is how this repo lost track
of 34 in the first place.

Verified from a **wiped** data directory, all 42 files:

| | first apply | reapply |
|---|---|---|
| exit | 0 | 0 |
| tables | 64 | 64 |
| views | **16** (was 15 — leaderboard now present) | 16 |
| policies | **50** (was 46 — migration 35's split policies) | 50 |
| indexes | **288** (was 286 — migration 37's two) | 288 |
| drift | — | **none** |

Both schema-application paths now list the same 42 files in the same order —
`init_all.sql` and `PHASE_FILES` diff to zero in both directions. The only remaining
local-vs-staging object gaps are the ones staging carries and the repo does not: the three
undeclared `*_admin_write` RLS policies (50 vs 53) and the `btree_gist` routine count
difference explained by J-005's PostgreSQL version split.

Note: `19_history_tasks_feedback.sql` remains applied by neither path. It is byte-identical
to `20_history_tasks_feedback.sql`, so no object is lost; it is dead weight, and deleting
it is left for the dead-code phase rather than done opportunistically here.

---

## J-018 · The correlation id is a module-level variable, so concurrent requests can be mis-attributed · MEDIUM · `CODE-PROVEN`

`worker/src/request-context.ts:5` stores the active correlation id in a module-level
`let`, and `runWithRequestContext` save/restores it around the callback. That is correct
for **nesting** but not for **interleaving**: with Cloud Run concurrency above 1, request
A's async continuation can read the id request B has just set.

Consequence for P5 specifically: the correlation id recorded on a lost write can belong to
a different request, which makes forensic attribution actively misleading rather than
merely absent. It is still recorded — a mostly-correct id beats none, and the actor,
owner and entity fields are unaffected — but it cannot be trusted for attribution until
this uses `AsyncLocalStorage`.

Not fixed here: swapping the storage mechanism affects every logger call site and the
`X-Request-Id` response header path, which is beyond P5's bounded scope. Filed for the
remediation roadmap, and noted inline in `fallback-log.ts` so nobody trusts the field
without reading this first.

---

## BLOCKED-FOR-DECISION · B-08 · `POST /api/history` returns 200 while the SQL write may have failed

P5 requires that *"a 2xx or successful UI state must not imply that PostgreSQL committed
when it did not"*. The original P5 prompt simultaneously requires **keeping** the
`POST /api/history` 200 contract. On the current SQL-only target those two conflict
directly, and the master prompt says to stop and document rather than guess. So:

**The conflict.** `saveHistoryEntry` writes the primary user-facing blob and the SQL
dual-write is best-effort behind it. When the dual-write fails the client still receives
200 with the entry echoed back, and the UI shows the call as saved. A queryable
`sql_fallback_log` row now exists, but nothing the *user* sees distinguishes "saved
everywhere" from "saved to the blob only".

**The smallest decision needed:** should `POST /api/history` report per-store persistence
truthfully — e.g. an additive, non-sensitive `sqlPersisted: boolean` — accepting that
clients must learn to read it? Or is the blob genuinely the authoritative user-facing
store, in which case the SQL write is a projection and the 200 is honest?

That is an architectural call about which store is authoritative, which the settled
decisions do not resolve for this route. **Not guessed at.** Observability was implemented
in full; the contract was left exactly as it was.

---

## BLOCKED — staging DDL approval required for migration 37

`janus/schema/37_fallback_correlation.sql` is additive and idempotent, and is verified
against a disposable local cluster from zero and on re-apply. It has **not** been applied
to staging: *"any staging DDL or migration"* is an explicit hard-stop requiring approval.

Until it is applied there, `logFallback` against staging will attempt an 8-argument call
against a 6-argument function, fail, and be swallowed to a console warning — which is the
module's designed behaviour, but means **staging would lose fallback telemetry entirely**.
That makes applying 37 a prerequisite for deploying this change, not an optional follow-up.

---

## P10 COMPLETE — provider calls bounded, cancellable, and classified

### Scope was larger than the audit recorded

F-027 named three unguarded provider calls (`transcript-infer.ts` ×2,
`embeddings.ts`). A sweep of every outbound `fetch` in `worker/src` found **ten files**
with no timeout and no abort propagation:

| file | calls | note |
|---|---|---|
| `auth.ts` | 1 | **Firebase JWK fetch — on the critical path for every authenticated request.** A hung socket here stalls all auth, not one feature. Not in the audit's list. |
| `embeddings.ts` | 1 | F-027 |
| `video/transcript-infer.ts` | 2 | F-027 |
| `zoom.ts` | 3 | metadata ×2 + VTT download |
| `providers/gemini-cache.ts` | 3 | create / update / delete |
| `providers/anthropic.ts` | 1 | |
| `providers/gemini-batch.ts` | 1 | |
| `enrichment/apollo.ts` | 1 | |
| `freshdesk.ts` | 3 | |
| `notify-email.ts` | 1 | |
| `data/usage-anomaly.ts` | 1 | outbound webhook |

**Left alone deliberately:** `providers/gemini-retry.ts` and the five files under
`research/providers/` + `prep/citations.ts` already implement AbortController +
timeout correctly. Rewriting them onto the new helper would be a refactor, not a fix,
and would risk working code for no behavioural gain.

### The helper

`worker/src/providers/fetch-timeout.ts`. Four things it gets right that are easy to get
wrong per-site: the timer is cleared in `finally` (otherwise a slow-but-successful
response leaks a pending timer and keeps Node's event loop alive); a caller-supplied
signal is composed, so cancelling the parent cancels the provider call instead of
orphaning it; `ProviderTimeoutError` (ours, `timedOut: true`) is distinguished from
`ProviderAbortedError` (the caller's), because only the former is safely retryable on a
non-idempotent call; and it **never retries** — retry belongs to the caller, the only
thing that knows whether its operation is idempotent. Adding retry here would have
silently multiplied `gemini-retry.ts`'s attempts.

### Pass classification, and a guard that immediately paid for itself

The five post-call passes F-027 named (`scorecard-verify`, `scorecard-calibrate`,
`deck-validate`, `speaker-attribution`, `linkedin-identity`) all live under
`worker/src/postcall/` — confirmed by location, not taken on trust — and were falling
through to the 45s `extraction` budget instead of 75s `postcall`.

Rather than just patch the list, the classification is now **explicit on both sides**
(`POSTCALL_PASS_NAMES`, `EXTRACTION_PASS_NAMES`, `VIDEO_PASS_NAMES`) with a test that
scans `worker/src` for pass names and fails on any that is not deliberately classified.

**That guard caught six more on its first run** — `batch/embeddings-fallback`,
`prep/demo-thesis`, `prep/rivals-context`, `search/rag-search`,
`video/summary-timeline`, `video/transcript-infer`. My own manual sweep had missed all
six, because the grep character class excluded `/` and so namespaced passes were
invisible. That is the *same failure mode* as the original F-027 defect — a hand-kept
list falling behind the code — one level down. 31 pass names are now classified; the two
video passes join `video/vision` on the vision budget.

### Gate

`worker/scripts/test-provider-timeouts.ts`, registered `unit`. **21 assertions** against
a **real loopback server that accepts and never responds**, so the timeout is exercised
against genuine socket behaviour rather than a stubbed `fetch`. No external network.

Covers: a hung socket bounded at roughly the budget; the error identifying itself as ours
and carrying the provider label; caller cancellation surfacing as an abort and **not**
marked retryable; a pre-aborted signal failing fast without opening a socket; success
unaffected **and no pending `Timeout` handle left behind** (asserted via active handles —
this is the leak that the `finally` clause prevents); all five F-027 passes resolving to
the postcall budget; the drift guard; and a sanity check that `auth` is the tightest
budget, since it gates every authenticated request.

---

## P15 COMPLETE — CI foundation

### 1. A unit failure silently suppressed every E2E test

`web/scripts/run-tests.mjs:123` read `if (alreadyUp || results.every((r) => r.ok))`.
One failing **unit** test therefore skipped every **e2e** file — not run, not reported,
not counted. The suite got *smaller* rather than *redder*, which is the worst possible
failure mode for a release gate: the signal disappears exactly when something is already
wrong. E2E now runs regardless of earlier results; the only legitimate skip is the dev
server failing to start, which is recorded as a FAIL.

### 2. Database gates exited 0 without a database

`grants_smoke`, `rls_fails_closed` and `ai_run_insert` returned early on an unset
`DATABASE_URL`, exiting 0 — indistinguishable from a pass, in exactly the environment
where they verified nothing. All three now exit **1**, with `--allow-skip` as the explicit
local opt-out. Verified by running each with and without the flag.
`view_rls.test.mjs` already hard-failed and was left as-is — stricter than P15 requires.

### 3. Thirteen orphan test files, exactly as F-038 said

| package | files |
|---|---|
| worker (9) | `test-ci-foundation.mjs`, `test-history-pg-backend.mjs`, `test-persistencereadmode-gate.mjs`, `test-pg-read-repository.ts`, `test-postcall-update-idempotency-conflict.ts`, `test-prep-save-fix.mjs`, `test-recovery-route.ts`, `test-scorecard-retry.mjs`, `test-user-usage.mjs` |
| web (4) | `test-adr008-read-contract.mjs`, `test-local-recovery.mjs`, `test-postcall-domain-routing.mjs`, `test-writemode-fallback.mjs` |

**Every one was run before registering it** — registering a failing test would have turned
the suite red for the wrong reason. All pass. Two needed classification rather than a
straight `unit` tag:

- `test-postcall-update-idempotency-conflict.ts` needs a live database → `sql` lane
  (verified passing against the local cluster).
- `test-scorecard-retry.mjs` is `.mjs` importing extensionless `.ts` specifiers, so it
  fails under bare `node` and passes under `tsx` — which `run-tests.mjs` always uses, per
  its own `runFile` comment. The harness was never the problem; nothing needed renaming.

**Two are tautologies, now visibly classified rather than silently orphaned:**
`test-history-pg-backend.mjs` (placeholder for `worker/src/history-pg.ts`, which does not
exist) and `test-adr008-read-contract.mjs` (placeholder for an unlanded read contract —
F-038 cited this exact file). Both assert nothing and pass trivially. Registered with
`TAUTOLOGY` reasons so they are visible; **they should be deleted or implemented**, and
that is left as a decision rather than taken unilaterally.

Manifest counts after: worker **115/115**, web **163 entries / 164 files** (the one
unregistered file is the manifest itself).

### 4. The `ai_run_insert` harness could never run — now fixed

`janus/tests/ai_run_insert.harness.ts` used top-level `await`. `janus/` has no
`package.json` declaring `"type": "module"`, so tsx transforms `.ts` here to **CJS**,
where top-level await is invalid: `Top-level await is currently not supported with the
"cjs" output format`. The harness **always** failed to start, so the two checks depending
on it could never pass. The merge audit carried this as a known limitation — *"2 of 12
checks cannot run"*.

Fixed by moving the awaits into an async `main()` driven by `.then/.catch`. Chosen over
renaming to `.mts` (keeps the path referenced at `ai_run_insert.test.mjs:132` intact) and
over adding `janus/package.json` with `"type": "module"` (which would change module
resolution for every file in the directory to fix one).

**`ai_run_insert` now reports 15/15.** That limitation is closed.

### 5. PostgreSQL in CI, and a typecheck

New `sql` job in `.github/workflows/ci.yml`: a `postgres:16` service, create database,
apply the schema **from zero**, **apply it again** (the only thing that catches J-017's
class of defect), then `npm run test:sql-gates` — which ends in `tsc --noEmit`, covering
P15's typecheck requirement. `web` is plain JavaScript with no tsconfig, so `worker` is
the only applicable workspace.

**Pinned to postgres:16 deliberately.** Staging runs 16.14 while the local
`embedded-postgres` devDependency is 18.4 (J-005). CI is the release authority, so it
matches the deployment target rather than the laptop. Java 21 for the emulator lane was
already present and is unchanged; `manual-only` and `live-api` remain excluded from CI.

### 6. Gate

`worker/scripts/test-ci-foundation.mjs`, registered `unit`. Asserts manifest completeness
for **both** packages (with an explicit `NOT_A_TEST` list — six operator tools, each with
a reason, so nothing is excluded silently), that no manifest entry points at a missing
file, that every tag in use is one some lane knows about, that the two schema-application
paths list the same 42 files in the same order, that every `.sql` on disk is applied or
explicitly known-unapplied, and that every `janus/tests` gate fails loudly without a
database.

Suites after P15: worker **100/103** (+8 newly registered, all passing; same three
pre-existing environmental failures), web **140/140** (+4), SQL lane **exit 0** end to end.

---
# MODE 2 — FORENSIC AUDIT FINDINGS
---

## J-019 · 99.86% of `ai_run` rows cannot be joined to the call they belong to · CRITICAL · `STAGING-VERIFIED`

F-023 estimated `ai_run` attribution at "~0%". Measured precisely on staging:

| measure | value | share |
|---|---|---|
| `ai_run` rows total | **2816** | — |
| with a non-NULL `activity_id` | **4** | **0.14%** |
| with a non-NULL `user_id` | 466 | 16.5% |
| total recorded cost | **$1.1365** | |
| input tokens | **16,700,036** | |
| output tokens | 1,618,844 | |

**16.7 million input tokens of LLM spend exist with no traceable call.** Every
per-call cost question — "what did this analysis cost", "which account is burning
budget", "is this SE's usage anomalous" — is unanswerable from this table, because
the FK that would answer it is populated on 4 rows out of 2816.

`run_type` is populated (only 55 NULL), so the *kind* of work is known; the *subject*
is not. 55 rows have no `run_type` either.

Severity is not hypothetical: `worker/src/data/usage-anomaly.ts` exists to detect
cost anomalies, and `docs/` describes per-SE adoption reporting. Both read a table that
cannot attribute 99.86% of its rows.

---

## J-020 · 283 of 345 post-calls have no scorecard — an 82% pipeline drop · CRITICAL · `STAGING-VERIFIED`

| measure | value |
|---|---|
| `post_call` rows | 345 |
| `post_call` with **no** scorecard for the same activity | **283 (82%)** |
| `scorecard` rows | 62 |
| `scorecard` marked `is_current` | 62 (all) |
| `scorecard_line` rows | 3900 |
| orphaned `scorecard_line` (no parent scorecard) | 0 |

Scoring is the product's core output, and it is absent for four of every five analysed
calls. This dovetails with **J-012**: `pipeline_state` reads `analysis_done` on all 345
rows, so nothing marks these as incomplete — an 82% failure rate is invisible to the
system's own state model. The prior audit's "every real call since has 0 rows in
scorecard" was too strong; the true figure is 62 scorecards for 345 calls, and the
mechanism is still unexplained.

Child integrity is sound where scorecards do exist: 3900 lines, zero orphans.

---

## J-021 · The outbox projector is not running, and the backlog is growing · HIGH · `STAGING-VERIFIED`

| status | rows |
|---|---|
| `pending` | **236** |
| `completed` | 51 |

The datamodel run log recorded **107 pending** with the note "the projector is not
running". It is now **236** — the backlog has more than doubled and nothing is draining
it. `claim_outbox_batch` exists (`janus/schema/06_phase6_outbox_integrations_pii.sql:140`)
and `/api/internal/outbox/project` is registered, but no scheduler is invoking it, and
`docs/SQL_QA_VALIDATION.md` records that there is no reaper for rows stranded in
`processing`.

Consequence for the architecture question: the outbox is the mechanism that keeps
Firestore in sync from PostgreSQL. With it stopped, `PERSISTENCE_MODE=sql` and
`dual` diverge silently, and `CUTOVER_SQL.md:48`'s rollback path — "`sql` → `dual` is
only safe while the projector kept Firestore in sync" — **is not available.**

---

## J-022 · 16 of 37 users have no `org_unit_id`, which is what RLS scopes on · HIGH · `STAGING-VERIFIED`

| measure | value |
|---|---|
| `app_user` rows, all `status='active'` | 37 |
| **with** `org_unit_id` | 21 |
| **without** `org_unit_id` | **16 (43%)** |
| users owning ≥1 activity | 32 |
| users with **zero** activities | 5 |

Every org-scoped RLS read policy matches on `org_unit.path` via the user's
`org_unit_id`. A user with NULL `org_unit_id` therefore has no org path, and
`current_org_path()` — redefined fail-closed at
`janus/schema/08_rls_hardening.sql:18` — returns NULL for them, so org-scoped reads
return nothing.

This is also the likely mechanism behind part of J-008's fallback volume:
`tryHistoryPostCallSqlWrite` skips with `unmapped_parent` when the writer's
`org_unit_id` is missing, and `unmapped_parent` appears in `sql_fallback_log`.

43% of the active roster is in this state. The prior audit's "25 of 46 roster people
unprovisioned" is superseded: they now have `app_user` rows, but 16 of them are
unusable for org-scoped access.

---

## J-023 · The daily usage rollup has effectively never run · MEDIUM · `STAGING-VERIFIED`

| table | rows |
|---|---|
| `user_usage_logins` | **172** |
| `user_usage_daily` | **2** |

Login events are being captured; the daily aggregation that Phase 9's weekly reporting
reads has 2 rows. Any "days logged in", "pre+post runs per person" or "zero-adopter"
report built on `user_usage_daily` is reading an empty table and will report near-zero
usage for a roster that demonstrably has 437 activities.

`worker/scripts/rollup-user-usage.mjs` exists. Nothing schedules it — the same class of
gap as J-021.

---

## J-024 · Leaderboard eligibility drops 16 of 62 scorecards, and shows one motion · HIGH · `STAGING-VERIFIED`

| measure | value |
|---|---|
| `scorecard` rows | 62 |
| `v_scorecard_rankable` rows | **46** |
| `v_se_score_leaderboard` rows | **3**, all `new_business` |

So 16 scorecards are excluded from ranking, and the leaderboard surfaces three people —
all New Business, which follows directly from **J-011** (no Expansion motion exists
anywhere in the data). `v_se_score_leaderboard` partitions by `se_motion`, so the
Expansion leaderboard is structurally present and permanently empty.

The exclusion of 16 is not itself a defect — `v_scorecard_rankable` encodes deliberate
eligibility rules — but combined with J-020's 283 missing scorecards, the leaderboard is
computed from **46 of 345 calls (13%)** while presenting as a ranking of SE performance.
Whether a 13% sample is a defensible basis for a shareable ranking is a product decision,
and it is not currently surfaced to the viewer.

**Consistent and healthy:** `pre_call` = 92 = `meeting` activity count exactly, and zero
activities lack both a pre_call and a post_call — so activity/pre_call parity holds.

---

## J-025 · ROOT CAUSE of J-011: `post_call` motion is computed in the BROWSER and never server-resolved · CRITICAL · `CODE-PROVEN` + `STAGING-VERIFIED`

J-011 established that every `post_call` is `new_business`. This is why.

### The chain

1. **The browser computes motion.** `web/postcall.js:385` calls `defaultSeMotion({ teamId,
   segmentId, isSegmentLeader })`.
2. `web/domain/se-motion.js:56-64` matches `teamId` against a **hardcoded Set of five team
   ids** — `team_ajay`, `team_nikil` → new_business; `team_mary`, `team_varun`,
   `team_akshita` → expansion — then three segment ids, then falls through to
   **`return "new_business";`** (`:63`).
3. The computed value travels in the request payload.
4. **The server reads it straight back out of the client document.** `routes.ts:3263` and
   `:2855` call `seMotionFromPostCallDoc(rec)`, which at
   `worker/src/domain-model/se-motion.ts:39-41` returns
   `canonicalizeSeMotion(doc.seMotion ?? analysisMeta?.seMotion ?? confirmed?.seMotion ?? scorecard?.seMotion)`
   and returns `"new_business"` when the document is absent (`:33`).
5. That value is stamped into `post_call.se_motion`.

**`org_unit.default_se_motion` is never consulted on this path.** The schema ships
`resolve_se_motion()` and `resolve_se_motion_for_user()`
(`janus/schema/21_identity_relationships.sql:97`, `:122`) built exactly for this, and they
are called **only** by the `scorecard` upsert (`postgres-repository.ts:570-590`) — never by
the `post_call` path.

This directly violates a settled decision in the mandate: *"Resolve motion server-side
from the canonical user/profile data. Do not trust a client-supplied motion as
authority."* Motion is client-supplied and is trusted.

### The database already knows the right answer

`resolve_se_motion_for_user()` executed read-only against staging, per owner org unit,
alongside what is actually stored:

| owner `org_unit_id` | post-calls owned | `resolve_se_motion_for_user()` returns | stored `se_motion` |
|---|---|---|---|
| `team_nikil` | 199 | `new_business` | new_business ✔ |
| **(NULL)** | **112** | **`(NULL)` — unresolvable** | new_business ✘ |
| `team_ajay` | 17 | `new_business` | new_business ✔ |
| `seg_new_business` | 8 | `new_business` | new_business ✔ |
| **`team_akshita`** | **6** | **`expansion`** | **new_business ✘** |
| **`team_varun`** | **2** | **`expansion`** | **new_business ✘** |
| **`team_mary`** | **1** | **`expansion`** | **new_business ✘** |

**Nine post-calls are provably mis-stamped** — 6 + 2 + 1 — and this **independently
reproduces the exact figure the mandate cited as a historical lead** ("nine confirmed
Expansion-owner mismatches"). The defect is unchanged since that observation.

The 345 rows decompose as:

| category | rows | note |
|---|---|---|
| correctly `new_business` | **224** | owner resolves to new_business |
| **provably wrong** | **9** | owner resolves to `expansion` |
| **unresolvable** | **112** | owner has no `org_unit_id` (J-022), so `resolve_se_motion_for_user` returns NULL — these cannot be corrected without provisioning the org first |

### Why the hardcoded allowlist is not the proximate cause

Worth stating, because it is the obvious suspect and it is **not** the bug: all eight
hardcoded ids match real `org_unit` rows on staging. The allowlist is not stale.

The real failure is structural in two ways:

- The team rows themselves have `default_se_motion = NULL` and **inherit** from their
  parent segment (`seg_digital` and `seg_nurture` are both configured `expansion`).
  `resolve_se_motion_for_user` walks the parent chain and gets it right; the browser's
  flat Set cannot express inheritance at all.
- A hardcoded list of five team ids named after individuals is a standing liability: any
  new team, rename, or reorg silently yields `new_business`. There are already **10**
  org units, including a `team_recovery` that appears in neither Set.

### Repair, and its ordering constraint

The fix is to derive `post_call.se_motion` server-side from
`resolve_se_motion_for_user(session.userId)` — the same call the `scorecard` path already
makes — and to stamp `se_motion_source` accordingly (`resolved` / `override` /
`defaulted`), never inferring it from the payload.

**Ordering matters:** for the 112 unresolvable rows the resolver returns NULL, so fixing
the write path alone converts a silently-wrong value into a loud failure for a third of
traffic. **J-022 (16 users with no `org_unit_id`) must be resolved first**, or the
motion fix will make those calls fail instead of merely mislabelling them. That is the
correct order and it is the opposite of the intuitive one.

**Not repaired here** — audit-only mode, and existing rows must not be altered. Backfill
is separately approvable work and is specified in `14-implementation-prompts.md`.

---

## J-026 · `post_call.detail` is erasable by the history write path — mechanism confirmed, impact order-dependent · HIGH · `CODE-PROVEN` + `STAGING-VERIFIED`

This is F-005 / P2, re-verified. It is stated carefully because a delegated inventory
reached a stronger conclusion than the data supports, and the distinction matters for how
it gets fixed.

### The mechanism — CONFIRMED

`upsertPostCall` overwrites `detail` unconditionally in both branches
(`postgres-repository.ts`): the UPDATE branch does
`SET transcript_ref = $4, analysis = $5, detail = $6, …`, and the ON CONFLICT branch does
`detail = EXCLUDED.detail`. The bound parameter is
`row.detail ? JSON.stringify(row.detail) : null` — so a falsy `detail` writes **NULL**, it
does not preserve the existing value.

There are **two** callers with different behaviour:

| Caller | passes |
|---|---|
| `upsertPostCallWithSummary` (domain-write path) | a real `detail` object |
| `tryHistoryPostCallSqlWrite` (`POST /api/history`) | **`detail: null`** |

So the history path can null a `detail` that the domain-write path populated. The
erasure mechanism is real and is exactly what F-005 described.

### The impact — NOT uniform erasure

Measured on staging:

| Measure | Value |
|---|---|
| `post_call` rows | 345 |
| `detail` **NULL** | **21 (6%)** |
| `detail` present | **324 (94%)** |
| `analysis` NULL | 63 |
| `transcript_ref` NULL | 176 |
| `detail_shape_version` | `1` on all 345 |
| **of the 62 calls WITH a scorecard, `detail` missing** | **15** |

**A delegated inventory concluded "every `POST /api/history` therefore sets
`post_call.detail = NULL`". That is too strong, and the data refutes it:** 324 of 345 rows
have `detail`. Write ordering decides the outcome — when the domain-write path runs after
the history path, `detail` survives.

What the numbers *do* support: 21 rows with NULL `detail`, and more tellingly **15 of the
62 scored calls have no `detail`** despite having completed scoring. Those 15 are the
population most consistent with erasure actually landing, since a call cannot normally be
scored without the evidence `detail` holds.

### Why the distinction changes the fix

If `detail` were nulled on every history write, the fix would be urgent and simple. Because
it is **order-dependent**, the fix must be a *merge* rather than a *replace* — otherwise
whichever writer runs last still wins, and the race just moves. `upsertDetailItem`
(`postgres-repository.ts:990-999`) already demonstrates the correct shape: a single-statement
`jsonb_set` key-level merge. `upsertPostCall` should either accept `undefined` as
"leave unchanged" (`COALESCE(EXCLUDED.detail, post_call.detail)`) or the history caller
should stop sending the field at all.

**Recorded as STILL-OPEN.** Not fixed: audit-only mode, and this is a data-shape change on
the primary write path that needs its own failing-before test and a decision about which
writer owns `detail`.

---

## J-027 · Correction to my own work: a manifest reason I wrote was factually wrong · `FIXED`

While registering the 13 orphan tests under P15, I recorded
`worker/scripts/test-history-pg-backend.mjs` as a *"TAUTOLOGY … placeholder for
worker/src/history-pg.ts, which does not exist."*

**`worker/src/history-pg.ts` does exist** — 4666 bytes, imported by
`worker/src/node-server.ts:12` and `worker/src/tasks-pg.ts:8`. So the test's
`optionalImport` guard does **not** fire and the test does assert something.

I took that claim from the test file's own docstring ("pending until
`worker/src/history-pg.ts` exists") without verifying it against the filesystem — the
exact failure mode this audit exists to catch, committed by me, in a document about other
people's stale claims. The manifest entry is corrected in place.

The other tautology flagged under P15, `web/scripts/test-adr008-read-contract.mjs`, was
**not** disturbed: F-038 cited that file specifically and its "pending" claim was not
re-checked here, so it remains flagged and unverified rather than silently cleared.

---

## J-028 · PostgreSQL is WRITE-ONLY by default; Firestore is read-authoritative · CRITICAL · `CODE-PROVEN`

This is the answer to the mandate's central question, and it is the most consequential
finding in the audit. Neither default implies it alone; **they compose into it.**

| Setting | Default | Declared at |
|---|---|---|
| `PERSISTENCE_MODE` | **`sql`** | `worker/src/data/persistence/types.ts:37` |
| `PERSISTENCE_READ_MODE` | **`firestore`** | `worker/src/data/persistence/read-repository.ts:896` |

`persistenceReadReady()` returns true **only** when the mode is exactly `"pg"`
(`read-repository.ts:897`). Every domain read handler gates on it —
`pgReadRepositoryFor` returns `null` when it is false (`routes/domain-reads.ts:70`) —
and each handler then falls through to the **Firestore** repository.

**So with shipped defaults: writes go to PostgreSQL, reads come from Firestore.**

### Why this is worse than either half

PostgreSQL accumulates data that the product never reads back. Firestore serves the UI
from a store that PostgreSQL no longer feeds, because the `sync_outbox` projector:

1. is populated **only** in `dual` mode — `enqueueOutbox`'s only callers are inside
   `DualWriteRepository`, so under the default `sql` mode the queue is never written; and
2. **is not running anyway** — 287 rows, 236 of them pending (J-021).

The two stores therefore diverge by construction, in both modes, and nothing reconciles
them.

### It explains findings that were previously unexplained

- **J-020** — 283 of 345 post-calls with no scorecard. Data lands in PostgreSQL; the UI
  reads Firestore. A missing PostgreSQL scorecard is invisible to the user, so the defect
  could persist at 82% without anyone reporting it.
- **J-019** — `ai_run` is write-only with 0.14% attribution. Nothing reads it, so nothing
  noticed.
- The **contradictions across the inherited docs** about which store is authoritative. Both
  camps were right about different halves: `RUN_LOG.md:609` ("Firestore is no longer a
  write target") is true of *writes*; `LOCAL_RUN.md:98` ("Reads are still Firestore") is
  true of *reads*. No document states both at once, so no document is correct.

### Secondary gate, independent of the mode

`authContext()` calls `ensureNodeFirestore(env)`, which throws **503** when
`firestoreAdminReady(env)` is false. So `/api/calls`, `/api/accounts`, `/api/deals`,
`/api/briefs` and `/api/contacts` are **hard-dependent on Firestore admin credentials even
in `pg` read mode**. Only `/api/users/me` is Firestore-free. That is why those five
endpoints 500/503 on this machine (handoff §3) — not a credential inconvenience, a
structural dependency.

**`RUNTIME-BLOCKED`:** the deployed values of both variables are unread (B-04), so I
cannot say whether production runs the defaults. But the defaults are what any
unconfigured environment gets, and no deployment file in the repo sets
`PERSISTENCE_READ_MODE` to `pg`.

**This single variable is the highest-leverage thing to check and, if it is unset, the
highest-leverage thing to decide.**

---

## J-029 · Only 13 of 37 users have an auth-identity binding · HIGH · `STAGING-VERIFIED`

Live row counts:

| Table | Rows |
|---|---|
| `app_user` | **37** |
| `user_identity` | **13** |
| `user_role` | 38 |

`resolveSqlSession` resolves **Firebase UID → `user_identity` → `app_user` → `org_unit.path`**.
A user with no `user_identity` row cannot resolve a SQL session by UID at all, and every
write for them falls back with `no_sql_session` — which is exactly a reason code present in
`sql_fallback_log` (22 occurrences).

**24 of 37 active users (65%) have no identity binding.** There is a secondary path,
`resolveSqlSessionByEmail`, which bypasses `user_identity` — so this is not necessarily a
total outage for those users, but it means the primary, UID-based resolution path fails for
two thirds of the roster.

Combined with **J-022** (16 users with no `org_unit_id`), the identity layer is incomplete
along two independent axes, and those are the two inputs every RLS policy depends on.

---

## J-030 · 27 of 64 tables are empty — the ORPHAN classifications confirmed empirically · MEDIUM · `STAGING-VERIFIED`

Code-level absence of writers does not prove a table is unused; a migration could have
loaded it. Measured, so now it does.

**Empty (27):** `account_summary`, `addon_price_book`, `app_user_avatar`, `arr_override`,
`assumptions_book`, `coaching_focus`, `coaching_recommendation`, `coaching_reflection`,
`contact_merge_log`, `deal_summary`, `feature_flag`, `integration_token`, `notification`,
`price_book`, `prompt_template`, `score_override`, `signal_cluster`, `sync_conflict`,
`sync_error`, `sync_job`, `technical_commit`, `webhook_event` (+ 3 partitions), plus 2
`audit_log` partitions.

The ones that matter:

| Table | Has a writer in code? | Empty because |
|---|---|---|
| `technical_commit` | **yes** | the write path exists and has never produced a row |
| `arr_override` | **yes** | same |
| `deal_summary`, `account_summary` | **yes**, with routes | **the client never calls them** — absent from `ADMIN_WRITE_METHODS`, so no request ever reaches the route |
| `score_override` | **no** | `localStorage` is the store of record; the `trg_score_override_audit` trigger can never fire |
| `signal_cluster` | yes | while `product_signal` has **313** rows — signals exist, clusters never form |
| `feature_flag` | no | no reader either; the cutover-guard trigger guards nothing |

**Notable non-empty:** `user_kv` **39 rows** — the "third store" is actively serving
history/tasks/feedback, confirming it is not vestigial. `task` has **2** rows against
`user_kv`'s 39, which is why the product's task board reads the blob and not the table.
`deal_stage_history` has **523** rows, more than `deal` (522) — the trigger works.

---
# P-C1 — CONCURRENCY HAZARDS, MEASURED
---

`07-acid-concurrency-recovery.md` identified nine hazards by **static analysis** and said
plainly that none had been tested. `worker/scripts/test-concurrency-hazards.ts` now
exercises each against a disposable local PostgreSQL.

**Result: 5 real, 3 defended, 1 unmeasurable here.** Two of my own predictions were wrong.

| # | Hazard | Predicted | **Measured** |
|---|---|---|---|
| H1 | `user_kv` blob lost update | HAZARD | **HAZARD** |
| H2 | `post_call.detail` erased by a detail-less write | HAZARD | **HAZARD** |
| H3 | two writers, one `public_id`, different idempotency keys | SAFE | **HAZARD** (intermittent) |
| H4 | `registerId` orphans the old `public_id` | HAZARD | **HAZARD** |
| H5 | repeated `upsertPostCall` | SAFE | **SAFE** |
| H6 | scorecard header rewrite deletes themes | HAZARD | **SKIP** — needs the rubric catalog |
| H7 | duplicate person discards all participants | HAZARD | **HAZARD** |
| H8 | concurrent outbox claims double-deliver | SAFE | **SAFE** |
| H9 | idempotency-key collision raises a raw error | HAZARD | **SAFE** |

---

## J-031 · Lost update on the history blob — MEASURED, now FIXED · HIGH · `FIXED-AND-VERIFIED`

Two concurrent read-modify-writes on one `user_kv.history` row: **1 of 2 entries
survived.** This is the exact pattern `history.ts` performs across two transactions, and
it is the product's primary, user-facing save path. Under READ COMMITTED with a
whole-column `SET history = EXCLUDED.history`, the later writer silently discards the
earlier entry.

Two tabs saving different calls lose one of them, with no error and a 200 response.

---

## J-032 · `post_call.detail` erasure — now MEASURED, not inferred · HIGH · `TEST-REPRODUCED`

J-026 established the mechanism and measured 21/345 NULL rows on staging, but could only
infer that the erasure fires in practice, because ordering decides it.

**Now proven directly:** seed `detail` with one item, add a second via
`upsertDetailItem` (confirming 2 items present), then issue one `upsertPostCall` with
`detail: null` — the exact shape `tryHistoryPostCallSqlWrite` sends. Result: **`detail`
becomes NULL and both items are lost.**

This upgrades J-026's impact half from `CODE-PROVEN` + inference to `TEST-REPRODUCED`, and
it confirms the fix must be a **merge**, not a null-guard.

---

## J-033 · An INTERMITTENT raw duplicate-key race on `post_call.activity_id` · HIGH · `TEST-REPRODUCED`

I predicted SAFE, reasoning that `ON CONFLICT (public_id)` would serialise two concurrent
writers. It does — but they then collide on a **different** constraint:

```
duplicate key value violates unique constraint "post_call_activity_id_…"
```

`post_call.activity_id UNIQUE` is one of the twelve constraints the audit found named by no
`ON CONFLICT`, and it is **reachable**. The write aborts the whole transaction with a raw
Postgres error rather than converging.

**It is intermittent, which is the important part.** The first two runs measured HAZARD,
the third measured SAFE. An intermittent race survives code review and manifests in
production. The test therefore repeats the race **12 times** and reports whether the
collision is reachable at all — deterministic detection of a non-deterministic fault.
Measured: collisions in every 12-attempt batch.

**A flaky test would have been the wrong answer here.** Re-recording whichever verdict came
last would have hidden a real race behind a green tick.

---

## J-034 · `registerId` orphaning — MEASURED, and it broke the test suite · HIGH · `TEST-REPRODUCED` (open; now logged)

Registering a second `public_id` for one `internal_id` leaves the **first `public_id`
unresolvable**: `resolveInternalId` throws `no mapping for … — migrate the parent first`.
Every child write keyed on the old id then fails `unmapped_parent`.

**Operational demonstration, unintended:** on the first run this hazard used the suite's
shared fixture user, and orphaning that user's mapping **broke every subsequent scenario**
— H5 onward could not resolve an owner. The hazard is severe enough to take down unrelated
work that merely shares an entity. That is exactly how it would present in production: not
as a failure at the remap, but as unrelated writes failing later.

The test now uses a dedicated user so the hazard cannot poison its own suite.

---

## J-035 · A duplicate person discards ALL participants, including the room — FIXED · HIGH · `FIXED-AND-VERIFIED`

`replaceCallParticipants` de-duplicates `secondarySe` against `primarySe` but **not**
`internalLeaderPublicIds`. Passing the same user as both primary SE and internal leader
raises `duplicate key value violates unique constraint "uq_cp_activity_user"`, and the
SAVEPOINT rollback discards **the entire participant set**.

Measured: **0 participants persisted** — including the meeting room, which had no conflict
and no relationship to the duplicated person. A manager who joined their own report's call
loses the whole identity stamp for that call.

---

## J-036 · `redact_pii()` is executable by `PUBLIC` and `janus_app` · HIGH · `FIXED-AND-VERIFIED`

Found while wiring P11, not by the security pass — `08` looked at RLS and routes, not at
function grants.

`06_phase6_outbox_integrations_pii.sql` ends with
`GRANT EXECUTE ON FUNCTION redact_pii() TO janus_redactor;`, which reads as "only the
redactor role may run this". **It is decorative.** Measured on a from-zero database, the
actual grantees were:

```
PUBLIC | janus_app | janus_redactor | postgres
```

Two causes, neither visible at the call site:

1. PostgreSQL grants `EXECUTE` on a new function to `PUBLIC` by default.
2. `07_grants.sql:22` does `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO janus_app`,
   and `:33` sets the same as a DEFAULT PRIVILEGE. **Both run after 06**, so they re-widen
   what 06 appears to narrow.

Why this is worse than an unused grant:

- `redact_pii()` is `SECURITY DEFINER` owned by `postgres`, so it runs with superuser
  rights and **bypasses RLS entirely**.
- It is **irreversible**. It `NULL`s `post_call.analysis` and `post_call.detail` for every
  post-call on a lost deal closed >12 months ago — the transcript-derived analysis,
  MEDDPICC, ARR, objections and commitments — and tombstones soft-deleted
  `app_user`/`contact` rows.
- `janus_app` is the role the **web worker** connects as. So any SQL injection reaching a
  query, or any leak of that credential, destroys call analysis with a single
  `SELECT redact_pii()` and no audit trail.

The contrast makes the omission clear: `18_ai_run_rls.sql` deliberately
`REVOKE`s `UPDATE, DELETE` on `ai_run` to protect **cost** data. No equivalent care was
taken for a routine that deletes the most sensitive content in the system.

Nothing in the product calls it — the only repo references are its own definition and
`07_grants.sql`'s comment — so revoking from `janus_app` removes a capability used by
nothing.

**Fixed** in `39_revoke_redact_pii_execute.sql`: revokes from `PUBLIC` then `janus_app`,
restates the `janus_redactor` grant, and ends with a `DO` block that raises if
`janus_app` still holds the privilege — so a future blanket `GRANT EXECUTE ON ALL
FUNCTIONS` cannot silently re-widen it a second time. Verified: grantees reduced to
`janus_redactor, postgres`; `has_function_privilege('janus_app', ...)` is false;
idempotent on re-apply. Gated by `test-dormant-jobs.ts`, which checks the **effective**
privilege rather than the direct grant.

A sweep of all 11 `SECURITY DEFINER` functions in `public` found the rest legitimately
need `janus_app` `EXECUTE`: `current_org_path`, `current_user_id`, `is_admin` (RLS
helpers), `log_sql_fallback` and `write_audit_log` (telemetry), and five `trg_*` trigger
functions. `redact_pii` was the only destructive one.

---

## J-037 · REFUTED: `POST /api/fetch-transcript` is not SSRF · was HIGH · `TEST-REPRODUCED` (as a refutation)

Recorded as a finding in its own right because `08` §7 ranked it the **top** security gap
and P-D2 put it first in priority order. It is wrong, and an audit that only corrects other
people's claims is not trustworthy.

The claim: "an authenticated user supplies an arbitrary URL the server fetches — **SSRF**,
and on Cloud Run that reaches the metadata server unless egress is restricted."

Measured with a `fetch` spy wired into `fetchRecordingFromShareLink`, counting outbound
requests rather than reading code:

| Payload | Outbound requests |
|---|---|
| `http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token` | **0** |
| `http://127.0.0.1:5432/` | **0** |
| `http://localhost:8787/api/internal/outbox/project` | **0** |
| `https://evil.example.com/steal` | **0** |
| `file:///etc/passwd` | **0** |
| `https://freshworks.zoom.us.evil.example.com/rec/share/abc` | **0** |
| `https://freshworks.zoom.us@evil.example.com/rec/share/abc` | **0** |

All seven rejected before any network call. **Why the claim looked right:**
`handleFetchTranscript` genuinely does pass `body.recordingUrl` straight through with no
validation of its own — so reading the handler alone supports the finding. The protection
is one layer down in `parseShareUrl`/`SHARE_URL_RE`, which requires the host to be
`zoom.us`/`zoomgov.com` **and** be followed immediately by `/rec/` or `/recording/`.

**The `/rec/` anchor is the load-bearing part, not the host pattern.** A host allowlist
alone would accept `freshworks.zoom.us.evil.example.com`, whose host really does contain
`zoom.us`; it is rejected only because `.evil...` follows instead of `/rec/`.

Because that protection is invisible at the call site and easy to loosen, it is now pinned
by `worker/scripts/test-route-authorization.ts` §7 — seven payloads, asserting zero
outbound requests. Loosen the regex and the gate fails rather than the route quietly
becoming the SSRF it was thought to be.

**Not refuted:** `GET /api/contacts?email=` as a contact-existence oracle, and the other
~20 authenticated-but-unscoped routes in `08` §1, remain DELEGATED and unverified.

---

## J-038 · `contact` has no RLS, and `/api/contacts?email=` is an unrestricted PII lookup · HIGH · `STAGING-VERIFIED` pattern, measured locally

Found while checking the *other* half of P-D2 item 1 (the "contact-existence oracle"). It is
worse than an existence oracle, and the cause is a one-table asymmetry:

| Table | `relrowsecurity` | `relforcerowsecurity` |
|---|---|---|
| `account` | true | true |
| `deal` | true | true |
| `post_call` | true | true |
| `scorecard` | true | true |
| `ai_run` | true | true |
| `user_kv` | true | true |
| **`contact`** | **false** | **false** |

`contact` carries **no policies at all** — `pg_policies` returns zero rows for it — so
`janus_app` reads every contact row in the system.

`GET /api/contacts?email=` (`routes/domain-reads.ts:381`) takes an arbitrary `email` from
any authenticated caller and returns the matching **records**, not a boolean. So the surface
is not "can I tell whether this person exists" but "give me this person's stored name, email
and title", for any email, from any account. Note the handler is otherwise well-behaved — it
binds `authContext` properly, unlike the offload handler fixed in P4 — so nothing here looks
wrong at the call site.

**Not fixed, and not a unilateral call.** Three reasons:

1. Contacts are described as **global** entities in the README, and the real use case is an
   SE looking up a prospect they are about to call — enabling RLS could break legitimate
   cross-account reads.
2. Enabling RLS on staging is DDL, a hard stop.
3. The right scope is a product question: global, org-scoped, or
   account-membership-scoped. Guessing risks a worse outcome than the gap.

What was done instead: the posture is now **pinned** in
`janus/tests/rls_fails_closed.test.mjs` as a recorded baseline that fails on divergence in
either direction. Disabling RLS on a protected table fails the gate, and *enabling* it on
`contact` also fails — forcing whoever makes that decision to record it rather than letting
the asymmetry stay invisible while it is pending.

`account`'s policies are also worth re-reading here: it is described as global too, yet it
has RLS + FORCE. That makes `contact` look like an omission rather than a decision.

---

## J-039 · J-010 recurs in `handleDealsCreate` — SEs cannot create deals on their own accounts · HIGH · `FIXED-AND-VERIFIED`

Found by reading `handleDealsCreate` for an unrelated reason (roadmap 3.5). It is a
**verbatim copy** of the J-010 defect, in a handler the original fix never looked at:

```sql
SELECT account_writable_by_current_user(resolve_internal_id('account', $1)) AS ok
     , set_config('app.user_id', $2, true) IS NOT NULL AS ctx_ok
```

A target list is not evaluated top-to-bottom, and `set_config(..., is_local => true)` is
scoped to the transaction — here an implicit single-statement one — so the predicate ran
with no `app.user_id`.

**Why it survived a whole audit:** `account_writable_by_current_user` **fails open on an
unclaimed account** (admin OR on-the-team OR unclaimed), and the unclaimed branch needs no
session at all. So the broken form returns `true` in exactly the case a casual test
constructs. My own first attempt to reproduce it did precisely that and measured
`ok=true` five times in a row, which looked like a refutation. Measured again against a
**claimed** account (an `account_se_team` row present) with the legitimate owner's session:

| Ordering | `ok=true` |
|---|---|
| as written in `handleDealsCreate` | **0 / 10** |
| `set_config` in an earlier statement, in a transaction | true |

**Live impact.** For any account that has been claimed, a non-admin SE is denied by the SQL
check and falls through to `assertCanReadResource` on `account.primarySeUserId` — which the
handler's own comment already records as *"never populated for accounts created via the SQL
path"*. So the owner of a SQL-era account gets
`403 "You are not authorized to create deals for this account."` on their own account.

**Fixed** by routing through `accountWritableBySession`, which evaluates the predicate inside
`withSessionContext` (BEGIN, then `set_config` as an earlier statement).

**And guarded as a class, not an instance.** This pattern has now been fixed twice; fixing
instances is demonstrably not holding. `test-route-authorization.ts` §8 walks every `.ts`
file under `worker/src`, extracts SQL string literals, and fails if any `SELECT` mixes
`set_config` with anything else in its target list. `session-context.ts` (a list of only
`set_config` calls) and `history-pg.ts` (a lone `set_config`) both pass. Verified by
reinstating the bad statement: the guard names the file and the offending expression.

The guard's first draft produced a FALSE POSITIVE on `history-pg.ts` because it scanned raw
source and its statement terminator ran past the end of a double-quoted query into the JS
argument list. It now extracts string literals first. Recorded because a guard that cries
wolf gets deleted rather than fixed.

**Still open in the same handler:** `POST /api/deals` calls `db.collection("deals").add()`,
a Firestore auto-id, so **every retry creates a duplicate deal**. That is §07.3's
non-idempotency finding (roadmap 3.5) and is untouched here.

---

## J-040 · DEFLATED: the 2358ms PostgreSQL handshake is an outlier, and pooling amortises the real cost · was the top latency lead · `TEST-REPRODUCED` (as a correction)

`09` §4 called this "the one latency signal worth escalating" and §7 called it "the most
likely real bottleneck", from a **single sample**. It was honest about that — "a lead, not
a finding" — and re-measuring is what it asked for. Roadmap 4.5, done.

Measured twice, 20 sequential connections each, against staging over the public IP
(`worker/scripts/measure-pg-handshake.mjs`, read-only):

| phase | median | vs TCP |
|---|---|---|
| TCP connect | **60.9ms** | 1.0x |
| full connect (TCP + TLS + startup + auth) | **441.9ms** | **7.5x** |
| `SELECT 1` on an open connection | 61.7ms | 1.0x |
| **pooled acquire + `SELECT 1`** | **59.0ms** | **1.04x** |

Three corrections:

1. **2358ms is not reproducible** — the typical cold connect is ~442ms, so the original
   reading was high by roughly 5x. The gap over TCP is ~7.5x, not ~36x.
2. **The cost IS per-connection**, not a first-contact one-off. First-vs-rest was 1.11x and
   1.84x across two runs — noisy, but far below the >3x a DNS/TLS-ticket effect would give.
3. **A warm pool amortises it entirely.** Pooled acquisition plus a query is **1.04x TCP**,
   indistinguishable from one round trip.

So the escalation was misdirected. The exposure is connection **churn** — Cloud Run cold
starts, a pool `max` too low for the configured concurrency, pool thrash — not steady-state
auth latency. The open question becomes "how often is a cold connection opened", which is
still `RUNTIME-BLOCKED` on the deployed `max` versus Cloud Run concurrency.

**The caveat that matters most, and it cuts against over-reading these numbers:**
`SELECT 1` on an *already-open* connection costs 61.7ms, essentially identical to the
60.9ms TCP connect. Both are one network round trip from a laptop to a public IP, so the
absolute figures measure **distance to the instance**, not Cloud SQL. A same-region Cloud
Run instance sees an RTT one to two orders of magnitude smaller, which puts the
cold-connection penalty in single-digit milliseconds. Only the **ratio** transfers.

Read the other way: for 2358ms to be a handshake at 7.5 round trips implies an RTT near
310ms — which is itself evidence that sample was taken under transient network conditions.

**Not done:** the Auth Proxy half of the comparison. The proxy is not installed here and
installing it changes the host's network posture. It remains the right next experiment, and
note it is a **security** requirement independently of latency — `pg-client-config.mjs`'s
own header says production must use the Auth Proxy or private IP, where
`rejectUnauthorized` stays `true` rather than the `false` used for public-IP QA.

---

## J-041 · RESCOPED: 7 of the "twelve unhandled unique constraints" were already absorbed, and §3's implied fix is impossible · was HIGH · `FIXED-AND-VERIFIED` (5 of 12)

Roadmap 3.4. §07.3 claimed twelve real unique constraints are named by no `ON CONFLICT`, so
"a collision surfaces as an unhandled `duplicate key value` that aborts the enclosing
transaction". H9 had already dented that. Testing each one individually settles it.

| Constraint | Verdict | Evidence |
|---|---|---|
| `idx_activity_idempotency` | ABSORBED | `existing` CTE matches the key (confirms H9) |
| `idx_pre_call_idempotency` | ABSORBED | same CTE shape — **but it updates the wrong row, see J-042** |
| `idx_post_call_idempotency` | ABSORBED | same CTE shape |
| `pre_call.activity_id` | **was REACHABLE → FIXED** | raised `pre_call_activity_id_key`, tx aborted `25P02` |
| `post_call.activity_id` | **was REACHABLE → FIXED** | raised **sequentially**, no concurrency needed |
| `idx_task_ai_dedup` | **was REACHABLE → FIXED** | raised, tx aborted |
| `idx_psig_ai_key` | **was REACHABLE → FIXED** | raised, tx aborted |
| `idx_account_slug_active` | ABSORBED | existing slug merge already handles it |
| `idx_contact_account_email_active` | ABSORBED | existing lookup already handles it |
| `idx_scorecard_activity_current` | ABSORBED | demote-first UPDATE already present |
| `uq_aset_primary` | ABSORBED | demote-first already present |
| `idx_deal_contact_primary` | **was REACHABLE → FIXED** | raised, tx aborted |

**7 of 12 were already safe.** §3 inferred reachability by grepping `ON CONFLICT` targets
and never read the surrounding statement — four paths already had a pre-emptive lookup or a
demote-first UPDATE, and two inherit H9's CTE.

**§3's implied remedy is not merely wrong, it is impossible.** "Named by no `ON CONFLICT`"
reads as a one-line fix. PostgreSQL allows **one** `ON CONFLICT` target per `INSERT`, and
every one of these statements already spends it on `(public_id)` for replay idempotence —
for `post_call` that clause *is* the 2026-09-09 staging fix the doc cites. So each of the
five absorbs its second constraint the way the already-safe paths do: a pre-emptive
`FOR UPDATE` lookup, an extra `existing` predicate, or demote-first.

**`post_call.activity_id` is worse than H3 implied, not better.** H3 needed 12 concurrent
attempts and read as an intermittent race. It is reachable in **two plain sequential
writes** with no concurrency at all.

**Conflict actions, chosen per constraint rather than by default:** `task` and
`product_signal` use DO UPDATE, not DO NOTHING — a dedup-key match means the pass
re-derived the same item with newer wording, so DO NOTHING would trade an abort for a
silent lost write. `deal_contact` demotes the incumbent (last-writer-wins), because the
caller passed `isPrimary: true` explicitly and DO NOTHING would report success while the UI
showed a promotion that never happened.

**Two new reachable cases §3 does not contain, left REACHABLE deliberately:** renaming an
existing account onto a taken slug (`C8b`), and `patchContact` renaming onto a taken email
(`C9b`). Both abort the transaction. Not fixed because a rename onto a taken value is a
**merge** request and which row survives is an identity decision — DO NOTHING discards a
rename the caller thinks succeeded, and auto-merging would remap `public_id`s and orphan
the loser through the same `registerId` remap as J-034.

**Residue, not hidden:** `pre_call`/`post_call.activity_id` are fixed on the **sequential**
path only. `FOR UPDATE` cannot lock a row that does not exist yet, so two concurrent
writers can still race. **H3 remains `HAZARD`** in `test-concurrency-hazards.ts`,
unchanged — that window is writer convergence (P3).

**A consequence worth naming:** the `task` fix calls `registerId` with the incoming
`public_id` against the surviving row, which is exactly the J-034 remap — the previous
`public_id` stops resolving. It matches the convention `upsertContact` already uses, and it
is now logged (J-039), so it is visible rather than silent. It trades an aborted
transaction for a remapped id, which is the better failure but not a free one.

Gated by `worker/scripts/test-unique-constraint-coverage.ts`, a recorded-verdict baseline
that fails on divergence in either direction. Verified load-bearing: reverting the
repository flips exactly C4, C5, C6, C7 and C12 to REACHABLE and the suite fails.

---

## J-042 · `idx_pre_call_idempotency` absorbs a collision by updating the WRONG row — a second activity silently gets no brief · HIGH · `TEST-REPRODUCED`

Found while testing J-041, and it is the most interesting result there because **§3's method
structurally could not find it.**

Two `pre_call` rows on **different activities** that share one idempotency key both resolve
to the first row through `upsertPreCall`'s `existing` CTE
(`public_id = $1 OR idempotency_key = $2`). The second write therefore **updates the first
activity's brief** instead of creating its own. The second activity ends up with **no
pre-call brief at all**.

There is no duplicate-key error, no aborted transaction, and no fallback-log row. So a
search for constraints "named by no `ON CONFLICT`" — the entire basis of §3 — would never
surface it. This is the same shape as H9's lesson pointed the other way: absorption is not
the same as correctness, and "handled" is not the same as "right".

Not fixed here. The CTE is load-bearing for replay idempotence, and narrowing it to
`(idempotency_key, activity_id)` is a change to what an idempotency key *means* — a design
decision that belongs with the writer-convergence work (P3), not a patch alongside a
constraint sweep.

Recorded as a verdict in `test-unique-constraint-coverage.ts` so the behaviour is pinned
while the decision is outstanding.

---

## J-043 · `forceRefresh` silently dropped from the token-getter wiring — the 401-retry mechanism was a no-op in all 8 consumers · HIGH · `FIXED-AND-VERIFIED`

2026-09-11 staging UAT-001c: "401 on `/api/history`", recorded as "mechanism confirmed
[history.js does retry a 401 with a forced refresh], trigger unconfirmed". Found and fixed
without a live authenticated session — the trigger was findable entirely from code.

`history.js` (and `tasks.js`, and five other consumers) retry a 401 with
`getAuthToken?.(true)`, intending Firebase to fetch a genuinely new token. Every place
`web/app.js` supplied that getter used a **zero-parameter** arrow function:

```js
setHistoryAuthGetter(() => fb.auth.currentUser.getIdToken());
```

JavaScript does not error when a caller passes an argument a function doesn't declare — it
is simply discarded. So `getAuthToken(true)` ran `getIdToken()` with Firebase's own default
(`forceRefresh = false`), and got back the **same cached token** the client SDK still
considered valid. The retry looked like it was retrying with a fresh token; it was retrying
with the identical one.

This explains the "trigger unconfirmed" half exactly: Firebase's own no-force `getIdToken()`
already self-heals *most* genuine expiry (the SDK checks the cached token's expiry against
the local clock before returning it). The retry mechanism only matters for the cases that
check **doesn't** catch — clock skew between the client and the Cloud Run instance, a
revoked session, or the exact boundary where the client's cache and the server's clock
disagree. Those are precisely the cases where a real network round-trip (what `forceRefresh`
requests) would recover and a cache-only check would not — and this bug meant the retry
never actually attempted one.

One root cause, wide blast radius: `applySessionAuthGetters()` is the single function that
feeds this same broken getter into **7** consumers (history, local-sync, tasks, summaries,
call-payload, timeline, product-signal) plus `postcall.js`'s `onSessionReady`. A second,
redundant re-wiring in `buildFetchRemoteHistory()` had the identical bug. Both fixed with the
same one-line change: `(forceRefresh) => fb.auth.currentUser.getIdToken(forceRefresh)`.

**Not touched, a related but distinct gap:** `feedback.js`, `prep-disputes.js`,
`score-disputes.js` and `precall.js` call their own `getToken()` with **no** retry logic at
all — not a silently-defeated mechanism, just one that was never built. Same class of gap as
`postcall.js`'s `authHeaders()` (found and left alone during P1 item 10 for the same reason:
out of scope for a specific 401-on-history ticket). Worth a follow-up if 401s are ever
reported on those paths specifically.

Gated by `web/scripts/test-history-auth-refresh.mjs`: a behavioral test driving
`history.js`'s real exports against a fake Firebase user that returns a different token
depending on `forceRefresh` (proves the retry produces a genuinely different token when
wired correctly, and — by contrast, with the same fake user — that the original buggy shape
cannot), plus a static regression guard on `app.js`'s actual source text, since `app.js` has
zero exports and 3341 lines of DOM/module-load side effects with no precedent in this repo
for being imported directly in a test. Verified the static guard specifically catches the
regression: reverting the two call sites to the zero-parameter shape fails exactly those two
assertions and no others; the behavioral tests are unaffected since they exercise the
contract via inline fakes, not `app.js` itself.

---

## J-044 · Confirmed attendees never reconciled against the LLM's own roster — the missed person disappears from every downstream view, including the MoM greeting · HIGH · `FIXED-AND-VERIFIED`

2026-09-11 staging UAT-008: "missed attendee" — a person present on a call, and explicitly
confirmed as an attendee on `postcall.js`'s confirm-step roster before submission, was absent
from the post-call view. Root-caused entirely from code, no live session needed.

Two independent sources of "who was on this call" exist and were never reconciled:

- `analysis.callHeader.attendees` — the LLM's own read of the transcript, wrong whenever
  someone spoke too little or was never clearly named on camera.
- `record.confirmedIdentities.attendees` — the full roster the user explicitly confirmed
  (and could add to) on the confirm-step screen, persisted verbatim by `postcall.js`'s
  `readAttendeeSelections()`.

Every `call-view.js` read site (`buildLocalCallBundle`, `loadCallBundle`,
`resolveMinutesViewModel`) read `analysis.callHeader.attendees` directly, with no fallback to
or union with the confirmed roster that was already sitting on the same record. A person the
user had explicitly added at confirm-time was already saved correctly — it just never
resurfaced anywhere downstream.

The most consequential of the three read sites: `resolveMomGreetingName()` picks the first
attendee whose role matches `/customer|prospect|buyer|client/i` to address the auto-drafted
Minutes-of-Meeting email. When that customer was the one the LLM missed, greeting-name
resolution fell through to a text-scraping fallback over the draft body, which could — and in
the reproduced fixture, did — grab an unrelated word from the email and address the customer
by the wrong name entirely.

Fixed with one shared reconciliation point, `resolveCallAttendees(record)` in `call-view.js`:
additively unions any confirmed attendee missing from the LLM's list (matched by
`normalizePersonKey` on name/email/label — the same key scheme `mergeCallIdentities` already
uses in this file), never removing or overriding an LLM-derived attendee already present
under the same identity. Records with no `confirmedIdentities` at all (older saved records)
degrade to exactly the pre-fix behavior. `buildStakeholderRows`'s own inline union — a
different algorithm, full union-find identity clustering via `mergeCallIdentities` — was
deliberately left untouched rather than risk its already-correct clustering; it benefits
anyway, since both call sites that build its `attendees` argument now pass the reconciled
list.

Gated by `web/scripts/test-call-view-attendee-reconcile.mjs`. Verified independently, not
just taken on the implementing agent's report: reverted `call-view.js` to pre-fix and ran the
real, unmodified `resolveMinutesViewModel` (only its internals changed by this fix, so it
exists both before and after) directly against the reported fixture — LLM attendees = SE +
AE only, confirmed roster additionally includes the customer, draft body opens "Dear Team,".
Pre-fix: `emailDraft` opens `"Dear Team,"` — the wrong name. Same fixture, fix restored:
`"Dear Priya,"` — the confirmed customer. The committed test's own "fails before" check uses
a local copy of the matching logic rather than importing the real function, because
`resolveCallAttendees` does not exist pre-fix at all — importing the test file against the
reverted source fails immediately at the import statement, a stronger but less specific
signal than a single assertion.

---

## Corrections to the audit's own static analysis

### H9 — "twelve unnamed constraints all raise raw errors" is **too strong**

I predicted HAZARD for `idx_activity_idempotency`. **Measured SAFE.** `upsertActivity`'s
`existing` CTE selects on `public_id = $1 OR idempotency_key = $2`, so a second
`public_id` reusing one key is **found and updated**, never inserted. The constraint is
unnamed in `ON CONFLICT` but **unreachable in practice**.

So "unnamed in `ON CONFLICT`" does **not** imply "reachable". Some of the twelve are
absorbed by an existing-row lookup; at least one (`post_call.activity_id`, J-033) is not.
**Each of the twelve needs its own test** — the blanket claim in `07` §3 should be read as
a list of candidates, not of defects.

### H8 — the outbox claim is genuinely correct

Two concurrent `claim_outbox_batch` calls claimed the row **exactly once**.
`FOR UPDATE SKIP LOCKED` holds. The outbox design is sound; only its scheduler is missing
(J-021).

### H5 — idempotency works where it is claimed to

Three sequential identical `upsertPostCall` calls produced exactly one row.

---

## What remains unmeasured

**H6** (scorecard header rewrite deleting themes) needs a loaded rubric catalog, which this
cluster does not have. The `DELETE FROM scorecard_theme` at `postgres-repository.ts:656` is
`CODE-PROVEN` but **UNMEASURED**. It reports `SKIP`, which the suite deliberately does not
count as a pass — a skip is a coverage gap, not a green tick, which is the distinction
F-038 found the old gates getting wrong.

Also still unmeasured from `07` §10: deadlock ordering, pool exhaustion, request
cancellation after commit, outbox replay, and migration rollback.
