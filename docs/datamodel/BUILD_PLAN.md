# Janus — Data Model Build Plan (NoSQL → PostgreSQL)

**Date:** 2026-09-03 · **Branch:** `feat/qip-human-calibration-discovery-na`
**Status:** migrations `21`–`29` written, **unapplied**. No database has been contacted.

## 0. What this undertaking is

**A database migration, not a data migration.** Postgres starts empty (D6). Nothing is copied
out of Firestore. The deliverable is a PostgreSQL model in which **every piece of functionality
the code already implements has a column to live in** — no more, no less.

That framing has three consequences that shape every file here:

1. **No backfill, no dual-read, no transform code.** There is no `INSERT ... SELECT` from a
   staging table anywhere in `21`–`29`. Where the source audits describe a "reconcile", read it
   as *provisioning* — creating rows for the ~14 people on the roster from scratch.
2. **Correctness beats compatibility.** A column that exists only to hold a legacy shape is not
   worth having. Where the old model was wrong (a 0–2 score column for a 0–10 score), the new
   one is simply right.
3. **Fidelity is the acceptance bar.** D26: every dimension gets its own column, never folded
   into a computed number. The test of the model is not "does it store a score" but "can any
   aggregation be reconstructed from what was stored."

Scope discipline, restated from the decisions log: **this is a data-modelling exercise.** No
functionality is being reopened, added or dropped. If a column has no code behind it, it is
either roadmap (D10/D22) or it does not belong.

## 1. Source documents

| Document | Role |
|---|---|
| [DECISIONS_LOG.md](./DECISIONS_LOG.md) | Authoritative. D1–D27. Where anything contradicts it, it wins. |
| [BRANCH_REAUDIT_AND_ACCEPTANCE_TESTS.md](./BRANCH_REAUDIT_AND_ACCEPTANCE_TESTS.md) | Audit of record against this branch. Defines AT-1…AT-5. |
| [IDENTITY_FIELD_PASS.md](./IDENTITY_FIELD_PASS.md) | Field-by-field pass for the identity workstream. |
| [FIELD_MAP.md](./FIELD_MAP.md) | Firestore field → SQL column, for every table in the reshape. |

## 2. Corrections to the source audits

Verified directly against this branch. The three documents above are reproduced unchanged; these
are the places where they no longer hold.

| Claim | Status | Evidence |
|---|---|---|
| "Still not a git repository" | **Resolved.** | The tree is now a git repo on `feat/qip-human-calibration-discovery-na`. |
| "`current_org_path()` being the fail-closed version is still unconfirmed — a BLOCKER-class gate" | **Confirmed fail-closed. Gate closed.** | [`08_rls_hardening.sql:18`](../../janus/schema/08_rls_hardening.sql) redefines it as `NULLIF(current_setting(...), '')` → NULL when unset. [`13_rls_hardening_round2.sql`](../../janus/schema/13_rls_hardening_round2.sql) further replaces `LIKE prefix \|\| '%'` with `starts_with()`, closing the `_`-as-wildcard hole. Both applied to all 11 org-path policies. |
| "Requires registration in `apply-janus-schema.mjs` PHASE_FILES **and** `init_all.sql` — two divergent orderings exist" | **Stale.** They are identical — 23 entries, same order. | [`init_all.sql`](../../janus/schema/init_all.sql), [`apply-janus-schema.mjs:24-48`](../../worker/scripts/apply-janus-schema.mjs) |
| "up to 16 profiles … whether the matrix is full or sparse is unknown" (D16.4) | **Answered: sparse, 19 of 24.** | Enumerated from [`rubric-profiles.generated.ts`](../../worker/src/rubric-profiles.generated.ts): 8 new_business + 11 expansion. |
| "NB discovery (32 credits) and expansion discovery (**33** credits)" (D16.2) | **Numbers transposed.** NB discovery is **32**, expansion discovery is **27**. | The 33-credit profile is NB `trial_setup`. The argument is unaffected — they still collide on `rub_discovery_2_1` without a motion token. |
| "`rubricIdFor` is `rub_{callType}_{version}` — **no motion**" (D16.2) | **Superseded by the branch, as the re-audit notes.** `rubricIdFor` now takes `seMotion` and emits `rub_discovery_expansion_2_1`. | [`rubric-profiles.ts:130-144`](../../worker/src/rubric-profiles.ts) |
| §3.4 "a line can be … **non-applicable** (grade 0, *stays* in the denominator)" | **Imprecise.** That state is *not marked on the line at all* — it is a habit theme the model scored 0. And `modelOmitted` is folded into the exclusion by `OR`, not treated separately. | [`quality-score.ts:150,158`](../../worker/src/quality-score.ts): `evidenceUnavailable = !!input?.evidenceUnavailable \|\| !!input?.modelOmitted`. So the *exclusion rule* is one boolean; the two columns exist to record **which reason**, for audit. |

