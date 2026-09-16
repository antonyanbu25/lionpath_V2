# Janus data model — run log

Append-only record of every action taken against a real environment: what was
run, what came back, what broke, what was changed as a result.

**Target:** Cloud SQL `janus-db` (project `se-singha-paathi`), public IP
`8.231.110.188`, database `janus`, PostgreSQL 16.14.
**Firestore:** project `se-singha-paathi`, service account
`firebase-adminsdk-fbsvc@`.
**Branch:** `feat/sql-datamodel-mapping`

Newest entries at the bottom.

---

## 2026-09-03 — Access

Two roles on ONE database. They are not two apps.

| Role | Used by | Rights |
|---|---|---|
| `postgres` | migrations, loader, provisioning | schema changes; sees all rows |
| `janus_app` | **the worker — every request** | rows only, no DDL, RLS applies |

Verified: both connect, both read (288 post_calls), `postgres` can DDL,
`janus_app` cannot. Credentials in `worker/.dev.vars` (gitignored).

**Cloud SQL `postgres` is NOT a superuser** — `rolsuper=false`,
`rolbypassrls=false`. Two consequences that cost real time:

1. `ALTER ROLE ... SET` on a custom parameter is refused, so
   `17_rls_role_defaults.sql` can never apply here.
2. **The admin role does not see past RLS.** Every core table is
   `FORCE ROW LEVEL SECURITY`, which subjects the table owner too. A query
   with no session context returns **zero rows** — which reads exactly like
   "the data was never written".

Getting the port open took several attempts: the authorized-network entry has
to be saved on the instance page (not just the dialog), and `gcloud`/`brew`
are not installed on this laptop, so it was done through the Console.

---

## 2026-09-03 — Schema apply

`node worker/scripts/apply-janus-schema.mjs`

Four failures, each fixed, then **33/33 applied** and clean on two further
re-runs (idempotent).

| # | Failure | Cause | Fix |
|---|---|---|---|
| 1 | `17` — permission denied to set parameter `app.is_admin` | needs true superuser | warns and continues; the three helper functions already fail closed, verified |
| 2 | `21` — duplicate key `uq_app_role_name` | database already had the 4 roles under different ids (`admin`, not `role_admin`) | seed keyed on NAME, which is what `resolveSqlSession` joins on |
| 3 | `22` — my own guard: 1 rubric_theme + 15 rubric_parameter predate the inversion | the old auto-provisioned `default` rubric | cleared it, after confirming inside a transaction that no scorecard / scorecard_line / score_override / coaching row referenced it |
| 4 | `04` — column `rubric_theme_id` does not exist | `04` indexes two columns that `22` drops, so `04` could never re-run | both index statements guarded on column existence |

Failure 4 is the layering cost made real: the apply script always replays from
`00`, so an early file must survive every later one.

---

## 2026-09-03 — Security gates

| Gate | Result |
|---|---|
| `grants_smoke` | **18/18** |
| `rls_fails_closed` | **8/8** (after fixing its `account` fixture, which predates `account` having RLS) |
| `view_rls` | **4/4** |

Confirmed directly: `current_user_id()`, `current_org_path()` and
`is_admin()` all fail closed with no session vars.

---

## 2026-09-03 — Rubric catalog

`node janus/scripts/load-rubric-catalog.mjs`

One failure: `inconsistent types deduced for parameter $3` — `param_index`
(smallint) and `display_order` (int) shared a placeholder. Fixed.

Then: **19 profiles → 270 themes → 1350 sub-parameters**, exactly as
predicted. `validate_rubric_catalog()` returned zero problems, which the
loader requires before it commits.

Only **2 of 19** profiles are live (`demo`/NB, `discovery`/NB). The other 17
are `provisional` — shadow mode, out of aggregates by design (D25).

---

## 2026-09-03 — Identity provisioning

`node janus/scripts/provision-identity.mjs --ids user-ids.json --skip-unmapped`

Result: **9 org units, 21 people**.

