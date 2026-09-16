# Janus — Branch Re-Audit + Acceptance Tests

> **Repo note (added when this document was landed in the repo).**
> Reproduced unchanged as the audit of record. §6 "Still needed" is partly resolved: the tree is
> now a git repository, and `current_org_path()` **is** the fail-closed version
> ([08_rls_hardening.sql:18](../../janus/schema/08_rls_hardening.sql), hardened to `starts_with()`
> in [13_rls_hardening_round2.sql](../../janus/schema/13_rls_hardening_round2.sql)) — that
> BLOCKER-class gate is closed. §6's "two divergent orderings" caveat is also stale.
> See [BUILD_PLAN.md §2](./BUILD_PLAN.md#2-corrections-to-the-source-audits). The acceptance
> tests in §5 are implemented under [`janus/tests/acceptance/`](../../janus/tests/acceptance/).

**Date:** 2026-09-03
**Branch audited:** `feat/qip-human-calibration-discovery-na` at
`C:\Users\ajraghavan\Downloads\lionpath_V2-feat-qip-human-calibration-discovery-na\lionpath_V2`
**Confirmed as the branch:** `19_se_motion.sql`, `20_history_tasks_feedback.sql`,
`scorecard-calibrate.ts`, `discovery-incident-applicability.ts`, `golden-set/{examples,rules}.ts`
all present. Schema now runs `00`–`20`.
**Still not a git repository** — no `.git`. No database was contacted.

This supersedes the branch-related caveats in `janus_entity_mapping_audit.md` and
`janus_table_coverage_audit.md`.

---

## 1. Retracted — findings the branch fixes

| Finding | Status |
|---|---|
| **Rubric id collides across motions** | **RETRACTED.** `rubricIdFor(callType, version, seMotion)` (`rubric-profiles.ts:135-144`) emits `rub_discovery_expansion_2_1` for expansion. Motion is in the identity. |
| **"No call-type dimension in the schema"** | **PARTLY RETRACTED.** `19_se_motion.sql` adds `se_motion text NOT NULL DEFAULT 'new_business'` with a CHECK to **both** `post_call` and `scorecard`, and the write path stamps it (`postgres-repository.ts:382,398,417,426`). **`call_type` is still absent from both tables.** |
| **"Schema ends at 19, there is no 20"** | **RETRACTED for the branch.** The audit prompt's "00–20" ground truth was correct about the branch; my correction was correct only about the older tree. |

The `se_motion` migration comment shows the reasoning was deliberate: *"Shared keys (discovery,
etc.) must never blend across new_business vs expansion, so motion cannot live only as a dropped
Firestore top-level field or as a new post_call.analysis v1 key (that shape is frozen)."*

---

## 2. Confirmed — findings that survive the branch

### The keystone still stands

`upsertAppUser` and `upsertOrgUnit` (`postgres-repository.ts:493`, `:529`) still have **no
production caller** — only `test-postcall-update-idempotency-conflict.ts` and the re-export.
SQL identity provisioning does not exist on the branch either. Everything else depends on it.

### Scoring is still blocked three ways

1. **Scale mismatch, unfixed.** `composite_score numeric CHECK (composite_score BETWEEN 0 AND 2)`
   (`04_phase4_scoring_rubrics.sql:62`) while `LEADERSHIP_CAP_THRESHOLD = 8.0`
   (`quality-score.ts:15`) confirms `overall` is 0–10. **No later migration alters it.** The
   insert is rejected for any score above 2.
2. **Missing FK parents.** `app_role`, `rubric` and `rubric_theme` are still seeded nowhere.
   `scorecard.rubric_id` and `scorecard_line.rubric_theme_id` are both `NOT NULL` references.
3. **Provenance columns absent.** See §4.

### Unchanged elsewhere

- **41 logical tables** (47 `CREATE TABLE`, 6 partitions). `19_se_motion.sql` only adds columns.
- **Coverage unchanged:** 17 tables written, 19 read by application code.
- **The pre-call defect persists.** `read-repository.ts:504` still filters `WHERE d.public_id = $1`
  over a `LEFT JOIN deal`; `routes.ts:1896` still calls `ensureDealRef(nullableString(doc.dealId))`.
  A brief with no `dealId` is still written and invisible.
