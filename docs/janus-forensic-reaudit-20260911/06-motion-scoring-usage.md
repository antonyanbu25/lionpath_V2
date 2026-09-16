# 06 — Motion, scoring, leaderboards and usage

All figures measured on live staging (`janus-db`, PostgreSQL 16.14), read-only, every
query inside a rolled-back transaction with an admin session context. Historical numbers
from prior audits are treated as leads only and recalculated, as the prompt requires. **No
row was repaired.**

---

## 1. SE motion — the headline failure

### What the schema intends

Motion is `text` with a CHECK, not an enum. Five declarations:

| Object | Allowed values | Declared at |
|---|---|---|
| `post_call.se_motion` | `'new_business'`, `'expansion'` | `19_se_motion.sql:11`, CHECK `:16` |
| `scorecard.se_motion` | same | `19_se_motion.sql:22`, CHECK `:26` |
| `org_unit.default_se_motion` | same, nullable (NULL = inherit) | `21_identity_relationships.sql:80` |
| `rubric.se_motion` | same, NOT NULL | `22_scoring_reshape.sql:48`, `:268` |
| `*.se_motion_source` | `'resolved'`, `'override'`, `'defaulted'` | `22_scoring_reshape.sql:349`, `:702` |

`19_se_motion.sql` creates both columns with `DEFAULT 'new_business'`;
`22_scoring_reshape.sql:353` and `:704` **drop that default**, with `:352` stating the
intent that a missing motion should be a loud error rather than a silent New Business.
Both defaults are confirmed absent on staging **and** on a from-zero local apply.

### What the data shows

| Measure | Result |
|---|---|
| `post_call` rows | **345** |
| `post_call.se_motion = 'new_business'` | **345 / 345 (100%)** |
| `post_call.se_motion = 'expansion'` | **0** |
| `post_call.se_motion_source` | **NULL on 345 / 345 (100%)** |
| `scorecard` rows | **62** |
| `scorecard.se_motion = 'new_business'` | **62 / 62 (100%)** |
| `scorecard.se_motion_source = 'resolved'` | **62 / 62 (100%)** |
| `org_unit.default_se_motion = 'expansion'` | **2 org units** |
| `org_unit.default_se_motion = 'new_business'` | 1 org unit |
| `org_unit.default_se_motion` NULL (inherits) | 7 org units |

### The ten Phase 9 motion requirements, judged

| # | Requirement | Verdict |
|---|---|---|
| 1 | a configured Expansion owner produces an Expansion `post_call` | **FAILS** — 0 of 345, with 2 Expansion-configured org units |
| 2 | the matching scorecard uses Expansion motion and the Expansion rubric | **FAILS** — 0 of 62 |
| 3 | a configured New Business owner produces New Business | **passes trivially** — everything is New Business, so this cannot discriminate |
| 4 | a manager running a call for an Expansion SE still produces Expansion | **UNVERIFIABLE from data** — no Expansion row exists to inspect. `RUNTIME-BLOCKED` for live proof (no `janus_app` credential, no browser session for a proxy flow) |
| 5 | a manager running for a New Business SE produces New Business | **UNVERIFIABLE** for the same reason |
| 6 | client-body motion tampering rejected | **`CODE-PROVEN` partially** — `postgres-repository.ts:570-590` calls `resolve_se_motion_for_user` server-side for `scorecard`, so the scorecard motion is not client-supplied. The `post_call` path takes `seMotionFromPostCallDoc(rec)` from the document (`routes.ts`, history dual-write), so **post_call motion IS derived from the payload** |
| 7 | missing configuration is visible, never silently New Business | **FAILS.** `worker/src/domain-model/se-motion.ts:63` ends `defaultSeMotion` with `return "new_business";`, and `:33` returns `"new_business"` for a missing document. `21_identity_relationships.sql:95-96` names this exact fallback as the thing `resolve_se_motion` was written to replace. It is still there |
| 8 | retry / re-analysis / recovery / bulk preserve motion | **UNVERIFIABLE** — nothing to preserve while only one value exists |
| 9 | `se_motion_source` carries real provenance | **FAILS on `post_call`** (NULL on every row) and is **untrustworthy on `scorecard`** — see below |
| 10 | historical motion does not change when a profile changes | **`CODE-PROVEN`** — motion is a stored column, not a computed one. No backfill was run |