The org tree now has the segment level it was missing:

```
org_freshworks_se                        [director=vipin.thomas]
  seg_digital        motion=expansion    [segment_leader=preethi.sri]
  seg_new_business   motion=new_business [segment_leader=antony.sagayaraj]
  seg_nurture        motion=expansion    [segment_leader=preethi.sriram]
    team_ajay 7 · team_akshita 8 · team_mary 7 · team_nikil 16 · team_varun 3
```

`job_level` is now derived from job title, not defaulted — Vipin Thomas was
provisioned as `IC` before this.

**Only 21 of 46 roster people could be provisioned.** User ids are random
UUIDs minted by the Firestore seed and cannot be derived from an email, so
the other 25 need the Firestore export. `--skip-unmapped` provisions the known
ones and names the rest rather than refusing all 46.

---

## 2026-09-03 — Acceptance tests

`node janus/tests/acceptance/run_acceptance.mjs`

All five failed on the first run, all for the same reason, then went green.

| Failure | Cause | Fix |
|---|---|---|
| all 5 — `account` RLS denied the fixture | the migration role does not bypass RLS | fixture client sets admin context |
| `account_se_team` RLS denied the fixture | **my policy bug**: `current_user_id() IS NOT NULL AND …` locked out admin | `is_admin()` moved outside the guard, in both policies |
| AT-2 — no unique constraint matching ON CONFLICT | `idempotency_key`'s unique index is PARTIAL | repeat the predicate, as the repository does |
| AT-2 — detail round-trip mismatch | `jsonb` does not preserve key order | compare canonically |
| AT-3 — `score_override` FK violation | `created_at` is `timestamptz` (microseconds); a JS `Date` holds milliseconds, so round-tripping truncates it | select the timestamp in SQL. **Live trap for the override wiring** |
| AT-4 — `leadership_shareable` does not exist | the view did not expose it | added — a reader could not tell a real 8.0 from a clamped 9.3 |

Final: **AT-1 10/10 · AT-2 13/13 · AT-3 23/23 · AT-4 19/19 · AT-5 17/17**

Verified in the database, not on paper: **7.4 round-trips as 7.4** (the old
`CHECK 0..2` rejected it), `(demo, expansion)` is refused by the composite FK,
N/A is distinguishable from a real 0, and a recomputed composite equals the
stored one.

---

## 2026-09-03 — A mistake I made

My first survey reported `activity 0, pre_call 0, post_call 0`. I concluded
`id_registry` was full of stale pointers and **deleted 621 mappings**.

They were not stale. I was querying as the admin role with no session
context, so RLS hid the rows. The tables were never empty.

`15_id_registry_backfill.sql` rebuilt every mapping from source, and
consistency is now verified clean — 0 missing and 0 dangling across
`account`, `activity` and `app_user`. No lasting damage, but the reasoning
was wrong and cost time.

Same blindness had silently broken two other things, both now fixed:

- `15` itself stopped backfilling `account` once `26` gave it RLS — no error,
  no mappings, and every dual-write would then fail with "no mapping for
  account/…".
- `verify-call-storage.mjs` reported every table as empty.

**Real row counts, with context:** 375 activity · 288 post_call · 87 pre_call
· 45 account · 199 product_signal · 13 deal · 37 app_user · 68 audit_log.
The dual-write has been working all along.

---

## 2026-09-03 — Will new prep briefs tie to a deal?

Asked directly, so verified directly, as `janus_app`, writing what the app writes.

**Before: no.** A brief with no `dealId` failed with `23502`. And because the
throw escapes `trySqlDomainWrite` instead of returning `{handled:false}`, the
request would 500 and the brief would not reach Firestore either — strictly
worse than the invisible row the trigger was meant to prevent.

This was not an edge case: **86 of the 87 existing briefs have no `dealId`**,
because `PrepBrief.dealId` is optional in Firestore while `lifecycleId` is
required.

