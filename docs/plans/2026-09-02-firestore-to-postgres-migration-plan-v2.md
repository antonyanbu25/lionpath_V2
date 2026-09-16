# Firestore → Cloud SQL Postgres: migration plan v2

**Status:** ready for review · **Date:** 2026-09-02 · **Supersedes:** the LLM-authored plan circulated as `i-think-the-wiring-sparkling-eich.md`

---

## 0. How to read this document

You are likely an LLM agent asked to review or execute this plan. Three rules:

1. **Every claim below is graded.** `[VERIFIED]` means I ran the code or queried the database in this repo and observed the result — the method is stated. `[CODE]` means read directly from source at the cited `file:line`. `[UNVERIFIED]` means it depends on production state nobody has observed yet. `[ASSUMPTION]` means I inferred it and it needs confirmation. **Do not promote an `[UNVERIFIED]` claim to fact because it appears in a plan document.** That is precisely how the previous plan failed.

2. **The previous plan's failure mode was fabricated live-data evidence.** It asserted specific production row counts ("`deal` has zero rows", "14 orphaned `deal_stage_history` rows", pre-existing `app_user`/`user_identity`/`org_unit` rows from batch scripts) and built its entire root-cause argument on them. When I queried the only database reachable from this machine, none of those numbers matched: `user_identity`=0, `user_role`=0, `org_unit`=0, `app_user`=1 (the AI sentinel), `deal_stage_history`=0. Its *code* claims were accurate; its *data* claims were not. **Never state a row count you have not personally queried.**

3. **Gates are hard.** Each phase ends with a gate. Do not begin phase N+1 until phase N's gate passes with observed output pasted into the PR. This repo has a documented history of writes silently succeeding at the HTTP layer while persisting nothing — see [`docs/SQL_AGENT_VERIFICATION.md`](../SQL_AGENT_VERIFICATION.md). An HTTP 200 is not evidence.

---

## 1. Executive summary

The v9.3 target schema **is already built and applied** — 45 tables/partitions across `janus/schema/00`–`20`, with RLS enabled and forced on 13 tables (25 policies). Field-level mappings are already implemented in `worker/src/data/persistence/`. **This is not an entity-modelling project.** Do not spend time redesigning the mapping.

What actually remains, in order of risk:

| # | Problem | Severity |
|---|---|---|
| 1 | **31 of 42 Firestore collections have no migration path.** The backfill script reads 11. | Blocker |
| 2 | **~12 collections must be folded into JSONB columns** (`post_call.detail`, `deal.tc_detail`), not copied as rows. No code does this. | Blocker |
| 3 | **The outbox projector has no scheduler.** `dual` mode writes Postgres and silently stops updating Firestore; documented rollback is therefore false. | Blocker |
| 4 | **The migration script loses rows and rewrites values silently.** No warning, exit code 0. | Blocker |
| 5 | **~5 collections (ARR/pricing) have no destination table in v9 at all.** | Needs product decision |
| 6 | Store routing is per-user and per-payload, so the same entity can live in either store. | High |
| 7 | Login never provisions Postgres identity, so new users permanently no-op the SQL path. | High (but see §4.3 — not the root cause the previous plan claimed) |
| 8 | Nothing writes `audit_log`; `notification`/`coaching_*` are unbuilt. | Green-field, defer |

**Do not attempt a same-day cutover.** Problems 1–4 each lose data independently. A realistic sequence is in §7.

---

## 2. Ground truth: what was actually observed

### 2.1 The database this machine points at is not Cloud SQL `[VERIFIED]`

`worker/.dev.vars` has `DATABASE_URL`/`DATABASE_URL_MIGRATIONS` → `127.0.0.1:5432`. That is a **local embedded Postgres** (PG 18.4, data in `worker/.local-pg`, stood up by [`worker/scripts/start-local-postgres.mjs`](../../worker/scripts/start-local-postgres.mjs) with hardcoded dev passwords). Local `PERSISTENCE_MODE=firestore`.

*Method:* parsed `.dev.vars`, connected with `pg`, ran `SELECT version(), inet_server_addr()`.

There is **no gcloud CLI, no `~/.config/gcloud`, no `GOOGLE_APPLICATION_CREDENTIALS`, and no service-account JSON** on this machine. Neither Firestore nor Cloud SQL has ever been reachable from here.

