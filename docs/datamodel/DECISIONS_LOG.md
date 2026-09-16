# Janus — Decisions Log

> **Repo note (added when this document was landed in the repo).**
> This is the authoritative decisions record, reproduced unchanged. It was written against a
> loose copy of the tree with no `.git`; it now lives on branch
> `feat/qip-human-calibration-discovery-na`. Two claims in D14's preamble are stale — the branch
> **is** the working tree now, so `19_se_motion.sql`, `scorecard-calibrate.ts`,
> `discovery-incident-applicability.ts` and `golden-set/` are all present. Every correction is
> tracked in [BUILD_PLAN.md §2](./BUILD_PLAN.md#2-corrections-to-the-source-audits); the
> decisions themselves stand as written.

**Date:** 2026-09-03 · **Decided by:** Ajay Raghavan
**Status:** authoritative. Where this contradicts `janus_clean_slate_plan.md`, this document wins.

Scope, standing: **this is a data-modelling exercise.** The model must support the functionality
as already coded. Functionality is not being reopened, and no feature is being dropped.

---

## D1 — SQL holds user information; Firebase does authentication only

**Decided:** user information (name, role, team, org structure) lives in Postgres.
Firebase Authentication is retained, unchanged, for identity verification only.

**Why this is the record and not the earlier advice.** An earlier recommendation had Firestore
remaining the master with SQL mirroring on login. That recommendation was withdrawn: it was
argued on an unquantified "much less work" basis, and it contradicted the stated principle that
data storage moves to the new model. The decision was re-taken against counted facts.

**The counted facts.**

| Surface | Size |
|---|---|
| Permission lookup — `resolveRequestContext`, `worker/src/data/scope.ts:63` | 1 function, **6 call sites**, reads 3 Firestore collections per request, returns 7 fields |
| Admin screen — `worker/src/org-structure.ts` | **199 lines**; 4 reads, 3 writes |
| Browser store methods touching identity | **9** (`getUser`, `upsertUser`, `getUserByEmail`, `getUserIdByAuthUid`, `getTeam`, `getOrg`, `listTeamsByOrg`, `listUsersByManagerId`, `listUsersByOrg`) |
| Browser files consuming them | **10** — and **none change**, because they call the store interface, not Firestore |
| Already present in SQL | `app_user`, `user_identity` (= `authIndex`), `user_role` (temporal, with history), `app_role`, `org_unit` (hierarchy with materialised paths) |

**What must be added — four relationships:**

| Missing | Kind |
|---|---|
| `User.managerId` | person → person (reporting line) |
| `Team.managerId` | unit → person |
| `Org.directorId` | unit → person |
| `Org.seniorLeaderIds[]` | unit → persons |
| `Segment.leaderId` | unit → person |

Four of those five are the same shape, so: one `org_unit_leader(org_unit_id, user_id, leader_kind)`
table, plus `app_user.manager_user_id` for the reporting line.

**Correction on sizing:** this was earlier called "probably the single largest piece of work in
the project." On counting, it is not — it is 4 schema additions, 2 file rewrites, and 9
mechanical endpoint/method pairs. **The scoring reshape (D3) is larger.**

---

## D2 — One organisation now; the model stays multi-org capable

**Decided:** operate as a single org. Do not build org-scoped scoring or per-org admin scoping.
Keep the data model capable of multiple orgs, which it already is.

**Facts behind it.** The system is single-org in practice: `org_freshworks_se` is hardcoded in
three places (`web/domain/constants.js:3`, `worker/src/org-structure.ts:77`, `:156`), the admin
screen takes its org from an environment variable rather than the request, nothing enumerates
orgs, and scoring has no org dimension at all (`rubric-profiles.ts` and `quality-score.ts`
contain no `orgId`). The *data* is properly isolated — every row carries an org unit and RLS
matches on hierarchy path.

**Two things that would not work if a second function (FDC, CSM, Sales) were onboarded**, both
deliberately deferred: scoring profiles are global, so a CSM call would be scored against
SE call types; and admins bypass the org check entirely, so an SE admin can read another org.

**Consequences accepted:** no new hardcoded org defaults; when the scoring tables are reshaped,
the profile key is positioned so an org dimension can be added later without a second rewrite.

---

## D3 — Scoring must work on day one

**Decided:** post-call analysis must be able to save a quality score at launch.

**Ordering correction.** This was offered as though scoring could be sequenced ahead of the
identity work. It cannot. `scorecard.org_unit_id` is `NOT NULL`, the write policy is keyed on
`current_user_id()`, and a scorecard hangs off an `activity` that needs an owner and an account.
**Identity is a hard prerequisite.** The chain is fixed:

```
schema + reference seed  →  identity in SQL  →  scoring reshape  →  post-call works
```

`scorecard.rubric_id` is also `NOT NULL` and references `rubric`, so the 8 call-type profiles
must exist as real rows before any score can save. That is part of the reshape, not separate.

**Why the reshape is unavoidable** (detail in `janus_entity_mapping_audit.md` §5.10): the
scoring tables do not model the coded scoring domain. The blocking item is a scale mismatch —
the code's overall score ranges 0–10 (a theme grade is the sum of five 0–2 sub-scores; the
leadership cap sits at 8.0) while `composite_score` is constrained `BETWEEN 0 AND 2`, so the
insert is **rejected outright**. Beyond that: no call-type dimension, no sub-parameter level,
no way to record "not applicable — no video," no `provisional` flag while the dashboards
average scores unconditionally, and of 17 fields the scorer produces, 13 have no column.