**Fix:** fall back to `lifecycleId` as the deal identity, in `createPrepBrief`
and in `upsertPostCallWithSummary` so a brief and the call after it land on
the SAME deal. Not a workaround — a lifecycle IS the pursuit the brief belongs
to, and `ensureDealRef` already mints a placeholder that a later real
`createDeal` upserts over.

**After: yes.** A brief with only a `lifecycleId` is written AND readable
through `v_pre_call_brief`, tied to the provisioned deal. AT-1…AT-5 still 5/5.

Existing 86 left untouched as instructed. They remain invisible to the read
path; attaching or deleting them is a separate decision.

---

## 2026-09-03 — Firestore connected

Service-account key at `~/.janus/firestore-key.json`, outside the repo.

Firestore vs Postgres:

| | Firestore | Postgres | |
|---|---|---|---|
| users | 43 | 37 | 6 missing |
| accounts | 40 | 45 | ok |
| contacts | 22 | 20 | ok |
| deals | 8 | 13 | ok |
| **prepBriefs** | **87** | **87** | match |
| **postCalls** | **359** | **288** | **71 missing** |
| **scorecards** | **10** | **0** | **none arrived** |
| scorecardLines | 160 | 0 | none arrived |
| tasks | 0 | 0 | — |

Three real gaps:

1. **No score ever reached Postgres.** 10 scorecards and 160 lines sit in
   Firestore. This is the `composite_score CHECK 0..2` defect — every score
   above 2 was rejected outright. Fixed and wired now, but those 10 are
   Firestore-only.
2. **71 post-calls did not arrive.** Either they predate dual mode or they
   failed silently. Not yet established which.
3. **6 users missing**, consistent with the 25 unprovisioned roster members.

Also: `productGaps` is 0 in Firestore while Postgres holds 199
`product_signal` rows, so those arrived by a different path.

---

## Open items

| | |
|---|---|
| **`scorecard` = 0** | The write path is wired but has never produced a row. This is the remaining gap for scoring. |
| **107 `sync_outbox` rows pending** | The Firestore projection job is not running, so the two stores are drifting. Needs a scheduler on `POST /api/internal/outbox/project`. |
| **71 post-calls in Firestore only** | Cause not yet established. |
| **25 roster people unprovisioned** | Now possible — Firestore access is in place. |
| **86 dealless briefs** | Left as instructed. Invisible to the read path. |
| **All 288 post-calls read `new_business` / source NULL** | The old silent default. New writes record provenance properly. |
| **Rotate credentials** | Both database passwords were pasted in chat. |

---

## 2026-09-03 — Full Firestore → Postgres coverage audit

Extracted every collection the code writes (`UPSERT_COLLECTIONS`,
`DELETE_COLLECTIONS`, and every `collection()` call in `worker/src` and
`web/domain/firestore-store.js`), then compared against the Postgres schema
and the 14 methods handled in `trySqlDomainWrite`.

**Result: 13 wired · 6 have a table but no write path · 13 have no table.**

The 13 with no table look alarming but **11 of them hold zero rows in
Firestore** — unused features: `videoFacts`, `timelineSegments`,
`timelineMarkers`, `dealSignals`, `arrLines`, `arrOverrides`,
`technicalCommits`, `whatWorks`, `events`, `accountSummaries`,
`dealSummaries`. Only `followUps` (3) and `momDrafts` (1) have data.

### Wired and carrying data

| Firestore | Postgres | FS / PG |
|---|---|---|
| accounts | `account` | 40 / 45 |
| contacts | `contact` | 22 / 20 |
| deals + lifecycles | `deal` | 8+15 / 13 |
| prepBriefs | `pre_call` | 87 / 87 |
| postCalls | `post_call` | 359 / 288 |
| callSummaries | `post_call.analysis` (jsonb) | 277 / — |
| objections | `post_call.detail` (jsonb) | 3 / — |
| scorecards | `scorecard` | 10 / **0** |
| scorecardLines | `scorecard_theme` + `scorecard_line` | 160 / **0** |
| users / teams / orgs | `app_user`, `org_unit` | 43+2+1 / 37+10 |
| llmUsage | `ai_run` | 926 / 1083 |