> **Reviewer/executor note:** if you query `127.0.0.1:5432` and report production findings, you are reporting on a scratch database. Print the host first, every time.

### 2.2 Contents of that local database `[VERIFIED]`

45 tables, 41 empty. Only content: `app_user`=1 (`usr_janus_ai` sentinel only), `integration`=1 (`int_firestore_projection`), `ai_run`=12 (all `run_type='analysis'`, all with NULL `activity_id` — smoke-test residue), `id_registry`=5 (includes `__se_motion_smoke_pc__`). `app_role`, `rubric`, `org_unit`, `user_identity`, `user_role`, `deal`, `activity`, `pre_call`, `post_call`, `task`, `sync_outbox` all zero.

Tables are owned by `postgres`, **not `janus_owner`** as the spec requires. Superusers bypass RLS entirely, so verify ownership on the real instance — `postgres`-owned tables plus a superuser app connection makes `FORCE ROW LEVEL SECURITY` inert.

### 2.3 Production state is unknown `[UNVERIFIED]`

Nobody has observed the Cloud SQL instance or Firestore. Every production row count in any prior document is unsubstantiated. §3 lists the questions that must be answered by a human before phase 2.

---

## 3. Open questions — must be answered before phase 2

| # | Question | Why it changes the plan |
|---|---|---|
| Q1 | Has the deployed worker **ever** run with `PERSISTENCE_MODE=dual` or `sql`? | If yes, production data is already split across Firestore and Postgres and diverging *now*. Reconciliation becomes phase 0, not phase 3. |
| Q2 | Does a Cloud SQL `janus-db` with real data exist? | If not, this is a migration that hasn't started, and "unblock the starved write paths" is the wrong frame entirely. |
| Q3 | Are the `arrLines` / `arrOverrides` / `priceBooks` / `addonPriceBooks` / `assumptionsBooks` collections live and business-critical? | They have **no destination table** in v9. Either the schema grows or this data is knowingly abandoned. |
| Q4 | Are the lowercase `postcalls` and `preps` collections live, or dead legacy twins of `postCalls`/`prepBriefs`? | Determines whether they need migrating or deleting. |
| Q5 | Is `web/domain/firestore-store.js` (direct browser→Firestore writes) still enabled for any production user? | If yes, writes bypass the worker entirely and no server-side migration can capture them. |
| Q6 | Is the `score_override` product flow the dead builder in `domain-model/scorecard.ts`, or the `localStorage` + Freshdesk flow in `web/score-disputes.js`? | Decides what `score_override` should even contain. |

Do not guess these. Q1 and Q2 in particular determine whether the plan below is correct or inverted.

---

## 4. Findings

### 4.1 Collection disposition: 42 collections, 11 handled `[VERIFIED]`

*Method:* `grep -oE "match /[A-Za-z]+/" firestore.rules` cross-checked against `firestore.indexes.json` `collectionGroup` values and the collection keys read by [`worker/scripts/migrate-firestore-to-sql.mjs`](../../worker/scripts/migrate-firestore-to-sql.mjs).

**Group A — migrated today (11).** `orgs`, `teams`, `users`, `authIndex`, `accounts`, `contacts`, `deals`, `lifecycles`, `dealContacts`, `prepBriefs`, `postCalls`.

**Group B — has a v9 table, no migration code (8).**

| Firestore | Postgres target |
|---|---|
| `tasks` | `task` |
| `scorecards` | `scorecard` |
| `scorecardLines` | `scorecard_line` |
| `productGaps` | `product_signal` |
| `scoreOverrides` | `score_override` |
| `gapClusters` | `signal_cluster` |
| `rubrics` | `rubric` |
| `rubricThemes` | `rubric_theme` |

**Group C — must fold into `post_call.detail` JSONB, not copied as rows (9).** `videoFacts`, `timelineSegments`, `timelineMarkers`, `followUps`, `objections`, `momDrafts`, `meddpiccDeltas`, `dealSignals`, `whatWorks`.

This is the **most consequential finding in this document.** Each of these is a separate top-level Firestore collection with its own upsert method — see `UPSERT_COLLECTIONS` at [`worker/src/routes.ts:1499`](../../worker/src/routes.ts:1499) and the browser writers at [`web/domain/firestore-store.js:1464`](../../web/domain/firestore-store.js:1464). But the v9 spec defines them as **fields inside the `post_call.detail` JSONB shape** (`videoFacts`, `timelineSegments`, `timelineMarkers`, `tcDeltas`, `meddpiccDeltas`, `objections`, `followUps`, `momDrafts`, `dealSignals`, `whatWorks`). The migration script copies `pc.detail` wholesale and never reads these collections, so **all of this data is orphaned** unless the exporter assembles it.