---

## D4 — Three org levels: org → segment → team → user

**Decided:** keep the current three-level hierarchy. No geography level. `squad` stays unused
and genuinely available.

**The real hierarchy, from `worker/scripts/seed-users.example.csv`:**

```
org_freshworks_se  = "Freshworks CX Solution Engineering"      ← the SE function
  └── seg_new_business / seg_digital / seg_nurture             ← motions
        └── team_ajay / team_nikil / team_mary / team_varun    ← a manager's group
              └── SEs
```

**Vocabulary trap — worth putting in front of anyone who builds this.** Business users call
level 2 a *team* (New Business) and level 3 a *segment* (International/NA). The system is the
other way round: level 2 is the **segment** and level 3 is the **team**, named after its
manager. Modelling the SQL rows with the business vocabulary inverts every `parent_id` and
therefore every hierarchy path — and since all row-level security is a path prefix match, a
segment leader would silently see the wrong people. **Keep the system's names in the model.**

Note also that segments live as an **array inside the org document**, not as their own
collection, which is why they never appeared in the 46-collection inventory. They become
`org_unit` rows with `unit_type='region'` — a level the schema already anticipated.

A team records `orgId`, not its segment; the segment→team link lives on the segment
(`segments[].teamIds`). So setting a team's `parent_id` is a lookup, not a field copy.

---

## D5 — Live daily use

**Established:** the SE team uses Janus daily (~14 people on the seed roster).

**Consequence:** nothing ships broken. Every gap in the audit must be closed before cutover,
not after.

---

## D6 — Clean start; users lose in-app history at cutover

**Explicitly confirmed, after being stated plainly.** Postgres starts empty. On cutover morning
every SE sees no past calls, no past deals, no past accounts or contacts, an empty dashboard,
no quality scores and no prep briefs. Data rebuilds as people work; nothing prior is visible
in the app. The one-time cold archive is not readable in-app.

**Accepted. Not to be re-raised.** The rejected alternative was leaving old Firestore records
readable in-app read-only, which would have cost some of the simplicity the clean slate buys.

---

## Settled earlier

| Decision | Note |
|---|---|
| SEs can edit their own accounts | Not a policy choice — the code already intends it. The manager-only restriction is a workaround because `account.seTeam` (up to 4 SE members) has **no SQL column**. Needs a junction table. |
| Pricing data moves to SQL | Three collections (`priceBooks`, `addonPriceBooks`, `assumptionsBooks`) with no Postgres representation at all. |
| All features kept | Nothing dropped. Score overrides, the what's-working panel, product-gap grouping and summary cards are wiring work, not decisions. |
| One-time archive before switch-off | Cold storage. Separate project if anyone ever wants it back — not in scope. |

---

## Determined without asking — recorded so nobody re-opens them