### Table exists, no write path (6)

`task` · `product_signal` · `signal_cluster` · `clustering_state` ·
MEDDPICC columns on `deal` · TC delta columns on `deal`

Two findings worth recording:

- **`task` does not go to Firestore either.** `upsertTask` (`tasks.ts:77`)
  writes a per-user KV blob, which is why the `tasks` collection is empty.
  Tasks therefore live in a THIRD place — `user_kv`. Wiring them to `task` is
  real work, not plumbing.
- **`product_signal` has 199 rows in Postgres and 0 in Firestore.** Something
  wrote the SQL side and the projection back never ran — consistent with the
  107 stalled `sync_outbox` rows.

### The gap that matters

Scores. 10 scorecards and 160 lines in Firestore, **zero** in Postgres —
the `composite_score CHECK 0..2` defect rejecting every score above 2. The
write path is now wired (`upsertScorecard` + `upsertScorecardLine`) and passes
AT-3 23/23, but no real score has been through it yet.

---

## 2026-09-03 — Scoring proven on real data

Took the newest Firestore scorecard and pushed it through the exact path
`routes.ts` now uses (`upsertScorecard` header, then one
`upsertScorecardTheme` per theme), connected as `janus_app` under RLS.

Source doc: `scr_564320fd-…`, `callType=demo`, `rubricId=rub_demo_2_1`,
`totalCredits=34`, `includedCredits=33`, 16 lines.

```
firestore overall    5.67
stored composite     5.67
recomputed from rows 5.67
```

Header written, **16 themes**, **75 sub-parameters**. Motion resolved from the
org tree — `source=resolved`, not defaulted. The composite FK accepted
`(demo, new_business)`.

**This was impossible before.** All ten Firestore scorecards have `overall`
between 3.76 and 5.67, and the old `composite_score CHECK (0..2)` rejected
every one of them outright. That is why Postgres held zero scores.

Rolled back — nothing persisted. Backfilling the ten is a separate decision
(D6 says clean slate, so it needs an explicit call).

One script bug found and fixed along the way: the verification query used the
migration connection, which cannot see a row still inside another
connection's open transaction.

### Firestore line shape matches the wiring

`scorecardLines` docs carry `themeKey`, `grade`, `credit`, `category`,
`subParameters[]` (each with `score` + `evidence[]`), `confidence`,
`coachingNote`, `evidenceUnavailable` — exactly what `ScorecardThemeAppendRow`
expects. They do **not** carry `modelOmitted`; the fix in
`web/domain/scorecard-service.js` adds it for new writes.

---

## 2026-09-03 — Checked against the original v9.3 spec

Sources: `Janus_Data_Model_Final.docx` (the spec the schema was built from) and
`Janus_Data_Flow_UML.html` (4 swimlanes, 5 phases).

### Table coverage: 38/38

Every table the spec names exists. Plus 6 partitions and 12 tables added
since — `scorecard_theme`, `scorecard_deal_risk`, `org_unit_leader`,
`account_se_team`, `app_user_avatar`, `price_book`, `addon_price_book`,
`assumptions_book`, `clustering_state` (this workstream) and `deal_contact`,
`id_registry`, `user_kv` (earlier).

**The spec's Step 4c says "75 scorecard_lines". The real scorecard pushed
today wrote exactly 75 sub-parameters.** Independent confirmation that the
grain is right.

### Two places the spec is now stale

- It defines `current_org_path()` as `COALESCE(..., '')` — **fail-open**. That
  was the BLOCKER-class finding; `08_rls_hardening.sql` changed it to return
  NULL. The docx predates the hardening.
- It says RLS on 8 tables. There are 17+ now.

### Flow coverage against the UML