### One finding the audits did not surface

**Only 2 of the 19 profiles are non-provisional.** `demo`/new_business and
`discovery`/new_business are live; the other 17 — including every expansion profile — are
`provisional: true`, i.e. shadow mode and deliberately out of aggregates per D25.

This is load-bearing for reporting. On day one, ranking and averaging can draw on **two call
types in one motion only**. AT-4 asserts provisional exclusion works; it does not assert that
enough non-provisional data exists to rank anybody. Whoever plans the launch reporting should
know that the ranking query will be near-empty until calibration promotes more profiles —
which, under D17, is a loader run, not a deploy.

## 3. Migration map

`00`–`20` are untouched (decision: layer, don't rewrite — safe against any environment that has
already applied them). New files:

| File | Workstream | What it does |
|---|---|---|
| [`21_identity_relationships.sql`](../../janus/schema/21_identity_relationships.sql) | W2 (D1, D14, D15) | `app_user.manager_user_id`; `app_user_avatar`; `org_unit.default_se_motion` + resolver; `org_unit_leader` (4 capacities, temporal); `app_role` seed; `job_level` derivation |
| [`22_scoring_reshape.sql`](../../janus/schema/22_scoring_reshape.sql) | W3 (D3, D16–D18, D23, D26) | The big one. Inverts `rubric`↔`rubric_theme`; adds the sparse-matrix key; widens the score to 0–10; makes N/A first-class in three places; adds all 19 missing provenance columns |
| [`23_call_participant.sql`](../../janus/schema/23_call_participant.sql) | W5 (D9, D11) | `participant_kind` (5 kinds), `app_user_id` FK, `is_primary`, `participant_role` rethink |
| [`24_task_write_path.sql`](../../janus/schema/24_task_write_path.sql) | W4 (D8) | `id_registry.entity_type` CHECK incl. `'task'`; task RLS; deal counter views replacing `prepCount`/`postCallCount`/`openTaskCount` |
| [`25_audit_and_notifications.sql`](../../janus/schema/25_audit_and_notifications.sql) | W6, W8 (D7, D11, D19) | `audit_log` actor/impersonation/diff columns + `score_override`/`user_role`/motion-override triggers; `notification` delivery evidence |
| [`26_account_se_team.sql`](../../janus/schema/26_account_se_team.sql) | earlier decision | `account_se_team` junction (up to 4 members, one primary) — unblocks "SEs can edit their own accounts"; `account` RLS |
| [`27_pricing_books.sql`](../../janus/schema/27_pricing_books.sql) | earlier decision | `price_book`, `addon_price_book`, `assumptions_book` — effective-dated, three collections with no Postgres representation today |
| [`28_roadmap_gaps.sql`](../../janus/schema/28_roadmap_gaps.sql) | D10, D22 | Gaps in tables kept as roadmap: `coaching_*`, `prompt_template`, `feature_flag`, `signal_cluster`, `clustering_state`, `contact_merge_log`. Includes one item that is **not** optional — see §4.3 |
| [`29_precall_deal_required.sql`](../../janus/schema/29_precall_deal_required.sql) | D24 | Rejects a prep brief whose activity has no deal — closes the live "written but invisible" defect at the data layer, not just in app code. Plus `v_pre_call_brief` |