- `score_override.previous_score` / `new_score` remain `NOT NULL CHECK 0..2`, so **N/A cannot be
  disputed or overridden**.

---

## 3. New findings from the branch

### 3.1 Twelve call types, nineteen profiles, sparse — and it forces D16

`CALL_TYPES` (`rubric-profiles.ts:38-44`) is now `NB_CALL_TYPES` plus `demo_plan_upgrade`,
`demo_cross_sell`, `churn_mitigation`, `ai_vision_demo` = **12**. The generated catalog holds
**19 profiles** (8 new_business, 11 expansion), each carrying a `"motion"` field.

| Call type | new_business | expansion |
|---|---|---|
| demo | 34 | — |
| discovery | **32** | 27 |
| technical_deep_dive | 32 | 26 |
| reverse_demo | 28 | **17** |
| use_case_discussion | 31 | 24 |
| trial_setup | 33 | 24 |
| troubleshooting | 33 | 25 |
| qa_session | 25 | 20 |
| demo_plan_upgrade | — | 24 |
| demo_cross_sell | — | 26 |
| churn_mitigation | — | 24 |
| ai_vision_demo | — | 29 |

Nineteen valid pairs out of 24 possible. `callTypesForMotion()` (`:52-56`) enforces the split in
code via `NB_CALL_TYPES` / `EXPANSION_CALL_TYPES`.

**Design consequence: a `call_type` CHECK plus an `se_motion` CHECK cannot express this.** That
pair permits all 24 combinations when only 19 exist — nothing would stop a row claiming
`demo` + `expansion`. The valid set must be enforced by the **`rubric` table**: one row per
valid `(call_type, se_motion, version)`, with `scorecard.rubric_id` as the foreign key.

**So D16 (profiles as database rows) is not merely about avoiding deploys — it is the only clean
way to model a sparse matrix.** That decision is now load-bearing for correctness.

Note the credit spread: expansion `reverse_demo` is 17 against new-business 28. The
÷-included-credits normalisation is carrying the comparability, which matters for D25/D26.

### 3.2 Motion silently defaults to `new_business` in two layers

```ts
export function canonicalizeSeMotion(raw: unknown): SeMotion {
  return raw === "expansion" ? "expansion" : "new_business";   // rubric-profiles.ts:48-50
}
```

**Anything that is not the exact string `"expansion"`** — a typo, null, undefined, or a future
third motion — becomes `new_business`. And `19_se_motion.sql:11,22` adds
`DEFAULT 'new_business'` at the column level. Two independent silent defaults.

**Failure scenario:** an expansion SE's motion fails to resolve. They are scored against the
new-business `discovery` profile (32 credits, different themes) instead of expansion's (27).
The score is wrong, nothing flags it, and the difference is invisible in the stored row because
`se_motion` reads `new_business` as though it were determined rather than defaulted.

### 3.3 D14 and D15 are already implemented — in the least maintainable place

`defaultSeMotion(ctx)` (`worker/src/domain-model/se-motion.ts:52-64`) implements exactly what
you decided: team first, then segment, with `seg_nurture` and `seg_digital` → expansion.

```ts
const NB_TEAM_IDS        = new Set([TEAM_AJAY_ID, TEAM_NIKIL_ID]);
const EXPANSION_TEAM_IDS = new Set([TEAM_MARY_ID, TEAM_VARUN_ID, TEAM_AKSHITA_ID]);
```

**Three problems:**

1. **Hardcoded ids in source.** Five team ids and three segment ids. Adding a team or segment
   means editing TypeScript and deploying. Note `team_akshita` appears here but **not** in
   `seed-users.example.csv` — the roster and this list can already diverge.
2. **Duplicated.** The same mapping exists in `web/domain/se-motion.js:56` and
   `worker/src/domain-model/se-motion.ts:52`. Two copies to keep in sync.
3. **The worker's copy is dead code.** `defaultSeMotion` is called only from
   `web/postcall.js:382` and the two test files. The worker's version has no production caller.