| Item | Finding |
|---|---|
| `pm` role | **Correctly handled in RLS.** Four policies query `user_role`/`app_role` inline for `r.name='pm'`, giving a PM org-wide read on product signals — matching the app's product-signal curator behaviour. An earlier review claim that it had no policy was **false**; it was reached by grepping for the `is_admin()` helper instead of reading the policies. |
| Worker instance count | Cloud Run allows up to 10 (`deploy/cloudrun/first-deploy.sh:30`). The 5-second per-process session cache can therefore be stale on 9 instances briefly after a role change. A 5-second lag, not a security hole. Document; do not build around it. |
| Cross-org access | Nothing crosses orgs — every query is scoped to one `orgId`. Admins are the exception and are global. |
| `region` / `squad` levels | `region` = segment (in use once segments become rows). `squad` unused. |

---

## D7 — An audit trail is required

**Decided:** log score changes, role changes and impersonations.

`audit_log` is dead today — no writer, no reader, no trigger — and the codebase says so:
`worker/src/routes/impersonate.ts:12-13` — *"SQL audit_log logging is queued for when the
audit_log table becomes operational (it is currently dead)."* `07_grants.sql:43` revokes
UPDATE/DELETE, so it was designed append-only by a writer that was never built. There **is** a
live impersonation route.

Needs: a writer, and somewhere to view it. The table is partitioned by `created_at` with three
partitions already maintained (`03_phase3_ai_pipeline.sql:105-111`), so the storage side is ready.

---

## D8 — The task list must work on day one

**Decided:** tasks are day-one scope.

`task` is **read-only** today: `listTasks` and `listTasksByLifecycle` are both on
`PersistenceReadPort` (`types.ts:185-186`) and read `FROM task`, but **no `INSERT INTO task`
exists anywhere in `worker/src`**. Firestore-only writes via `createTask`/`updateTask`
(`routes.ts:1567,1569`), which are absent from the SQL write switch.

Needs a task write path. Constraints to respect:
`chk_task_ai_key CHECK (source <> 'ai_generated' OR task_key IS NOT NULL)`
(`02_phase2_activities.sql:144`) and `idx_task_ai_dedup` unique on `(activity_id, task_key)`
where `source='ai_generated' AND deleted_at IS NULL` (`:147`) — so repeated AI passes must not
collide. Also add `"task"` to the `EntityType` union (`id-registry.ts:10-21`) plus a matching
DB CHECK, since `09_id_registry.sql` constrains `entity_type` only in a comment.

---

## D9 — Wire `call_participant`, with five participant kinds

**Decided:** per-call participants become queryable data. **Kinds: contact, SE, AE, internal
leader, meeting room.**

The post-call pipeline already computes participants
(`worker/src/postcall/participants.ts`) and **nothing writes the table** — zero references to
`call_participant` in `worker/src`. The data is computed and discarded.

**The existing table covers 2 of the 5 kinds.** Current shape (`02_phase2_activities.sql:105-117`):
`activity_id` (FK, NOT NULL), `contact_id` (FK, nullable), `participant_name`,
`participant_email`, `participant_role CHECK IN ('attendee','presenter','observer')`.

| Kind | Fit |
|---|---|
| Contact | ✅ proper FK |
| AE | ✅ by name/email — correct, since AEs are not Janus users (`DealAe = {name, email}`, `types.js:18`) |
| SE | ⚠️ name/email only, **no `app_user` FK** |
| Internal leader | ⚠️ same |
| Meeting room | ⚠️ name only; not a person, and no valid `participant_role` value |

**Why the SE gap matters:** `CallIdentities` (`types.js:36`) already holds `primarySeUserId` and
`secondarySeUserIds[]` as **real user ids**. Writing them as name strings loses precision you
already have, and breaks any join from a participant to their team, manager or scorecards.

**Required additions:** `app_user_id` FK (nullable); a `participant_kind` column
(contact / se / ae / internal_leader / room); an `is_primary` flag for the primary-SE
distinction; and a rethink of `participant_role`, which describes *how* someone participated,
not *what* they are.

---

## D10 — All roadmap tables stay in the model

**Decided:** keep coaching (3 tables), notifications, the external-sync/CRM substrate
(5 tables), and the contact merge log. **Nothing removed from the schema.**

All have zero code today. They are retained as real roadmap, not speculative schema, so they
stay in the model and are excluded from "wiring gap" counts.

---