`24b` is a one-line-per-statement enum-widening file, following the existing
[`10b`](../../janus/schema/10b_integration_enum.sql) / [`10c`](../../janus/schema/10c_run_type_enum_widen.sql)
convention: Postgres forbids using a new enum value in the transaction that added it, and
`apply-janus-schema.mjs` runs each file as one implicit transaction.

Registered in both orderings. Verify with:

```bash
node worker/scripts/apply-janus-schema.mjs --dry-run
```

## 4. The structural changes worth understanding

Everything else in `22` is columns. These are the shape changes — the first two are
deliberate, the third is a consequence of the first that would otherwise go unnoticed.

### 4.1 The rubric hierarchy is inverted today

```
today                          required
-----                          --------
rubric_theme (1)               rubric  (1)   ← one per (call_type, se_motion, version)
  └── rubric (N)                 └── rubric_theme (N)   ← 11–16 per profile
        └── rubric_parameter (N)       └── rubric_parameter (5)   ← exactly five
```

A QIP profile *contains* many themes; the schema has a theme *containing* many rubrics. This is
not a preference — profiles cannot be stored at all until it is fixed, and D16 requires them
stored. `22` adds `rubric_id` to `rubric_theme`, moves `rubric_parameter` under the theme, and
retires `rubric.rubric_theme_id`.

Concrete size, counted from the generated catalog: **19 rubrics → 270 themes → 1350 parameters.**

### 4.2 A CHECK pair cannot express a sparse matrix

12 call types × 2 motions = 24 combinations. Only **19** are valid. A `call_type` CHECK plus an
`se_motion` CHECK admits all 24 — nothing would stop a row claiming `demo` + `expansion`, which
has no profile and therefore no themes to score against.

The valid set is enforced **by the `rubric` table**: one row per valid triple, with
`scorecard.rubric_id` as a `NOT NULL` foreign key. The invalid pair fails on insert because the
parent row does not exist. This is why D16 is load-bearing for *correctness*, not just for
avoiding deploys — and it is why AT-3.3 asserts an insert claiming `(demo, expansion)` fails.

`rubric.id` keeps `rubricIdFor`'s string form for compatibility, but **nothing parses it.** The
identity is the three explicit columns, because `rubricIdFor` encodes new_business as the
*absence* of a token, which does not survive a third motion.

### 4.3 The inversion silently broke the coaching tables

Worth calling out because it is a consequence, not a new decision. Before `22`,
`rubric_theme.id` was global — one row per theme, shared across rubrics — so
`coaching_focus.rubric_theme_id` meant *this SE is working on questioning*. After `22`,
`rubric_theme` is scoped to one rubric, so there are 19 separate "questions" rows and the same
foreign key now means *questioning, but only as it appears in the expansion churn_mitigation
profile*. That is not what coaching means.

`28` fixes it: coaching keys on `theme_key` (the concept, stable across profiles and versions)
and `rubric_theme_id` becomes an optional pointer for the case where a recommendation really did
come from one profile's scoring. `aggregate-coaching.ts` already groups by concept, so this
matches the code.

## 5. The N/A decision, and the grain it forced

One design decision, three places. But making N/A expressible surfaced a grain mismatch first.

### The grain

The domain has two levels and SQL had one:

| Domain | Grain | SQL before | SQL after |
|---|---|---|---|
| `Scorecard` | one per call | `scorecard` | `scorecard` |
| `ScorecardLine` | one per **theme** (11–16) | *nowhere* | **`scorecard_theme`** (new) |
| `SubParameterLine` | one per **sub-parameter** (5) | `scorecard_line` | `scorecard_line` |