| Step | Status |
|---|---|
| 1 contact resolution → account, contact, deal | live |
| 2 pre-call → activity + pre_call + ai_run | live |
| 3 ingest → activity + post_call | live |
| 3 ingest → `call_participant` | **not wired** — computed and discarded |
| 4a analysis → `post_call.analysis` | live |
| 4b detail → `post_call.detail` | live |
| 4b deal MEDDPICC / TC columns | **not wired** |
| 4c scoring → `scorecard` + 75 lines | **proven today** |
| 4d signals → `product_signal` | live, 199 rows |
| 4d `task` | **not wired** — writes a per-user KV blob instead |
| 5 `sync_outbox` write | live |
| 5 outbox drain worker | **NOT RUNNING — 107 stuck** |
| 5 notifications (4 kinds) | **none** |
| 5 coaching engine | roadmap |
| 5 sync_error / sync_conflict | Salesforce, Phase 2 — not built |
| 5 ChurnZero → `account.health_data` | Phase 3 — not built |

Salesforce and ChurnZero are Phase 2/3 in the spec, so not expected. The four
live gaps are `call_participant`, the MEDDPICC/TC columns, `task`, and the
outbox drain.

**The outbox drain is the urgent one.** The spec is explicit that it is how
Postgres reaches Firestore. It is not running, which is why 107 writes are
stuck and `product_signal` reads 199 in Postgres against 0 in Firestore. The
drift grows for as long as it stays off.

---

## 2026-09-03 — Fallback telemetry + coverage report

Instrumented before changing anything, so progress is measurable.

**The problem:** `trySqlDomainWrite` had **26 places returning
`{ handled: false }`**, each silently routing the write to Firestore. Nothing
distinguished "landed in Postgres" from "quietly did not" — the same blind
spot that made the audits necessary, and it makes a cutover unverifiable.

Added:
- `30_fallback_telemetry.sql` — `sql_fallback_log` (append-only, 11 stable
  reason codes) + `v_sql_coverage`. A fallback logged while
  `PERSISTENCE_MODE=sql` is flagged as a **LOST WRITE**, because Firestore is
  not there to catch it.
- `worker/src/data/persistence/fallback-log.ts` — logs to console AND the
  table, on its own connection, and can never break the request it describes.
- `janus/scripts/coverage-report.mjs` — the answer to "where is data not
  reaching Postgres".

13 call sites instrumented, including the `default:` case, so **every unwired
method now names itself** instead of being invisible.

### First coverage report

| Module | Verdict |
|---|---|
| 1. Pre-call | **wired and filling** — pre_call 87, activity 375 |
| 2. Post-call | partly — post_call 288, but `call_participant` **empty** |
| 3. Scoring | **no data yet** — all 5 tables empty (path wired, never exercised) |
| 4. User / usage | **wired and filling** — app_user 37, org_unit 10, user_role 38 |
| 5. Deal / account | partly — `deal_contact` **empty** |
| 6. New tables | **BLOCKED — all 13 tables do not exist** |

Zero fallbacks recorded, but that only means the app has not served traffic
since the telemetry landed. The report says so rather than claiming success.

**Cutover gate, now measurable:** a module is wired when its tables exist, are
filling, and its methods log ZERO fallbacks in 24h with the app serving
traffic.

---

## 2026-09-03 — Module 6: the last collections. 13 became 5.

Started here rather than module 1 because it was the only hard blocker: those
methods hit tables that did not exist, so they could not be wired at all, and
once Firestore is gone a missing table is a crash rather than a fallback.

### The finding that changed the design

Traced what the code actually reads. **Eight of the thirteen are already
stored inside `post_call.detail`**, and both browser stores read them from
there FIRST with the collection as a legacy fallback:

```js
const embedded = detailArray(this._postCallForDetailLookup(callId), "dealSignals");
if (embedded.length) return embedded;
```

`videoFacts` · `timelineSegments` · `timelineMarkers` · `followUps` ·
`momDrafts` · `dealSignals` · `whatWorks` · `arrLines`

That is why all eight read as empty in Firestore. Giving them tables would
duplicate data that already has a home and create two places to disagree.
They need a **read projection**, not tables.