`productGaps` appears both as a `detail` field *and* as the `product_signal` table. Resolve the duplication explicitly before writing code.

**Group D — must fold into `deal.tc_detail` JSONB (2).** `technicalCommits`, `tcDeltas`.

**Group E — read models, replaced by v9 views; do not migrate (3).** `accountSummaries`, `dealSummaries`, `callSummaries`. Superseded by `v_account_rollup` / `v_deal_traction` / `v_team_metrics` in `janus/schema/12_read_model_views.sql`.

**Group F — no v9 destination table exists (7).** `arrLines`, `arrOverrides`, `assumptionsBooks`, `priceBooks`, `addonPriceBooks`, `clusteringState`, `events`. *Method: no `arr_*`, `price_book`, or `assumptions` table appears anywhere in `janus/schema/*.sql`.* Blocked on Q3. `events` partially overlaps `deal_stage_history` + `audit_log`.

**Group G — suspected legacy duplicates (2).** `postcalls`, `preps` (lowercase). Blocked on Q4.

> Any statement that this migration is "nearly done" is incompatible with 31 of 42 collections having no code path.

### 4.2 The migration script's defects `[VERIFIED by execution]`

*Method:* built a 14-collection fixture with deliberate edge cases, ran the real `migrate-firestore-to-sql.mjs` against the local Postgres, inspected every landed row, then re-ran to test idempotency.

**What works correctly — do not "fix" these:**

- Org tree with materialized paths: `org_apmea` → `/org_apmea/`, `team_cx` → `/org_apmea/team_cx/`
- `app_user` + `user_identity` + `user_role`, with `admin`/`manager`/`se` correctly mapped. **The previous plan's claim that batch scripts leave users without `user_identity` rows is false** — the script handles it explicitly at [`migrate-firestore-to-sql.mjs:186`](../../worker/scripts/migrate-firestore-to-sql.mjs:186) (`QA #14`) and `user_role` at `QA #12`.
- Reference-data seeding: `app_role` (4 rows) and `rubric`/`rubric_theme` are seeded by the script itself at lines 120–136. **These are only missing if you wire login-provisioning without ever running the backfill.**
- Lifecycle→deal folding, including stage mapping (`business_case` → `proposal`)
- `deal_stage_history` trigger fires unprompted (3 rows observed)
- Stable idempotency keys (`prep_*`, `call_zoom_abc123`)
- **Genuinely idempotent** — ran twice, zero duplicates, counts identical

**Defect 1 — `--dry-run` reports wrong numbers.** Observed `org_unit: 1` (actual 3), `activity: 0` (actual 2), `user_identity: 0` (actual 5). Cause: the key map at [`migrate-firestore-to-sql.mjs:88`](../../worker/scripts/migrate-firestore-to-sql.mjs:88) derives collection names as `k + "s"`, producing `"activitys"`, and does not account for `teams` folding into `org_unit` or `authIndex` → `user_identity`. **The only pre-flight check available is unreliable.**

**Defect 2 — silent row-level drops.** `contacts` and `deals` log a warning. `dealContacts`, `prepBriefs`, and `postCalls` use a bare `continue` with no output (lines 297, 313, 341). My fixture lost one prep brief and one post-call invisibly while the script printed `migration complete` and exited 0.

**Defect 3 — enum coercion corrupts rather than fails.** `dealStage()`/`dealStatus()` (lines 72–79) coerce any unrecognized value to `prospecting`/`active`. Observed: a deal with `stage: "negotiation"` was rewritten to `prospecting`; `status: "weird"` → `active`. No warning. This is worse than an error — it is plausible-looking wrong data that propagates into `deal_stage_history` and every forecast rollup.

**Defect 4 — broken org parent silently becomes a root path.** A team whose `orgId` does not resolve gets `parent_id=NULL, path='/team_orphan/'` (line 148). Manager RLS is path-prefix based, so a manager scoped to `/org_apmea/` **silently cannot see that team's deals.** A data-quality problem becomes an invisible permissions hole.