## D11 — Launch timing for D7 and D9: both at launch

- **Audit trail: at launch.** Score changes, role changes and impersonations logged from day one.
- **`call_participant`: at launch**, all five kinds, with the four schema additions in place
  before cutover. No call goes uncaptured.

---

## D12 — The archive is kept indefinitely

**Decided:** the one-time cold copy of the old Firestore data has no expiry.

One practical consequence, noted rather than argued: it is live customer data — contact names
and emails, call transcripts, account records — held with no deletion date, which means it
outlives this project. It therefore needs a named owner and an access control, or it becomes an
unowned copy of customer data that nobody remembers. That is a storage-hygiene task, not a
reason to revisit the decision.

---

## Day-one scope, as it now stands

Six items, in dependency order. The first is a prerequisite for the second.

| # | Item | Source |
|---|---|---|
| 1 | Schema apply + reference seed (`app_role`, `rubric`, `rubric_theme`) | prerequisite |
| 2 | Identity in SQL — 4 leader relationships, segments as rows, 2 rewrites, 9 endpoints + 9 store methods | D1 |
| 3 | Scoring reshape — scale, structure, and the two missing FK parents | D3 |
| 4 | Task write path | D8 |
| 5 | `call_participant` + 4 schema additions | D9, D11 |
| 6 | Audit-trail writer + a view | D7, D11 |
| 7 | Product-signal write path wired | D13 |

Plus the SE-team junction table, so SEs can edit their own accounts.

**D13 — the product-signal screen is day-one.** `upsertProductSignal` already exists
(`postgres-repository.ts:446`) and needs callers — most likely from the post-call gaps pass
(`worker/src/postcall/gaps.ts`) — plus `listProductSignalsByDeal` promoted from `private`
(`read-repository.ts:671`) onto `PersistenceReadPort`. The smallest of the seven items.

**There is no scope lever left.** Every deferrable item has been deliberately pulled into
launch, so the date is now a function of engineering throughput rather than of scope choices.

**What will be visibly incomplete at launch, and why:**

| View | Why |
|---|---|
| dashboard, manager, pipeline | Aggregates over data that will not exist yet. No engineering fixes this. |
| coaching | Roadmap (D10) — three tables, zero code. Empty today, empty after cutover. |

That is the complete list. Every other view is day-one scope.

---

## ⚠️ D14–D16 — the QIP calibration branch changes the scoring model

**Context.** `BRANCH_QIP_CALIBRATION.md` (branch `feat/qip-human-calibration-discovery-na`)
deploys on launch day. **The audited working tree does not contain it** — `19_se_motion.sql`,
`scorecard-calibrate.ts`, `discovery-incident-applicability.ts`, the `golden-set/` directory and
`import-qip-golden-xlsx.py` are all absent, and `se_motion` appears nowhere in schema or code.
The audits describe the pre-branch state and must be re-run against the branch.

### D14 — SE motion: segment supplies the default, overridable per call

Motion is **not** the same thing as a segment, despite the name overlap. Segments are
`seg_new_business` / `seg_digital` / `seg_nurture` (3); motions are `new_business` /
`expansion` (2). The branch says motion is *"defaulted from the acting SE's team."*

**Model:** a nullable `default_se_motion` on `org_unit` segment rows; the effective value stored
per call on `post_call.se_motion` / `scorecard.se_motion`; plus a flag recording whether the
value was **defaulted or overridden**. Resolution walks the existing parent chain from the SE's
team up to its segment, so no new hierarchy is needed.

**Interacts with D7:** motion changes which profile scores the call, so a motion override
changes someone's score. Overrides must be in the audit trail.

### D15 — Segment → motion mapping

| Segment | Default motion |
|---|---|
| `seg_new_business` | `new_business` |
| `seg_digital` | `expansion` |
| `seg_nurture` | `expansion` |

A 3→2 mapping, which the single `default_se_motion` column expresses cleanly.

### D16 — Scoring profiles become database rows

**Decided:** profiles live in `rubric` / `rubric_theme` / `rubric_parameter` — the three tables
that are currently inert. A calibration change becomes a data change, not a code deploy.

**Consequences:**