**This deviates from the re-audit's §4**, which proposed denormalising `theme_key` / `grade` /
`credit` / `category` onto `scorecard_line`. Two reasons not to: that repeats one grade across
five rows which could then disagree, and the N/A state is a property of the **theme** — an
excluded theme has no sub-parameter scores at all, so there is no row to put it on. The
constraint that motivated the audit's approach was `score_override`'s foreign key, and the
two-level design leaves that pointing at `scorecard_line`, unchanged, at the sub-parameter grain.

### The three states

A `scorecard_theme` is in exactly one of:

| State | `grade` | `evidence_unavailable` | `model_omitted` | In denominator? |
|---|---|---|---|---|
| Scored | 0–10 | `false` | `false` | yes |
| Habit theme, no evidence | **0** | `false` | `false` | **yes** — a real 0 |
| Not applicable / not evidenced | **NULL** | `true` | either | **no** |

The exclusion rule is `evidence_unavailable OR model_omitted`, matching
[`quality-score.ts:150`](../../worker/src/quality-score.ts). The two booleans stay separate so the
*reason* survives: "the objection never happened" and "the model didn't return this theme" are
the same arithmetic and very different facts.

Two constraints make the rule unbreakable by a caller:
`chk_scorecard_theme_na` (excluded ⟺ `grade IS NULL`) and `chk_scorecard_theme_reason` (any
exclusion must say why).

### Applied in three places

1. **`scorecard_theme`** — nullable `grade` plus the three N/A columns, as above.
2. **`score_override`** — `previous_score` and `new_score` nullable, so a manager can dispute an
   N/A or override a score *to* N/A. `chk_score_override_changed` uses `IS DISTINCT FROM`, so
   `NULL → 2` counts as a change and a no-op override is rejected.
3. **`scorecard.category_*`** — five nullable numerics. A category with zero included credits is
   `NULL`, not 0 — which is what the code already returns on read
   ([`quality-score.ts:183`](../../worker/src/quality-score.ts)) while the schema forced a wrong
   value to be stored. That read-time patch can be deleted once this lands.

## 6. Motion provenance — closing two silent defaults

`canonicalizeSeMotion` turns anything that is not the exact string `"expansion"` into
`new_business`, and `19_se_motion.sql` adds a column-level `DEFAULT 'new_business'` underneath
it. An expansion SE whose motion fails to resolve is scored against the wrong profile (32
credits and different themes instead of 27), the score is wrong, and the stored row reads
`new_business` as though it had been *determined*.

`22` closes this:

- **`se_motion_source`** on `post_call` and `scorecard`:
  `'resolved'` (walked the org chain) · `'override'` (explicit, per-call) · `'defaulted'`
  (nothing resolved — the fallback fired). AT-2.2 asserts a defaulted row is distinguishable
  from a determined one; this column is how.
- **The column DEFAULT is dropped.** Under a clean slate there are no existing rows to protect,
  so the insert must state the motion. A missing motion becomes a loud error instead of a quiet
  `new_business`.
- **`org_unit.default_se_motion`** (in `21`) plus `resolve_se_motion(org_unit_id)` moves the
  D14/D15 mapping out of TypeScript. It replaces the hardcoded id sets duplicated across
  [`worker/src/domain-model/se-motion.ts:52`](../../worker/src/domain-model/se-motion.ts) and
  [`web/domain/se-motion.js:56`](../../web/domain/se-motion.js) — where `team_akshita` already
  appears in the code but not in `seed-users.example.csv`.
- **Overrides are audited** (D7 × D14) by `trg_scorecard_motion_override` in `25`, because a
  motion override changes someone's score.

## 7. Acceptance tests

Five runnable files under [`janus/tests/acceptance/`](../../janus/tests/acceptance/), one per
day-one reporting requirement, each executing **as `janus_app`** under RLS — never as superuser.

```bash
node janus/tests/acceptance/run_acceptance.mjs          # all five
node janus/tests/acceptance/at3_scores.test.mjs         # one
```