**Defect 5 — post-run counters are misleading.** On the idempotent second run the script reported `app_user: 5` despite inserting nothing, because the counter increments on the existing-row lookup path.

### 4.3 The `PERSISTENCE_MODE` gate precedes the identity gate `[CODE]`

[`worker/src/routes.ts:1701`](../../worker/src/routes.ts:1701):

```js
const port = resolvePersistencePort(env);
if (!port || !postgresReady(env)) return { handled: false };   // ← mode gate, checked first
if (!verified?.uid) return { handled: false };
const session = await resolveSqlSession(verified.uid, env);     // ← the previous plan's "root cause"
```

`resolvePersistencePort` returns `null` for `firestore` mode ([`dual-write-repository.ts:245`](../../worker/src/data/persistence/dual-write-repository.ts:245)). Every default in the repo is `firestore` — `docker-compose.yml:29`, `.env.example:89`, `.dev.vars.example:24`, `node-server.ts:99`, and the local `.dev.vars`.

**Consequence:** if production is in `firestore` mode, wiring login-provisioning changes nothing and `deal` stays empty. The previous plan called identity provisioning "the highest-leverage single change in this entire plan" without ever stating the deployed mode. See Q1.

### 4.4 The outbox projector has no scheduled caller `[VERIFIED]`

In `dual` mode a successful SQL write does **not** write Firestore inline. It enqueues a `sync_outbox` row ([`dual-write-repository.ts:35`](../../worker/src/data/persistence/dual-write-repository.ts:35)), and Firestore is updated only by `POST /api/internal/outbox/project`. That endpoint exists and works. Nothing calls it:

- [`deploy/vps/install-crontab.sh`](../../deploy/vps/install-crontab.sh) installs `poll`, `fallback`, `embedding`, `read-models` — no outbox job. `cron-batch.sh`'s `resolve_path()` has no outbox case.
- [`deploy/cloudrun/cloud-scheduler.example.sh`](../../deploy/cloudrun/cloud-scheduler.example.sh) is marked `DORMANT`, fully commented out, and does not include the job even as a comment.
- [`docs/CUTOVER_SQL.md`](../CUTOVER_SQL.md) lists "Outbox projector scheduled" as a prerequisite gate.

**Consequences:** enabling the SQL path in `dual` mode silently stops Firestore from receiving those writes; and the documented rollback — "`dual` → `firestore`: flip the env flag; Firestore is still current via the projector" — **is false**, because the projector never ran. Also invalidates the previous plan's "account/contact: None — already correctly dual-writing."

### 4.5 Store routing is per-user and per-payload `[CODE]`

Fallback to Firestore happens per request on at least four independent conditions:

| Condition | Location |
|---|---|
| mode is `firestore` | `routes.ts:1702` |
| caller has no SQL session | `routes.ts:1706` |
| app-layer authz fails on account/contact | `routes.ts:1729` |
| **JSONB shape validation fails** | `routes.ts:1874`, `routes.ts:1934` |

So the same logical entity can land in either store depending on *who* touched it and *what the payload looked like*. Provisioning identity does not fix this; it moves the boundary. Reads compound it: the browser can read Firestore directly while writing through the API — `createSplitStore` at [`web/domain/store.js:201`](../../web/domain/store.js:201).

### 4.6 Other confirmed items `[CODE]`

- `upsertAppUser`/`upsertOrgUnit` exist at [`postgres-repository.ts:492`](../../worker/src/data/persistence/postgres-repository.ts:492); their only caller in the repo is `worker/scripts/test-postcall-update-idempotency-conflict.ts`. `upsertAppUser` writes **no `user_role` row**, and `resolveSqlSession` derives `is_admin` purely from `user_role` — so a user provisioned at login is silently non-admin. `upsertOrgUnit` takes `path` as a **caller-supplied argument**; nothing computes it.
- `resolveInternalId` throws HTTP 409 on any unmapped FK ([`id-registry.ts:25`](../../worker/src/data/persistence/id-registry.ts:25)). Only `account` and `deal` self-heal (`ensureAccountProvisioned`, `ensureDealRef` in `routes.ts`) — and that auto-creation silently manufactures shadow rows from typo'd ids.
- The SQL write switch has no case for `task`, `scorecard`, or `product_signal`, though `PostgresRepository` implements all three (`upsertScorecard:404`, `upsertProductSignal:455`) — dead code reachable only via the Firestore `UPSERT_COLLECTIONS` path.
- `audit_log` has zero write callers ([`impersonate.ts:12`](../../worker/src/routes/impersonate.ts:12) logs to console only). No `audit_action_enum` value fits "impersonate".
- The `activities` Firestore collection has **no `firestore.rules` entry** — unguarded. Treat as a security finding, not an incidental.
- `notification`, `coaching_focus`, `coaching_reflection`, `coaching_recommendation` are **green-field**, not migrations. Keep them off the critical path. `coaching_reflection` RLS must stay `se_user_id = current_user_id() OR is_admin()` — managers deliberately excluded. Do not loosen.