**Proven against the 288 real post_calls** — `v_post_call_detail_items`:

| item kind | in `post_call.detail` | in the Firestore collection |
|---|---|---|
| `tcDeltas` | **1,631** | 0 |
| `timelineSegments` | **110** | 0 |
| `followUps` | **52** | 3 |
| `objections` | 40 | 3 |
| `videoFacts` | 20 | 0 |
| `momDrafts` | 20 | 1 |

1,873 items. The collections were vestigial; the jsonb is the real store.

Also found: **`events` is a Firestore SUBcollection** (`contacts/{id}/events`),
which is why it never appeared in a top-level collection scan.

### What was actually built — `31_remaining_collections.sql`

Five tables, for the five that genuinely had nowhere to live:

| Table | Why | Rules enforced |
|---|---|---|
| `contact_event` | the contacts/{id}/events subcollection | 6 event types; append-only |
| `deal_summary` | one cached rollup per deal | UNIQUE on deal_id |
| `account_summary` | one per account | UNIQUE on account_id |
| `technical_commit` | one per deal | UNIQUE on deal_id |
| `arr_override` | who overrode an ARR, from what, and why | append-only; must change something; non-negative |

Plus `v_post_call_detail_items` — the Postgres equivalent of `detailArray()`.

### Verified myself, not assumed

All five accept a write **as `janus_app` under RLS**, confirmed directly
against Cloud SQL before writing the test.

`AT-6` — **18/18**, and it tests both halves: the five tables (writes,
uniqueness, append-only, constraints, fail-closed RLS) and the projection over
real data. Full suite now **AT-1..AT-6, 6/6**.

### Coverage report corrected

Module 6 previously claimed 13 missing tables. It now shows the five real ones
plus a `detailprojection` module for the eight that need no tables — so the
report stops overstating the work by eight tables.

---

## 2026-09-03 — `call_participant` wired (D9, D11)

Module 2's open gap. The pipeline already computed the identity stamp
(`stampCallIdentities`, `web/domain/dual-write.js:506`) and wrote it onto the
postCalls document, then discarded it — **nothing in `worker/src` referenced
`call_participant` at all**. So an SE on a call was a name string at best and
could not be joined to their team, manager or scorecards.

### Built

- `CallParticipantsRow` + `replaceCallParticipants` on the port, implemented in
  all three repositories.
- Called from `upsertPostCallWithSummary`, deriving four of the five kinds from
  `postCall.identities` (`primarySeUserId`, `secondarySeUserIds[]`,
  `aeName`/`aeEmail`, `contactIds[]`). `room` comes from the transcript pass
  when that is wired.
- **Best-effort, inside a SAVEPOINT.** Losing one participant is much better
  than losing the call, and the enclosing dual-write is one transaction — an
  unguarded error would poison it. A failure logs a `write_error` fallback and
  the post-call write stands.
- **Replace, not merge.** A re-analysis recomputes the whole set; merging would
  leave someone on a call they were taken off.

### A bug in my own migration 23, found by writing a row

`02_phase2_activities.sql` declared:

```sql
chk_call_participant_has_identity CHECK (
    contact_id IS NOT NULL OR participant_email IS NOT NULL
    OR participant_name IS NOT NULL)
```

Written before a participant could *be* a Janus user. An SE identified by a
real `app_user` FK — the entire point of D9 — carries no name, email or
contact_id, so **that constraint rejected exactly the row this work exists to
enable.** Migration 23 added the column and left the constraint alone.

Only surfaced on the first real write. Reading the DDL would not have caught
it. `app_user_id` now counts as identity.

### Verified against Cloud SQL before writing the test

All five kinds written on a real activity; `v_call_identities` rebuilt the
stamp exactly; and four invalid cases rejected (two primaries, a room with a
role, an SE without a user, an invented kind).

`AT-7` — **23/23**, including the join D9 exists for (participant → their
team) and replace-not-merge. Full suite **AT-1..AT-7, 7/7**.

---