**So motion is computed client-side and the server trusts the document.**
`seMotionFromPostCallDoc` (`se-motion.ts:32-40`) reads
`doc.seMotion ?? analysisMeta?.seMotion ?? confirmed?.seMotion ?? scorecard?.seMotion`, then
falls through to `new_business`. Any path that bypasses `web/postcall.js` — an older client, a
direct API call, a re-analysis job — stamps `new_business` silently.

**This is precisely what D14's design fixes:** `default_se_motion` on `org_unit` segment rows,
resolved **server-side** from the SE's actual org position, with a client-supplied value treated
as an explicit override and flagged as such. It removes the duplication, the hardcoding and the
silent default in one change. `defaultSeMotion`'s unused `isSegmentLeader` parameter can go too.

### 3.4 N/A is a boolean plus a reason, and needs four columns

`applyDiscoveryIncidentApplicability` (`discovery-incident-applicability.ts:97-111`) sets
`evidenceUnavailable: true` and `notApplicableReason: <reason>` on the line.

Combined with `scoreCall`'s three states (`quality-score.ts:135-136,147-151`), a line can be:
**scored**; **non-applicable** (grade 0, *stays* in the denominator); or
**evidenceUnavailable / modelOmitted** (*excluded* from the denominator, lowering confidence).

SQL currently offers one `score smallint NOT NULL CHECK 0..2`. It needs four columns:
`score` (nullable), `evidence_unavailable boolean`, `model_omitted boolean`,
`not_applicable_reason text`. Without them the composite cannot be recomputed or audited, and a
0 is indistinguishable from an exclusion.

### 3.5 The scorecard draft grew to ~24 fields

`ScorecardDraft` (`postcall/scorecard.ts:63-86`) gained `seMotion`, and `categoryScores` is now
`Record<string, number | null>` — the category-N/A change. `ScorecardLineDraft` (`:49-61`)
gained `notApplicableReason`.

`19_se_motion.sql` closes exactly **one** of the missing columns. Still absent: `call_type`,
`rubricVersion`, `provisional`, `totalCredits`, `includedCredits`, `categoryScores`,
`confidence`, `dealRiskFlags`, `leadershipShareable`, `verifierJustifications`; and per line
`themeKey`, `grade`, `credit`, `category`, `evidenceUnavailable`, `modelOmitted`, `confidence`,
`coachingNote`, `notApplicableReason`.

---

## 4. Revised scoring reshape — scoped from real code

**`rubric`** — one row per valid `(call_type, se_motion, version)`; 19 rows today. Explicit
columns `call_type`, `se_motion`, `version`, `name`, `total_credits`, `provisional`, `active`,
`effective_from`, `effective_to`. Do **not** parse the id — `rubricIdFor` encodes new_business
as *absence* of a token, which does not survive a third motion.

**Restructure the theme level.** Today `rubric_theme` is the *parent* of `rubric` (one theme per
rubric); a profile needs *many* themes. Themes belong under a rubric, carrying `theme_key`,
`credit` (1–3), `category` (5 values), `requires_video`, `display_order`.

**`rubric_parameter`** becomes the five sub-parameters under a theme, with `display_order` —
replacing the auto-minting at `postgres-repository.ts:430-434`, which exists only because the
real structure had no home.

**`scorecard`** — widen `composite_score` to 0–10 (or store raw and capped separately), and add
`call_type`, `rubric_version`, `provisional`, `total_credits`, `included_credits`, `confidence`,
`leadership_shareable`, `golden_calibrated`, plus the five category scores as nullable.

**`scorecard_line`** — add `theme_key`, `grade` (0–10), `credit`, `category`,
`evidence_unavailable`, `model_omitted`, `not_applicable_reason`, `confidence`, `coaching_note`;
make `score` nullable.

**`score_override`** — allow N/A on both `previous_score` and `new_score`.

**A loader** — projects the 19 generated profiles into the tables; the markdown spec stays the
human-editable source (D17), history frozen by version (D18).

---

## 5. Acceptance tests

Five tests, one per day-one reporting requirement. Written **before** the build so "for sure"
becomes checkable. Each must pass as a `SELECT` executed **as `janus_app`**, not as a superuser.