---

## 5. Tooling added by this plan

Both are **read-only** and already written.

### `worker/scripts/export-firestore.mjs`

The missing producer. `migrate-firestore-to-sql.mjs` consumes an export JSON, but nothing in the repo generated one — the chain was broken. Paginates at 500 docs (a single `.get()` on a large collection risks OOM and a server-side deadline), normalizes Firestore `Timestamp` → `{_seconds}` to match `toTs()`, and folds `authIndex` onto `users` so real Firebase UIDs reach `user_identity` instead of falling back to doc ids.

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
  node worker/scripts/export-firestore.mjs --counts-only
```

**Known limitation:** currently exports the 15 collections relevant to the existing migration path. Phase 1 extends it to all 42.

### `worker/scripts/migration-preflight.mjs`

Predicts what will be lost *before* production is touched, and verifies parity afterward. Replays every mapping decision without a database.

```bash
# predict
node worker/scripts/migration-preflight.mjs --export ./firestore-export.json

# verify after migrating (needs the postgres/janus_owner URL — RLS hides rows from janus_app)
DATABASE_URL=postgresql://postgres:... \
  node worker/scripts/migration-preflight.mjs --export ./e.json --verify

# gate a release
node worker/scripts/migration-preflight.mjs --export ./e.json --strict
```

`[VERIFIED]` Its predictions matched the real run exactly: 4 dropped rows, 3 silent rewrites, 8 documents not reaching Postgres, and the 4 unmigrated collections surfaced with a `-1` delta each.

---

## 6. Required code changes

Ordered by dependency, not by ease.

### C1. Schedule the outbox projector — *prerequisite for everything else*

Add an `outbox` subcommand to `deploy/vps/cron-batch.sh` `resolve_path()` → `/api/internal/outbox/project`, and a `* * * * *` line in `install-crontab.sh`. For Cloud Run, uncomment and extend `cloud-scheduler.example.sh` with `create_job outbox-project '* * * * *' '/api/internal/outbox/project'`. Add alerting on `sync_outbox` pending age and `failed` count (queries already in `docs/CUTOVER_SQL.md`).

**Do not enable `dual` mode anywhere until this is running and observed draining.**

### C2. Make the migration fail loudly instead of losing data

In `migrate-firestore-to-sql.mjs`:

- Replace every bare `continue` (lines 297, 313, 341) with a recorded skip, and print a skip report at the end.
- Change `dealStage()`/`dealStatus()` to collect coercions into a report; add `--allow-coercion` and **refuse to run without it** when any value would be rewritten.
- Refuse to run (or require `--allow-orphan-org`) when a team's `orgId` does not resolve, rather than silently writing a root path.
- Fix the `--dry-run` key map, or delete `--dry-run` and delegate to `migration-preflight.mjs`.
- Fix the counters to count actual inserts.
- Exit non-zero when anything was skipped or coerced.

### C3. Extend the exporter and migration to Groups B, C, D

- **Exporter:** add all 42 collections; assemble Group C into `postCalls[].detail` and Group D into `deals[].tc_detail`, keyed by `callId`/`dealId`, honoring the per-field caps in the spec's `detail` shape table (videoFacts ≤5, timelineSegments ≤200, objections ≤100, momDrafts ≤5, …).
- **Migration:** add insert paths for the 8 Group B tables. `task` needs a **value mapping**, not a rename: Firestore `source` is `"postcall" | "prep" | "manual"`; the target enum is `"ai_generated" | "manual"` — map `postcall`/`prep` → `ai_generated`, and `sourceKey` → `task_key`.
- Validate every assembled JSONB against `validateJsonbShape` **before** insert, so shape drift fails in the migration rather than at request time.

### C4. Identity provisioning at login — with an explicit role contract

Wire `upsertAppUser`/`upsertOrgUnit` into the auth path, but only with all of:

- A `user_role` insert. Default `se`. **Never auto-grant `admin`** — `is_admin` bypasses RLS, so making Firestore's `users.role` string the authority for it is a privilege-escalation path. Admin grants stay a deliberate, audited operation.
- Deterministic `org_unit.path` synthesis matching the backfill's format exactly (`/{orgId}/{teamId}/`), plus the reconciliation job the spec calls for ("org_unit.path: app-maintained + reconciliation job") — which does not exist.
- Run under `withSystemContext`, not the caller's session.
- Call `invalidateSqlSession(authUid)` after any role or status mutation (the 5s cache at `session-context.ts:38` otherwise serves stale authz).

### C5. Wire the dead SQL paths

Add `trySqlDomainWrite` cases for `scorecard`/`scorecard_line`, `product_signal`, and `task`. Low risk, independent of C4 — but requires `rubric` to be seeded first or every scorecard insert fails the FK.

### C6. Deferred

`audit_log` writes (needs a new `audit_action_enum` value for impersonation, and PII hashing per the table's own rule); `notification`; `coaching_*`; `score_override` (blocked on Q6). Integration tables (`integration_token`, `sync_job`, `sync_error`, `sync_conflict`, `webhook_event`) stay untouched — the spec phases them behind Salesforce/ChurnZero.

### C7. Independent bug fixes — separate PR, any time

- `lifecycles/{id}/events` (browser, subcollection) vs top-level `lifecycleEvents` (`routes.ts:1563`) — two write paths, two locations, diverging.
- `clusteringState` (client, singular, `firestore-store.js:2027`) vs `clusteringStates` (server, plural, `routes.ts:1518`).
- `dealSummaries`/`accountSummaries` have no `UPSERT_COLLECTIONS` entry, so the server API cannot write them.
- **`activities` has no `firestore.rules` entry.** Security finding — fix first.

---

## 7. Phased plan with gates

### Phase 0 — Answer the open questions *(human, hours)*

Answer Q1–Q6 in §3. Record the deployed `PERSISTENCE_MODE` per environment:

```bash
gcloud run services describe prep-portal-api --format='value(spec.template.spec.containers[0].env)'
```

**Gate:** Q1 and Q2 answered in writing. If Q1 is "yes", stop and reconcile the existing split before proceeding.

### Phase 1 — Observe production *(1 day)*

Provision a read-only Firestore service account (`roles/datastore.viewer`), get Cloud SQL access, then:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
  node worker/scripts/export-firestore.mjs --counts-only
```