### Why `post_call.se_motion_source` is always NULL

The column is declared (`22_scoring_reshape.sql:696`) and constrained (`:701-702`), but it
is **not in the insert/update column list** in
`worker/src/data/persistence/postgres-repository.ts` — a repo-wide search finds
`se_motion_source` only inside the `scorecard` upsert (`:599`, `:611`). So the guarantee
stated at `22_scoring_reshape.sql:709-711`, that call and score "can never disagree about
motion", is **not met on the `post_call` side**: one of the two rows carries no provenance
at all.

### The CHECK cannot enforce presence

`CHECK (se_motion_source IN ('resolved','override','defaulted'))` **admits NULL**, because
in SQL `NULL IN (…)` evaluates to NULL, not false, and a CHECK passes on anything that is
not false. The constraint added to guarantee provenance cannot require it.

### The scorecard side is worse than the post_call side

All 62 scorecards assert `se_motion_source = 'resolved'` — a positive claim that motion
*was* derived from canonical data. With two Expansion-configured org units and zero
Expansion scorecards, that claim is not trustworthy for all 62 rows.

**A NULL is recoverable; a wrong `'resolved'` is not.** Nothing downstream can distinguish
a genuinely-resolved New Business scorecard from one that was mislabelled, so a future
backfill cannot safely target the bad rows. This is the single most damaging property of
the motion defect, and it is worse than what the prior audit recorded (which noted the
NULL provenance but not the false-positive `'resolved'`).

### Business impact

`22_scoring_reshape.sql:340-345` states the consequence directly: an Expansion SE scored
against a New Business profile is measured on **32 credits instead of 27**. Scores are
therefore not comparable across motions, and `v_se_score_leaderboard` partitions by
`se_motion` — so the Expansion leaderboard is structurally present and permanently empty,
while every Expansion SE appears in the New Business ranking against a rubric that does
not describe their job.

This is a **scoring-fairness defect**, not a data-hygiene one.

---

## 2. Scoring and scorecards

| Measure | Result |
|---|---|
| `post_call` rows | 345 |
| `post_call` with **no** scorecard on the same activity | **283 (82%)** |
| `scorecard` rows | 62 |
| `scorecard` with `is_current = true` | 62 (all) |
| `scorecard_line` rows | 3900 |
| `scorecard_line` orphans (no parent) | **0** |
| `v_scorecard_rankable` rows | 46 |
| `v_se_score_leaderboard` rows | **3**, all `new_business` |

### Judged against the Phase 9 scorecard requirements

| Requirement | Verdict |
|---|---|
| one current scorecard per eligible call | **holds where scorecards exist** — all 62 are `is_current`, 0 orphan lines. But 283 calls have none at all |
| correct call owner and org assignment | **PARTIAL** — 16 of 37 users have no `org_unit_id` (J-022), so org assignment cannot be correct for those owners |
| correct motion and rubric | **FAILS** — see §1 |
| real score scale round-trips | **not re-verified** this session. AT-3 asserts 7.4 round-trips (`BRANCH_REAUDIT…:236-247`) and reported 23/23; accepted as a document claim, not re-proven |
| provisional vs current semantics coherent | **PARTIAL** — every row is `is_current`, so the provisional state is unexercised and its correctness is unobservable |
| leadership cap / shareability | **not re-verified.** AT-4 asserts the >8.0 cap with the raw value recoverable, reported 19/19 |
| New Business and Expansion leaderboards do not mix | **structurally holds** (the view partitions by `se_motion`) but is **untestable** — one partition is empty |
| missing scorecards visible as pipeline defects | **FAILS, and this is the sharpest finding here.** 283 missing scorecards are invisible: `pipeline_state` reads `analysis_done` on all 345 rows (J-012), so the state model reports an 82% failure rate as success |
| UI presents a top three without fabricating ranks | **not verified** — requires the rendered leaderboard; `web/coaching.js` references leaderboard logic but no product code reads `v_se_score_leaderboard` (E-021) |
| eligibility does not reintroduce a confidence threshold | **holds** — `22_scoring_reshape.sql` removed it, and `DATABASE_GUARDRAIL_REPORT.md:132` records AT-4.1d confirming removal |