1. **The §5.10 reshape is now mandatory and larger.** The hierarchy inversion is no longer
   theoretical: `rubric_theme` is the parent of `rubric` (one theme per rubric), while a profile
   must contain many themes. That has to be fixed before profiles can be stored at all.
2. **Profile identity needs three parts.** `rubricIdFor` is `rub_{callType}_{version}`
   (`rubric-profiles.ts:76`) — **no motion**. NB discovery (32 credits) and expansion discovery
   (33 credits) are different profiles that would collide on `rub_discovery_2_1`, and one
   `rubric` row cannot hold two parameter sets. Needs `(call_type, se_motion, version)` as
   explicit columns, not just an encoded id.
3. **A loader is required** — the markdown spec (`docs/QIP_SCORING_V2_1.md`, 2088 lines,
   8 profiles) plus the branch's motion variants must be loaded into the tables, replacing
   `rubric-profiles.generated.ts` as the source of truth.
4. **Scale:** 8 call types × 2 motions = up to 16 profiles, growing with either dimension.
   Whether the matrix is full or sparse is unknown and must be checked against the branch.

### What the branch confirms about §5.10 — the findings strengthen

- **N/A is now first-class and rule-driven.** Discovery's `objections`, `comp_pitch` and
  `case_study` go N/A when the incident never occurred, with deterministic rules for when a 0
  stays in the denominator. `scorecard_line.score` is `NOT NULL CHECK 0..2` — **N/A is
  inexpressible.**
- **The schema is already known-wrong at read time.** The branch states that stored scorecards
  which wrote `0` for a fully-N/A category "are corrected on read." Code is patching a value
  the schema forced it to store wrongly.
- **Scores need provenance to be comparable.** Re-analysis is required for the new rules, and
  NB discovery moves 33 → 32 credits. A scorecard must record: call type, motion, whether
  motion was overridden, profile version, and whether the golden pass ran (`goldenCalibrated`).
  **None of those columns exist.**
- **A fourth environment flag exists:** `SCORECARD_GOLDEN_PASS` (default on). Not a cutover
  flag, but it belongs in the flag inventory alongside the three.

---

### D17 — Rubrics change only via the loader; no UI editing

**Decided:** profiles live in the database for structure, versioning and query, but the only
write path is the loader. No admin editing surface.

**Removes work:** no rubric-management UI, and no new permission model for it.

**Honest trade:** D16 was chosen partly because "a calibration change becomes a data change,
not a deploy." With D17 that is half-true — running the loader against the database avoids a
code release, but it is still an engineering action, not self-service. The structural benefits
are unaffected: real foreign keys, versioning, and joinable profile data.

The markdown spec (`docs/QIP_SCORING_V2_1.md`) remains the human-editable source of truth;
the loader projects it into the tables.

### D18 — A rubric edit creates a new version; history is frozen

**Decided:** editing a profile produces a new `rubric` version. Scorecards keep pointing at the
version they were scored under and never change retroactively.

**Uses the schema as designed.** `rubric.version`, `effective_from` and `effective_to` exist for
exactly this (`04_phase4_scoring_rubrics.sql:21-31`), and `scorecard.rubric_id` already
references a specific rubric row.

**Resolves a previously-flagged gap:** `rubric.effective_from` is `date NOT NULL` with no
default and nothing supplied it. The loader now does.

**Consequence to be aware of:** NB discovery scorecards written at 33 credits coexist
permanently with new ones at 32. Because the overall score is a credit-weighted *mean*
(`Σ(grade × credit) ÷ Σ credits included`), both still land on a 0–10 scale, so cross-version
comparison stays defensible — the removed `storytelling` theme is simply no longer measured.
Worth stating in any report that spans a version boundary, but not a correctness problem.

Combined with D16, the rubric identity must carry `(call_type, se_motion, version)` — e.g.
`rub_discovery_new_business_2_1` — as explicit columns, not only an encoded string.

---

## D19–D22 — the empty tables, resolved individually

### Correction that prompted this round

The table coverage audit described 18 tables as "inert" with "zero references." That phrasing
conflated **the table name being absent** with **the feature not existing**. For **five** of
them the feature is live and only the table is empty:

| Table | The live feature |
|---|---|
| `score_override` | Score disputes → manager ruling → append-only override. `web/score-disputes.js`, `override-lib.ts`, `override-report.mjs` |
| `coaching_*` | A coaching **queue** computed from scorecards (`aggregate-coaching.ts`: high-confidence only, score threshold 70, max 12) |
| `notification` | Manager dispute **emails via Resend** (`notify-email.ts`), gated on `DISPUTE_NOTIFY_ENABLED` / `EMAIL_PROVIDER_API_KEY` / `DISPUTE_NOTIFY_FROM` |
| `contact_merge_log` | Identity merge, active and being changed on the launch branch |
| `signal_cluster` | Gap clustering via embeddings + Gemini batch (`domain-model/gap-cluster.ts`, `repositories/signals.ts`, `embeddings.ts`) — stores to Firestore `gapClusters` |

**The recurring pattern: the action happens, the record doesn't.** True of `audit_log`,
`notification`, `contact_merge_log` and `signal_cluster` alike.

**D10 is therefore superseded** by the per-table dispositions below. It was answered on the
imprecise framing.

### Score overrides — no decision needed, the code settles it

`score_override` (`04_phase4_scoring_rubrics.sql:158-172`) records a change to **one
sub-parameter**: `previous_score` → `new_score` (both `NOT NULL CHECK 0..2`), a mandatory
`reason`, and `created_by`. `REVOKE UPDATE, DELETE` makes it append-only. FK is composite,
`(scorecard_line_id, scorecard_line_created_at)`.

Behaviour per `web/score-disputes.js:1` and `:509`: a rep disputes, a manager rules
`uphold`/`adjust`, and an adjustment appends an override — *"ScoreOverride logged; future
coaching will reflect this."* `quality-score.ts` has **zero** override references, so **the AI
score remains the scorecard's number** and the override is an attributed annotation that feeds
forward. The table models this correctly and needs no reshape — it already works at the
sub-parameter 0–2 grain.

**But the branch breaks it.** With N/A becoming a first-class state, `previous_score` and
`new_score` being `NOT NULL CHECK 0..2` means **a manager cannot dispute an N/A, nor override a
score to N/A.** Same defect as `scorecard_line`; fix in the same pass.

### D19 — Notifications are stored

Part of the audit trail: a dispute notification is evidence the manager was told. Records what
was sent and when. Uses `notification`.

### D20 — Gap clustering is day-one, alongside product signals

Clustering already works; this is wiring, not new logic. Resolves a hidden dependency in D13:
`product_signal.cluster_id` references `signal_cluster`, and `trg_signal_cluster_count`
(`05_phase5_product_coaching.sql:60-90`) maintains the count. Wiring signals without clusters
would leave `cluster_id` null and the clustering view empty.

### D21 — CRM id modelling deferred

No CRM integration exists yet. **Verified:** the `freshsales` / `salesforce` / `hubspot` hits in
the codebase are **product names** in ARR and pricing code (`arr/compute.ts:151`,
`price-book.ts:7`), not integration clients. CRM ids (`crmAccountId`, `crmOpportunityId`,
`crmContactId`) are captured manually; SQL holds them in a generic `external_ref` per table.

**Safe to defer:** `external_ref` has a unique partial index on each table, so it serves one
external system correctly. **The decision point is the arrival of a second one.** Open item:
`Deal` carries `crmOpportunityId` both top-level and inside `metadata` — one is probably stale
(mine to check).

### D22 — `prompt_template` and `feature_flag` stay in the model as roadmap

Kept, against my recommendation to drop them. Recorded reasoning so it isn't relitigated:
prompts are paired with the code that parses the model's response, so an untested prompt change
breaks scoring silently; and three of the seven-plus env flags are cutover switches that should
not be easily flippable — plus the circularity of storing "which database do we use" in the
database. Both remain **unused tables carried as roadmap**, with no work attached.

### Every one of the 18 formerly-inert tables now has a disposition. None are removed.

**Moving into scope (9):** `rubric`, `rubric_theme`, `rubric_parameter` (D16) · `audit_log`
(D7) · `call_participant` (D9) · `notification` (D19) · `signal_cluster` (D20) ·
`contact_merge_log` (day-one) · `score_override` (timing open — see below)

**Roadmap, no work (10):** `coaching_focus`, `coaching_reflection`, `coaching_recommendation` ·
`integration_token`, `sync_job`, `sync_error`, `sync_conflict`, `webhook_event` ·
`prompt_template`, `feature_flag`