Extend the exporter to all 42 collections (C3, exporter half). Produce a full export and run the preflight.

**Gate:** a committed inventory table of all 42 collections with observed production doc counts and a disposition per §4.1. No estimates.

### Phase 2 — Make the tooling trustworthy *(2–3 days)*

C1 (projector + alerting) and C2 (fail-loud migration). Then re-run preflight against the real export.

**Gate:** projector observed draining a non-empty `sync_outbox` on staging. `migration-preflight.mjs --strict` exits 0 on the real export, or every remaining drop is explicitly accepted and signed off in the PR.

### Phase 3 — Complete the mapping *(1–2 weeks, largest phase)*

C3 in full: Group B tables, Group C→`post_call.detail`, Group D→`deal.tc_detail`, JSONB shape validation. Resolve Q3 (ARR) and Q4 (legacy twins).

**Gate:** run against a **production-data clone**, not the fixture. `--verify` shows zero unexplained deltas across all 42 collections. Spot-check 20 random post-calls field-by-field against Firestore.

### Phase 4 — Staging dual mode *(3–5 days soak)*

Flip staging to `dual`. Apply C4 and C5. Follow `docs/CUTOVER_SQL.md` Stage 1 soak checks.

**Gate:** all `docs/CUTOVER_SQL.md` prerequisite gates pass (`grants_smoke`, `rls_fails_closed`, `view_rls`, partitions, reference data). `sync_outbox` pending stays near zero for 72h. Verify RLS as a real SE, a real manager, and an admin — confirm a manager sees exactly their org subtree and no more. Confirm tables are owned by `janus_owner`, not `postgres`.

### Phase 5 — Production dual, then sql *(1–2 weeks)*