### AT-1 — Pre-call
**Setup:** two SEs on different teams; SE-A creates two prep briefs on deal D1, SE-B creates one
on deal D2. Attempt a third brief for SE-A **with no `dealId`**.
**Assert:**
1. The deal-less attempt **fails loudly** with a 4xx and writes **no** `pre_call` row.
2. `listPrepBriefsByLifecycle('D1')` returns exactly 2, newest first, with `research_brief` and
   `input_snapshot` populated.
3. As SE-B, a read scoped to D1 returns **0 rows** (RLS).
4. `pre_call` row count equals `activity` rows of type `meeting` created by the flow.

### AT-2 — Post-call
**Setup:** SE-A analyses one call on D1 with a full `detail` payload; then re-analyses it.
**Assert:**
1. Exactly **one** `post_call` row (idempotent on `idempotency_key`), `detail` intact.
2. `post_call.se_motion` equals the SE's resolved motion — **not** the `new_business` default —
   and a row where motion was defaulted is distinguishable from one where it was determined.
3. `getPostCallDetail` returns all 10 projected arrays with the same content that was written.
4. A `detail` payload containing an unknown key **fails loudly**; it does not silently fall back.

### AT-3 — Scores
**Setup:** score one `discovery` call for an SE in `seg_new_business` and one for an SE in
`seg_nurture`.
**Assert:**
1. The two scorecards reference **different** `rubric` rows: `(discovery, new_business)` with
   `total_credits = 32` and `(discovery, expansion)` with `27`.
2. `composite_score` stores the real 0–10 value — a score of 7.4 round-trips as 7.4.
3. Inserting a scorecard claiming `(demo, expansion)` **fails** — no such rubric row exists.
4. A discovery call with no objection incident stores `evidence_unavailable = true` and a
   `not_applicable_reason`, is **excluded from `included_credits`**, and is distinguishable from
   a genuine 0.
5. `overall` recomputed from the stored lines equals the stored `composite_score`.

### AT-4 — Ranking
**Setup:** four SEs across two segments. SE-1 high on a live profile; SE-2 higher but on a
`provisional` profile; SE-3 mid with `confidence` below the aggregate threshold; SE-4 mid,
fully valid.
**Assert:**
1. The ranking query returns **SE-1 then SE-4 only**. SE-2 excluded (provisional), SE-3 excluded
   (low confidence).
2. Rankable per `(call_type, se_motion)` **and** combined, from the same stored rows.
3. Rankable by team, segment and org via a single `org_unit.path` prefix match, with no new
   structure.
4. A scorecard above 8.0 without `leadership_shareable` reports the **capped** value where the
   cap applies, and the raw value remains recoverable.

### AT-5 — Usage / adoption
**Setup:** three SEs — one creates 3 briefs and 2 calls, one creates 1 brief, one creates nothing.
**Assert:**
1. Per-SE counts of `pre_call`, `post_call` and `task` are correct, grouped by
   `activity.owner_user_id`.
2. Time-sliceable by `activity.occurred_at` (this week vs last).
3. Aggregatable to team, segment and org by path prefix.
4. The SE who created nothing appears with **zero counts**, not absent — otherwise the
   non-adopter is invisible, which is the point of the report.
5. Runs as `janus_app` under RLS: a manager sees their subtree, an SE sees only themselves.

**Note on AT-5 and the deploy target:** both analytics routes are gated on `isNodeRuntime()`
(`routes/analytics.ts:17`, `admin-llm-usage.ts`). On Cloud Run these return 503 regardless of
how correct the data is. Confirm which target serves production before relying on AT-5 in the
product rather than as a direct query.

---

## 6. Still needed

| | |
|---|---|
| **A git repository** | This folder has no `.git` either. No branching, diffing or PRs. |
| **A target database** | Nothing has been verified against a live schema. `current_org_path()` being the fail-closed version is still unconfirmed — a BLOCKER-class gate. |
| **Credentials** | No `DATABASE_URL`. Cannot apply schema or run one test. |
| **Deploy target** | Cloud Run or VPS — decides whether AT-5 works in-product at all. |
| **BigQuery status** | Is the Firestore→BigQuery export configured in production? If yes, the clean slate breaks director analytics. |
| **From me** | The field-by-field pass over org / team / user / call-participant / scoring tables. |