### Revised table coverage at launch

Ten of 41 are wired today. After these decisions the day-one target is roughly **28 of 41** —
the 10 already wired, plus identity (5), scoring (5), and one each for task, call_participant,
product_signal, signal_cluster, audit_log, notification, contact_merge_log and score_override.
The remaining 13 are roadmap or infrastructure being deleted.

---

### D23 — Score disputes and overrides are day-one

Follows from D3: scoring works at launch, so a rep disputing a score in week one must be
handled. Small addition — `score_override` needs no reshape, only wiring plus the N/A fix.

---

## Day-one scope, consolidated (ten workstreams)

| # | Workstream | Tables touched | Source |
|---|---|---|---|
| 1 | Schema apply + reference seed | `app_role`, `rubric`, `rubric_theme` | prerequisite |
| 2 | **Identity in SQL** | `app_user`, `user_identity`, `user_role`, `org_unit` | D1, D14, D15 |
| 3 | **Scoring reshape** | `scorecard`, `scorecard_line`, `rubric`, `rubric_theme`, `rubric_parameter` | D3, D16, D17, D18 |
| 4 | Task write path | `task` | D8 |
| 5 | Call participants | `call_participant` | D9 |
| 6 | Audit trail | `audit_log` | D7 |
| 7 | Product signals + gap clustering | `product_signal`, `signal_cluster` | D13, D20 |
| 8 | Notifications recorded | `notification` | D19 |
| 9 | Contact merge logging | `contact_merge_log` | this round |
| 10 | Score disputes + overrides | `score_override` | D23 |
| — | SE-team junction table | new | earlier |

**The N/A fix is cross-cutting, not a single-table change.** `scorecard_line.score`,
`score_override.previous_score` / `new_score`, and the category-null handling are all
`NOT NULL CHECK 0..2` or equivalent, and the launch branch makes N/A a first-class state in all
three. One design decision, three places to apply it.

**Observation worth recording:** day-one scope grew from 6 workstreams to 10 over the course of
the validation questions. Each addition was individually justified and none should be reversed
on that basis alone — but the cumulative effect is that **there is no scope lever left at all**,
and the launch date is now purely a function of engineering throughput. Anyone planning the
date should see the aggregate, not the individual decisions.

---

## D24–D27 — reporting requirements, and a pre-call defect

### D24 — Pre-call briefs are always tied to a deal

**Decided:** `dealId` is required on a prep brief.

**This fixes a live defect.** The only read path filters `WHERE d.public_id = $1` over a
`LEFT JOIN deal` (`read-repository.ts:493-507`), while the write calls
`ensureDealRef(client, port, nullableString(doc.dealId), …)` which returns **null** when
`dealId` is absent. Result: `activity.deal_id` is NULL, the join drops the row, and **the brief
is written to Postgres and is invisible.** The Firestore type marks `dealId` optional
(`types.js:35`) while `lifecycleId` is required, so a deal-less brief is legal today.

**Fix:** the write must **reject** a brief with no `dealId` rather than write an unreadable row.
Fail loudly — same principle as the fallback paths. Correct the Firestore type to match.

**Three smaller pre-call notes:**
- No single-brief read exists (`getPrepBrief` nowhere). Tolerable, because the list returns the
  full `research_brief` / `input_snapshot` — but showing one brief means loading all of a
  deal's briefs.
- `pre_call.activity_id` is `UNIQUE` and each brief mints its own `act_<briefId>` activity, so
  N briefs create N `meeting` activities. Inflates any meetings-held metric.
- The write policy is **owner-only** (`activity.owner_user_id = current_user_id()`,
  `14_rls_owner_write_calls.sql:28-39`). A manager cannot create or edit a brief for an SE;
  only admin can. Confirm this is intended.

### D25 — Ranking is a backend query, not a UI feature (for now)