Production → `dual`. Soak. Then `sql` per `CUTOVER_SQL.md` Stage 2. Move browser reads off Firestore (`web/domain/store.js`) **before** retiring the projector — rollback depends on it.

**Gate:** parity harness green for 7 consecutive days in production before flipping to `sql`.

### Phase 6 — Green-field and cleanup

C6, C7, `docs/CUTOVER_SQL.md` post-cutover cleanup.

---

## 8. Anti-patterns — do not do these

1. **Don't cite a row count you didn't query.** State the host you queried.
2. **Don't call any single change "the unlock".** There are at least four independent blockers.
3. **Don't enable `dual` mode before the projector is draining.** It silently stops Firestore writes and voids rollback.
4. **Don't trust HTTP 200.** Confirm with `SELECT` (`SET app.is_admin='true';` first — these tables are RLS-protected). Repo rule: `docs/SQL_AGENT_VERIFICATION.md`.
5. **Don't auto-grant `admin`** in login provisioning.
6. **Don't treat green-field tables as migration work.** `notification`, `coaching_*`, `score_override`, `audit_log` have no Firestore source.
7. **Don't "fix" what works.** Idempotency, org-path synthesis for well-formed data, `user_identity`/`user_role` creation, and reference-data seeding are all correct today (§4.2).
8. **Don't loosen `coaching_reflection` RLS** to include managers. It is a deliberate privacy decision.
9. **Don't let `ensureAccountProvisioned`/`ensureDealRef` stand in for migration.** They manufacture shadow rows from bad ids.

---

## 9. Evidence appendix — how to reproduce

```bash
cd lionpath_V2

# Which database am I actually pointed at? (prints host, never the password)
node -e 'const fs=require("fs");const t=fs.readFileSync("worker/.dev.vars","utf8");
const m=t.match(/^DATABASE_URL=(.*)$/m);const u=new URL(m[1].trim());
console.log("host="+u.hostname+" port="+u.port+" db="+u.pathname.slice(1)+" user="+u.username);'

# Collection inventory
grep -oE "match /[A-Za-z]+/" firestore.rules | sed 's|match /||;s|/||' | sort -u

# Confirm the mode gate precedes the identity gate
sed -n '1695,1710p' worker/src/routes.ts

# Confirm the projector has no scheduled caller
grep -rn "outbox" deploy/vps/cron-batch.sh deploy/vps/install-crontab.sh \
  deploy/cloudrun/cloud-scheduler.example.sh

# Reproduce the migration-defect findings end to end
node worker/scripts/migration-preflight.mjs --export <fixture-or-export>.json
DATABASE_URL=<postgres-url> node worker/scripts/migrate-firestore-to-sql.mjs --export <same>.json
DATABASE_URL=<postgres-url> node worker/scripts/migration-preflight.mjs --export <same>.json --verify
```

---

## 10. Changes from the previous plan

| Previous plan said | Correction |
|---|---|
| Root cause is missing identity provisioning; highest-leverage single fix | The `PERSISTENCE_MODE` gate is checked first (`routes.ts:1701`). Mode was never stated. §4.3 |
| Live Cloud SQL row counts, "14 orphaned `deal_stage_history` rows" | Did not match the only reachable database. Treat as unverified. §2.2 |
| Batch-migrated users lack `user_identity`, so dual mode no-ops | False. The script creates `user_identity` **and** `user_role`. §4.2 |
| `account`/`contact`: "None — already correctly dual-writing" | Dual mode does not write Firestore inline; the projector is unscheduled. §4.4 |
| Scope is roughly 14 entities of write-path wiring | 42 Firestore collections; 31 have no code path; ~12 must fold into JSONB. §4.1 |
| `scorecard` wiring is "the cheapest win in the plan" | Requires `rubric` seeded first or every insert fails the FK. §4.2, C5 |
| Migration is a per-table wiring exercise | Per-user *and* per-payload store routing means the same entity can live in either store. §4.5 |
| (not mentioned) | The export JSON had **no producer**. §5 |
| (not mentioned) | Enum coercion silently corrupts deal stage/status. §4.2 defect 3 |
| (not mentioned) | Broken org parent → root path → silent manager RLS blindness. §4.2 defect 4 |
| `--dry-run` implicitly trustworthy | Reports wrong counts for 3 of 10 entities. §4.2 defect 1 |