| Test | Requirement | Notable assertion |
|---|---|---|
| [AT-1](../../janus/tests/acceptance/at1_precall.test.mjs) | Pre-call briefs | A brief with no `dealId` **fails loudly** and writes no row (D24) |
| [AT-2](../../janus/tests/acceptance/at2_postcall.test.mjs) | Post-call | A defaulted motion is distinguishable from a determined one |
| [AT-3](../../janus/tests/acceptance/at3_scores.test.mjs) | Scores | 7.4 round-trips as 7.4; `(demo, expansion)` is rejected; N/A ≠ 0 |
| [AT-4](../../janus/tests/acceptance/at4_ranking.test.mjs) | Ranking | Provisional and low-confidence excluded; raw value recoverable above the cap |
| [AT-5](../../janus/tests/acceptance/at5_adoption.test.mjs) | Adoption | The SE who created nothing appears with **zero counts**, not absent |

Two of these tests encode requirements the *schema* satisfies but the *application* does not yet:
AT-1.1 (reject a deal-less brief) and AT-2.4 (reject an unknown `detail` key) are application-layer
guards. They are written to fail until that code exists — that is the point of writing them first.

## 8. What still gates this

| | |
|---|---|
| **A target database** | Nothing here has been applied. `DATABASE_URL_MIGRATIONS` is unset in this checkout. Every migration is idempotent and safe to re-run, but "written" is not "verified". |
| **The rubric loader run** | [`janus/scripts/load-rubric-catalog.mjs`](../../janus/scripts/load-rubric-catalog.mjs) projects 19 → 270 → 1350 rows. Until it runs, `scorecard.rubric_id` has no parent and no score can save. |
| **BigQuery status** | Is the Firestore→BigQuery export live in production? If yes, the clean slate breaks director analytics ([`analytics/bigquery.ts:47`](../../worker/src/analytics/bigquery.ts)). Binary check, still unanswered. |
| **Deploy target** | Both analytics routes are gated on `isNodeRuntime()`. On Cloud Run they return 503 regardless of how correct the data is — so AT-5 works as a query but not necessarily in-product. |
| **Pre-call write policy** | `activity.owner_user_id = current_user_id()` means a manager can never create a brief for an SE. Confirm that is intended; it is a policy line, not a model change. |
| **Application wiring** | `upsertAppUser` / `upsertOrgUnit` still have no production caller. The keystone finding stands: the model can be perfect and nothing will write to it. |

### One acceptance criterion that contradicts the schema's design

**AT-5.5 as written says "a manager sees their subtree, an SE sees only themselves."** The first
half holds. The second does not — and not because of a bug.

Every read policy in this schema is a path prefix match on the reader's own org unit
(`starts_with(ou.path, current_org_path())`). An SE's unit is their **team**, so a team-scoped
session sees its team. That is uniformly true of `activity`, `pre_call`, `post_call`,
`scorecard` and now `task` — not something specific to adoption reporting.

Narrowing SEs to self-only would mean the worker sets a narrower `app.org_unit_path` for the
`se` role, or the policies gain a role check. **That is a change to the access model, not to the
data model**, so I have not made it. AT-5 asserts the designed behaviour and flags the
divergence explicitly rather than passing quietly. If self-only is what you actually want for
SEs, say so and it is a small, separate change — but it will also change what an SE sees on the
call and score screens, which is a product decision.

### Two assertions the data model cannot make on its own

Reported by the suite as `[APP ]` rather than as failures, because a schema test that fails on
missing application code is noise. They are the guards the write path still owes:

- **AT-2.4 — an unknown `detail` key must fail loudly.** `post_call.detail` is `jsonb` and
  accepts any shape by design; the ten projected arrays are a code contract
  (`postcall-schema.ts`), not a column list. Constraining it in SQL would freeze a shape the
  branch is still changing.
- **AT-1.1 was in this category and no longer is.** D24's "a brief is always tied to a deal" is
  now enforced by `trg_pre_call_deal_required`, so the deal-less brief is rejected by the
  database rather than by whichever caller remembers to check.