**Decided:** no leaderboard screen. The requirement is to **pull sorted rankings by call score
from the backend.** The on-screen promise (`web/coaching.js:39` — *"your manager sees trends and
themes, never a leaderboard"*) will be revisited separately when a UI is built.

**A naive ranking would be wrong.** `ORDER BY avg(composite_score)` ignores rules the code
already enforces: `isEligibleForAggregate` with `requireHighConfidence` excludes low-confidence
scores; **`provisional` profiles are shadow-mode and deliberately out of aggregates**;
`applyLeadershipCap` caps the displayed number at 8.0 when unverified; and scores span call
types and motions with different theme sets.

**So the ranking requirement and the scoring reshape are the same work.**

### D26 — Store scoring data at full fidelity; slice and dice later

**Directive, not a choice of granularity:** the data must be stored so any aggregation is
possible afterwards. Every dimension must be its own column, not folded into a computed number.

**Checklist of what that requires.** Per scorecard: owner ✓, org unit ✓, timestamp ✓, then
**missing** — call type, `se_motion`, profile version, overall on the correct 0–10 scale,
`includedCredits` / `totalCredits`, `confidence`, `provisional`, cap applied,
`goldenCalibrated`. Per line: sub-parameter score ✓ (0–2 matches), then **missing** — theme
key, theme grade (0–10), credit, category, `evidenceUnavailable` / N/A, coaching note.

That is the same 13-of-17 gap recorded in the audit's §5.10. **D26 does not add work; it adds a
second, independent reason the reshape cannot be deferred.**

**One genuine strength worth noting:** slicing by team, segment or org is already well served.
`org_unit` materialised paths mean any level of the hierarchy is a single prefix match, so
"scores by segment" needs no new structure.

### D27 — Adoption reporting from content, not logins

**Decided:** counting what people create is sufficient. **No login or session tracking.**

**Nearly free.** Briefs, calls and tasks per SE come from `pre_call` / `post_call` / `task`
joined to `activity.owner_user_id`, with `occurred_at` for time series — all day-one scope
already. The only prerequisite is identity in SQL, since the counts key on `app_user`.

**Accepted limitation:** someone who logs in and creates nothing is indistinguishable from
someone who never logged in.

**Minor gap:** the Firestore `Deal` type carries stored counters `prepCount`, `postCallCount`
and `openTaskCount`. The SQL `deal` table has **none of them**. Deriving by counting is more
correct — no drift — but those numbers change from a field read to an aggregate query.

### Correction to an earlier answer of yours

I asked whether anything besides the web app reads Firestore, and you answered no integrations.
**There is one:** `analytics/bigquery.ts:47` queries `lionpath_analytics.callSummaries_raw_*` in
BigQuery, fed by the Firestore→BigQuery export extension, behind
`handleDirectorAnalyticsGet`. If the extension and credentials are configured in production,
the clean slate **breaks director analytics.** It is optional (`bigQueryConfigured()` requires
`BIGQUERY_PROJECT_ID` / `BIGQUERY_DATASET` plus credentials) so it may be off — binary, and
someone should check.

Both analytics routes are also **Node-only** (`isNodeRuntime()`), so neither works on the
Cloudflare Worker deploy target.

---

## Still open

| # | Item | Owner |
|---|---|---|
| 1 | **Access to the launch branch** — blocking; no audit document should be relied on until then | Ajay |
| 2 | **Is the Firestore→BigQuery export configured in production?** Binary check; breaks director analytics if yes | Ajay |
| 3 | Is pre-call's owner-only write policy intended — can a manager never create a brief for an SE? | Ajay |
| 4 | Cutover date | Ajay |
| 5 | Named owner + access control for the indefinite archive (D12) | Ajay |
| 6 | Whether the 16 call-type × motion profiles are full or sparse — answerable from the branch | — |
| 7 | Which `crmOpportunityId` on `Deal` is authoritative — mine to check | — |

No open product decisions remain. Everything above is either a date, an access request, or
something I can determine from source.

---

## Recommended before any code is written

One field-by-field verification pass over the org, team, user and call-participant documents
against the schema. Rationale: across this session the leader-relationship count was revised
three times (3 → 4 → 5), an entire hierarchy level (segments) was missed on the first pass, and
one review finding (the `pm` role) proved false. **The structure is settled and the decisions
are sound; the field inventory is the part that has moved most.** A single careful pass costs
little against seven day-one items and removes the main remaining source of rework.

Everything else is engineering: the scoring reshape, the identity rebuild, the SE-team junction
table, segments as rows, the leader table, pricing tables, and the wiring gaps in the audit.