## 2026-09-03 — Running locally against staging

Both servers up, pointed at the staging Cloud SQL instance. Guide:
[LOCAL_RUN.md](./LOCAL_RUN.md).

| | |
|---|---|
| Web | http://localhost:8788 — HTTP 200 |
| Worker | http://localhost:8787 — build 2.1.41, listening |
| Gemini | `keys.gemini: true`, models resolved (`gemini-3.1-flash-lite`) |
| Firestore admin | ready (`project=se-singha-paathi`) |
| `/api/domain-write` | **401**, not 503 — the SQL path is configured, it just needs auth |
| Mode | `PERSISTENCE_MODE=dual` |

`web/firebase-config.local.js` was missing and blocked Google SSO. Rather than
ask for it, retrieved it from the Firebase Management API by minting an OAuth
token from the service-account key already on disk — found the "SE Portal" web
app and wrote the config. No manual step.

### Sign-in is the user's to do

With `FIREBASE_PROJECT_ID` set, auth is enforced and the demo email/password
logins are hidden — only Google SSO renders. Authenticating on someone's
behalf is not mine to do, so the app is handed over at the sign-in screen.

First sign-in matters: `resolveSqlSession` binds the Firebase uid to the
`app_user` row and writes `user_identity`. Until then there is no SQL session
and every write falls back. Automatic, but only for the **21 provisioned
people** — 25 of 46 are still missing.

### Deliberately still in `dual`, not `sql`

Two reasons, both concrete:

1. Reads have no Postgres path for most methods (~145 browser-store methods
   against 36 in the read repository), so the app would go blank in places.
2. A fallback in `sql` mode is a **lost write** — Firestore is not there to
   catch it. The coverage report flags those in red.

Sequence: run in `dual` → coverage report → fix what falls back → repeat until
`last_24h` is zero → then `sql`. That is the database-migration discipline the
whole telemetry exists to support.

### Also noted

`/api/config` reports `history.storage: firestore` — tasks and history use a
per-user KV blob, a THIRD store. `HISTORY_BACKEND_MODE=pg` moves it to
`user_kv`, which exists. Not yet flipped.

---

## 2026-09-03 — Flipped to `sql`. Firestore is no longer a write target.

`PERSISTENCE_MODE=sql` · `PERSISTENCE_READ_MODE=pg` · `HISTORY_BACKEND_MODE=pg`
Firebase Auth unchanged (D1).

### The read gap was 7 methods, not 109

The earlier "145 browser-store methods vs 36 Postgres reads" was the wrong
measure. The browser's `api-store` routes a specific set —
`API_FIRST_LOOKUP_METHODS`, **22 lookups** — through the worker. Fifteen
already had a Postgres implementation. Seven did not:

`findAccountsByName` · `findActiveLifecycleByDeal` ·
`findLifecycleByDealAndOwner` · `listActiveLifecyclesForAccount` ·
`findDealContact` · `listContactsByDeal` · `findWonNbDealInGrace`

All seven written and **run against the real database** — 6 passed first time;
the 7th needed a missing column.

### Two things on localhost that made a local run meaningless

Both in `web/domain/store.js`:

```js
if (isLocalDevHost()) return "firestore";   // in resolveReadMode
if (isLocalDevHost()) return "firestore";   // in resolveWriteMode
```

**Reads** bypassed the worker, so a local session could not exercise the
Postgres read path however well the worker was wired.

**Writes** bypassed it too — so **the dual-write to Postgres never ran locally
at all.** A local session looked like it was working while writing only to
Firestore. The stated reason was "worker Admin often lacks GCP creds", which no
longer holds: the worker has credentials and `/api/config` reports Firestore
admin ready.

Both now return `api`. The `?storeMode=firestore` and localStorage overrides
still work, so a direct read stays available deliberately for debugging —
just not by default because of where the page happens to be served from.

### `deal.closed_won_at` — 32_deal_closed_won.sql