### The leaderboard's sample

Chain: **345 calls → 62 scorecards → 46 rankable → 3 people ranked.**

The leaderboard is computed from **46 of 345 calls (13%)** while presenting as a ranking of
SE performance. Excluding 16 of 62 is not itself a defect — `v_scorecard_rankable` encodes
deliberate eligibility rules. The problem is that the 13% is not surfaced to the viewer,
so a ranking built on an eighth of the data reads as authoritative. **Whether a 13% sample
is a defensible basis for a shareable ranking is a product decision**, and it is not
currently presented as a caveat anywhere.

---

## 3. Weekly usage and adoption

| Measure | Result |
|---|---|
| `app_user` rows (all `status='active'`) | 37 |
| with `org_unit_id` | 21 |
| **without** `org_unit_id` | **16 (43%)** |
| users owning ≥1 activity | 32 |
| users owning **zero** activities | 5 |
| `activity` total | 437 |
| `activity_type = 'call'` | 345 |
| `activity_type = 'meeting'` | 92 |
| `pre_call` | **92** |
| `post_call` | 345 |
| `task` | 2 |
| `user_usage_logins` | **172** |
| `user_usage_daily` | **2** |
| `ai_run` total | **2816** |
| `ai_run` with `activity_id` | **4 (0.14%)** |
| `ai_run` with `user_id` | 466 (16.5%) |
| total recorded cost | **$1.1365** |
| input / output tokens | **16,700,036** / 1,618,844 |

### Reconciling rollups against raw source

Phase 9 asks for daily rollups verified against raw tables for the same window. That
reconciliation **cannot be performed meaningfully**, because the rollup is empty:
`user_usage_daily` has **2 rows** against 172 login events and 437 activities. Any weekly
report reading it will show near-zero usage for a roster that demonstrably used the
product 437 times.

`worker/scripts/rollup-user-usage.mjs` exists; nothing schedules it — the same class of
gap as the stopped outbox projector (J-021).

### Per-measure availability

| Phase 9 measure | Available? |
|---|---|
| per-person login events | **yes** — `user_usage_logins`, 172 rows |
| days logged in | **no** — derived from `user_usage_daily` (2 rows) |
| pre-call runs | **yes** from raw `pre_call` (92); **no** from the rollup |
| post-call runs | **yes** from raw `post_call` (345); **no** from the rollup |
| total pre + post runs | **yes** from raw (437) |
| AI runs, attributed tokens and cost | **effectively no** — 2816 rows, 4 attributable to a call. The aggregate spend is known; nothing can be attributed |
| people with zero usage | **yes** — 5 own no activity; separately, 16 cannot be org-scoped |
| team-level distinct-user counts | **unreliable** — depends on `org_unit_id`, missing for 43% of users |

### On the word "workflows"

Phase 9 asks that the ambiguous term not appear in user-facing output unless the UI
defines it, preferring **"Total Pre + Post Runs"**. The measured value for that figure is
**437** (92 pre-call + 345 post-call). I did not audit the rendered UI strings for the word
"workflows" — that is a UI copy review and is `UNVERIFIED`.

---

## 4. What is healthy

Worth stating plainly, because most of this document is failures:

- **`activity`/`pre_call` parity is exact**: 92 `meeting` activities, 92 `pre_call` rows.
  AT-1's fourth assertion holds on live data.
- **Zero activities lack both a `pre_call` and a `post_call`** — no orphaned activities.
- **Zero orphaned `scorecard_line` rows** across 3900 lines. Where the scoring pipeline
  completes, its child integrity is sound.
- **No silent New Business default at the database layer.** Both `se_motion` defaults were
  correctly dropped by migration 22 and are absent on staging and on a from-zero apply.
  The silent default that remains is in **application** code
  (`se-motion.ts:63`), not in the schema — which means it is fixable without a migration.