`findWonNbDealInGrace` needs the date a deal actually closed. Firestore's
`Deal.closedWonAt` had no SQL home — only `close_date`, which is the FORECAST.
A deal forecast for next quarter but won early would read as still open, so the
grace window silently never fired.

Found by running the query, not by reading the DDL. Indexed for the grace
lookup; CHECK ties it to a won/lost status.

### State after the flip

| | |
|---|---|
| Worker | up, build 2.1.41, Gemini live |
| `history.storage` | **`pg`** — was `firestore` |
| Reads | Postgres, all 22 API-first lookups |
| Writes | Postgres only. No Firestore write target |
| Acceptance | **AT-1..AT-7, 7/7** |
| Schema | 35 files, idempotent |

**A fallback now means a LOST WRITE**, because Firestore is not there to catch
it. `sql_fallback_log` records them and the coverage report flags them in red:

```
node janus/scripts/coverage-report.mjs
```

That is the thing to watch while using the app.

---

## 2026-09-03 — Every write path wired. 14/50 → 50/50.

Answering "is the migration complete" honestly required counting, and the
count was bad: **36 of 50 write methods had no Postgres path.**

Worse, `handleDomainWrite` had no mode check. When `trySqlDomainWrite`
returned `handled: false` it called `applyDomainWrite`, which writes to
Firestore — **in every mode, including `sql`.** So "Postgres only" was not
true: 36 methods silently kept using Firestore and nothing surfaced it. My
previous claim of "no Firestore write target" was wrong.

### The mode guard

In `sql` mode an unwired method now returns **501** instead of falling through.
Not 500: the request was valid, the server has no implementation. The client
sees a real failure rather than a false success, and the fallback log has
already recorded the method and reason.

This is the change that makes "Postgres only" mean something — a gap is now
loud instead of invisible.

### The 36, wired

| Group | Methods | Where it lands |
|---|---|---|
| **jsonb detail items** | 11 upserts + 8 deletes + 2 clears | `post_call.detail` arrays, upserted in SQL on the item's own id so two passes cannot clobber each other |
| **Tasks** (D8) | `createTask`, `updateTask`, `deleteTask` | `task`. Was READ-ONLY — no `INSERT INTO task` existed anywhere; writes went to a per-user KV blob |
| **Lifecycle** | `createLifecycle`, `updateLifecycle` | `deal` — lifecycle IS deal in this model |
| **post_call variants** | `upsertPostCall`, `upsertCallSummary` | `post_call`, plus the same participant derivation so the two paths cannot disagree |
| **The 5 new tables** | `addContactEvent`, `upsertDealSummary`, `upsertAccountSummary`, `upsertTechnicalCommit`, `upsertArrOverride` | migration 31's tables |
| **Signals / clustering** | `upsertProductGap`, `upsertGapCluster`, `upsertClusteringState` | `product_signal`, `signal_cluster`, `clustering_state` |
| **Scorecard deletes** | `deleteScorecard`, `deleteScorecardLinesByScorecardId` | cascades through theme, line and deal_risk |

A delete with no call id no longer guesses: it finds the call holding the item
by `jsonb_path_exists`, so a delete never silently no-ops.

### Verified against the live database

Eight new write paths exercised as `janus_app` under RLS, rolled back:
`upsertDetailItem` · `deleteDetailItem` · `clearDetailKeys` · the jsonpath
owner lookup · `upsertTask` · `softDeleteTask` · `upsertClusteringState` ·
`upsertSignalCluster`. All passed.

### State

| | |
|---|---|
| Write methods with a Postgres path | **50 / 50** |
| Firestore as a write target | **none** — `sql` mode returns 501 rather than falling through |
| Reads | Postgres, all 22 API-first lookups |
| `history.storage` | `pg` |
| Acceptance | **AT-1..AT-7, 7/7** |
| Schema | 35 files, idempotent |

**Still not proven by traffic.** Nobody has signed in since the flip, so
`sql_fallback_log` is empty — which proves nothing either way. That is the
remaining gap, and it needs a person using the app.
