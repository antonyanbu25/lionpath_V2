# Janus — Firestore field → SQL column

**Date:** 2026-09-03 · **Branch:** `feat/qip-human-calibration-discovery-na`
**Status:** the mapping the migrations `21`–`29` implement. **Unapplied.**

This is the answer to "where does this field live now". It covers the tables the reshape
touches. The identity tables have their own, deeper pass in
[IDENTITY_FIELD_PASS.md](./IDENTITY_FIELD_PASS.md) and are summarised rather than repeated here.

**No data moves.** Postgres starts empty (D6). "→" means *this field's information lives here
from now on*, not *this field is copied here*.

Legend: **DIRECT** same value · **DERIVED** computed, no column · **NEW** column added by
`21`–`29` · **TABLE** promoted to its own table · **DROPPED** deliberately not carried.

---

## 1. Identity — `User`, `Team`, `Org`, `Segment`

Full treatment in [IDENTITY_FIELD_PASS.md](./IDENTITY_FIELD_PASS.md). The seven gaps it
identified, and where each landed:

| Firestore | SQL | Migration |
|---|---|---|
| `User.managerId` | `app_user.manager_user_id` **NEW** | `21` §1 |
| `User.avatarDataUrl` | `app_user_avatar.data_url` **TABLE** | `21` §2 |
| `Team.managerId` | `org_unit_leader` kind `team_manager` **TABLE** | `21` §4 |
| `Org.directorId` | `org_unit_leader` kind `director` | `21` §4 |
| `Org.seniorLeaderIds[]` | `org_unit_leader` kind `senior_leader`, many rows | `21` §4 |
| `Segment.leaderId` | `org_unit_leader` kind `segment_leader` | `21` §4 |
| motion default (D14/D15) | `org_unit.default_se_motion` **NEW** + `resolve_se_motion()` | `21` §3 |

Two additions beyond the seven:

| | |
|---|---|
| `User.jobTitle` → `app_user.job_level` | `derive_job_level(job_title, role_name)` **NEW**. `job_level` is `CHECK ('IC','manager','director','VP')` with no Firestore equivalent, and `upsertAppUser` defaults it to `'IC'` — so a Senior Director would be provisioned as an IC. Provisioning must call the function, not accept the default. Returns `NULL` for a blank title rather than guessing. |
| `role` → `v_user_current_role` | `user_role` is temporal with a GIST exclusion constraint, so a role change is close-then-insert. Readers almost always want "now", and the view is it. |

**The `avatarDataUrl` decision:** kept, in its own table. `app_user` is read on every request by
`resolveSqlSession`, so a base64 image column would load bytes on every authenticated call.
An absent row means fall back to initials.

---

## 2. Scoring — `Scorecard`, `ScorecardLine`, `SubParameterLine`

### The grain change worth understanding first

The domain has two grains and SQL had one:

| Domain (TypeScript) | Grain | SQL, before | SQL, after `22` |
|---|---|---|---|
| `Scorecard` | one per call | `scorecard` | `scorecard` |
| `ScorecardLine` | one per **theme** (11–16) | *nowhere* | **`scorecard_theme`** (new) |
| `SubParameterLine` | one per **sub-parameter** (5) | `scorecard_line` | `scorecard_line` |

This is a deliberate **deviation from the re-audit's §4**, which proposed denormalising
`theme_key` / `grade` / `credit` / `category` onto `scorecard_line`. Two reasons not to:

1. That repeats one theme grade across five rows that could then disagree.
2. The N/A state is a property of the **theme**, not of a sub-parameter — an excluded theme has
   no sub-parameter scores at all, so there is no row to put it on.

`score_override` keeps pointing at `scorecard_line` and keeps working unchanged at the
sub-parameter grain, which was the constraint that made the audit propose denormalising.

### `Scorecard` → `scorecard`

| Firestore / `ScorecardDraft` | SQL | Notes |
|---|---|---|
| `id` | `public_id` | DIRECT |
| `callId` | `activity_id` | via `id_registry` |
| `rubricId` | `rubric_id` | now a real FK to a real row |
| `overall` | `composite_score` | **the scale fix.** Was `CHECK 0..2`; now `0..10`. Stores the **raw** value; the 8.0 cap is applied on read |
| `totalCredits` | `total_credits` **NEW** | |
| `includedCredits` | `included_credits` **NEW** | after N/A exclusions |
| `categoryScores` | five `category_*` numerics **NEW**, nullable | a category with no included credits is `NULL`, not 0 |
| `confidence` | `confidence` **NEW** | `CHECK 0..1` |
| `provisional` | `provisional` **NEW** | copied from the rubric and **frozen** — promoting a profile later must not retroactively pull old scores into aggregates |
| `ownerId` | `owner_user_id` | DIRECT |
| `teamId` / `orgId` | `org_unit_id` | one column; the level is in `org_unit.path` |
| `accountId` | — | DERIVED via `activity.account_id` |
| `callType` | `call_type` **NEW** | was absent from **both** `post_call` and `scorecard` |
| `seMotion` | `se_motion` | added by `19`; the `DEFAULT` is **dropped** in `22` |
| — | `se_motion_source` **NEW** | `resolved` / `override` / `defaulted` — see §5 |
| `rubricVersion` | `rubric_version` **NEW** | |
| `leadershipShareable` | `leadership_shareable` **NEW** | |
| `goldenCalibrated` | `golden_calibrated` **NEW** | |
| `verifierJustifications` | `verifier_justifications` jsonb **NEW** | audit payload, not an aggregation dimension |
| `goldenJustifications` | `golden_justifications` jsonb **NEW** | |
| `dealRiskFlags[]` | `scorecard_deal_risk` **TABLE** | queried ("open claims to verify"), not just displayed |
| `seCamera` / `customerCamera` | `se_camera` / `customer_camera` | already present |

**Integrity guarantee:** `fk_scorecard_rubric_identity` is a composite FK on
`(rubric_id, call_type, se_motion)` → `rubric(id, call_type, se_motion)`. The stamped call type
and motion can never disagree with the profile that actually scored the call.

### `ScorecardLine` → `scorecard_theme` (new)

| Domain | SQL | Notes |
|---|---|---|
| `themeKey` | `theme_key` | unique per scorecard |
| `grade` | `grade` `CHECK 0..10` | **nullable** — an excluded theme has no grade, and a stored 0 would look scored |
| `credit` | `credit` `CHECK 1..3` | |
| `category` | `category` | five values |
| `evidenceUnavailable` | `evidence_unavailable` | |
| `modelOmitted` | `model_omitted` | |
| `notApplicableReason` | `not_applicable_reason` | **required** whenever either boolean is true |
| `confidence` | `confidence` | |
| `coachingNote` | `coaching_note` | |
| `ownerId`/`teamId`/`orgId` | — | DROPPED — denormalised in Firestore for join-free heatmaps; here `idx_sct_included` serves the same query |

Two constraints carry the N/A rule so it cannot be violated by a caller:

- `chk_scorecard_theme_na` — excluded ⟺ `grade IS NULL`.
- `chk_scorecard_theme_reason` — any exclusion must say why. A silent exclusion is
  indistinguishable from a bug.

### `SubParameterLine` → `scorecard_line`

| Domain | SQL | Notes |
|---|---|---|
| `score` | `score` `CHECK 0..2` | **nullable** — no verdict returned, distinct from a scored 0 |
| `evidence[]` | `evidence_json` jsonb **NEW** | the existing `evidence` text stays as the human-readable summary |
| position in the tuple | `param_index` **NEW** `CHECK 1..5` | |
| — | `scorecard_theme_id` **NEW** | composite FK `(scorecard_theme_id, scorecard_id)` so a line can never hang off another scorecard's theme |

### `score_override`

| | |
|---|---|
| `previous_score`, `new_score` | now **nullable** — a manager can dispute an N/A, or override a score *to* N/A (D23) |
| `chk_score_override_changed` | `IS DISTINCT FROM`, so `NULL → 2` and `2 → NULL` both count as changes and a no-op override is rejected |
| `ruling` **NEW** | `uphold` / `adjust`. Only an adjustment appends today, but an upheld dispute is also evidence |

---

## 3. The rubric catalog — profiles as rows (D16)

Source of truth stays `docs/QIP_SCORING_V2_1.md` (D17). The chain:

```
docs/QIP_SCORING_V2_1.md
  → worker/scripts/generate-rubric-profiles.mjs
    → web/rubric-profiles.generated.js  (+ the .ts twin)
      → janus/scripts/load-rubric-catalog.mjs
        → rubric (19) → rubric_theme (270) → rubric_parameter (1350)
```

| `QipProfile` | `rubric` |
|---|---|
| `key` | `call_type` |
| `motion` | `se_motion` |
| `version` | `version` |
| `name` | `name` |
| `totalCredits` | `total_credits` |
| `provisional` | `provisional` |
| `active` | `active` |
| — | `effective_from` supplied by the loader (D18); it was `NOT NULL` with no default and nothing supplied it |

| `QipTheme` | `rubric_theme` |
|---|---|
| `key` | `theme_key` |
| `credit` | `credit` |
| `category` | `category` |
| `requiresVideo` | `requires_video` |
| array position | `display_order` |
| `subParameters[5]` | five `rubric_parameter` rows, `param_index` 1–5 |

`rubric.id` keeps `rubricIdFor()`'s string form so an app-written `rubric_id` resolves. **Nothing
parses it back apart** — the identity is the three explicit columns, because `rubricIdFor` encodes
`new_business` as the *absence* of a token and that does not survive a third motion.

`janus_app` has **SELECT only** on all three tables (D17), so the loader is the only write path
in fact and not just by convention.

---

## 4. Calls — `PostCallDoc`, `PrepBrief`, `CallIdentities`, `TaskDoc`

| Firestore | SQL | Notes |
|---|---|---|
| `PostCallDoc.callType` | `post_call.call_type` **NEW** | |
| `PostCallDoc.seMotion` | `post_call.se_motion` | `DEFAULT` dropped |
| — | `post_call.se_motion_source` **NEW** | |
| `PostCallDoc.analysis` | `analysis` jsonb | shape frozen at v1 |
| `PostCallDoc.transcriptMeta` | `transcript_ref` + `detail` | |
| `PrepBrief.dealId` | `activity.deal_id`, **now required** | `trg_pre_call_deal_required` (`29`) — closes the live defect where a deal-less brief was written and invisible (D24) |
| `PrepBrief.input` / `.prep` | `pre_call.input_snapshot` / `.research_brief` | |
| `CallIdentities.primarySeUserId` | `call_participant` kind `se`, `is_primary` | **NEW** — was a name string, losing a real user id |
| `CallIdentities.secondarySeUserIds[]` | `call_participant` kind `se`, `is_primary = false` | |
| `CallIdentities.aeName` / `aeEmail` | `call_participant` kind `ae` | correct as name/email — AEs are not Janus users |
| `CallIdentities.contactIds[]` | `call_participant` kind `contact`, real FK | |
| meeting rooms | `call_participant` kind `room` | had no valid `participant_role` before |
| — | `v_call_identities` | rebuilds the whole stamp from the rows |
| `TaskDoc.completedAt` | `task.completed_at` **NEW** | required once `status = 'completed'` |
| `Deal.prepCount` / `postCallCount` / `openTaskCount` | `v_deal_counters` **DERIVED** | derived, not stored — a counter drifts the moment one write fails |

`participant_kind` and `participant_role` are now orthogonal: **kind** is what someone *is*,
**role** is how they *participated*. Conflating the two is why a meeting room had no legal value.

---

## 5. Motion provenance — the two silent defaults

`canonicalizeSeMotion` turns anything that is not the exact string `"expansion"` into
`new_business`, and `19_se_motion.sql` adds a column-level `DEFAULT 'new_business'` underneath it.

**What that costs:** an expansion SE whose motion fails to resolve is scored against the
new-business `discovery` profile — 32 credits and different themes instead of 27. The score is
wrong, nothing flags it, and the row reads `new_business` as though it had been *determined*.

| Layer | Before | After |
|---|---|---|
| Mapping | hardcoded id sets in `se-motion.ts:52` **and** `se-motion.js:56` (`team_akshita` in code, absent from the roster CSV) | `org_unit.default_se_motion` + `resolve_se_motion()`, walking the existing parent chain |
| Resolution | client-side; the server trusts the document | server-side from the SE's org position |
| Fallback | `new_business`, silently, twice | `NULL` from the resolver; the column `DEFAULT` is dropped, so a missing motion is a `NOT NULL` error |
| Provenance | none | `se_motion_source` = `resolved` / `override` / `defaulted` |
| Override | invisible | audited by `trg_scorecard_motion_override` (D7 × D14) |

---

## 6. Accounts, deals, pricing

| Firestore | SQL | Notes |
|---|---|---|
| `Account.seTeam[]` | `account_se_team` **TABLE** | up to 4, one primary, soft-removed. This is what "SEs can edit their own accounts" was blocked on — there was nothing for a write policy to check |
| `Account.primarySeUserId` | — | DERIVED — the junction row with `role = 'primary'`. Not repeated as a column: two places to state one fact is how they come to disagree |
| `Account.programPhase` | `account.program_phase` **NEW** | *not* the SE motion; overlapping words, different things |
| `Account.metadata` | `account.metadata` jsonb **NEW** | |
| `Account.crmAccountId` | `account.external_ref` | D21 — one external system, unique partial index |
| `Deal.crmOpportunityId` | `deal.external_ref` | **open:** the Firestore `Deal` carries this both top-level and inside `metadata`; one is probably stale |
| `priceBooks` | `price_book` **TABLE** | effective-dated; `price_book_at()` for point-in-time |
| `addonPriceBooks` | `addon_price_book` **TABLE** | `applies_to[]` / `requires_tier[]` stay arrays with GIN indexes |
| `assumptionsBooks` | `assumptions_book` **TABLE** | `assumption_at()`; scope/scope_value pairing enforced |

Pricing is `SELECT`-only for `janus_app`: it contains no customer data, every SE needs all of it,
and a bug in the app must not be able to reprice the catalog.

---

## 7. Deliberately not carried

| Firestore | Why |
|---|---|
| `User.orgId` | DERIVED from `org_unit.path` |
| `Team.memberIds[]` | DERIVED — the reverse of `app_user.org_unit_id` |
| `Org.teamIds[]`, `Segment.teamIds[]` | DERIVED from children's `parent_id`. Note this drives the highest-risk transform in provisioning: a team's parent must be its **segment**, looked up from `Org.segments[].teamIds`, not its org. A team parented to the org produces a path one level short, and since every RLS policy is a path prefix match, a segment leader would silently see nothing |
| `ScorecardLine.ownerId/teamId/orgId` | Denormalised for join-free heatmaps; `idx_sct_included` serves the same query |
| `Deal.latestQualityScore`, `Lifecycle.latestQualityScore` | Already deprecated — QIP belongs on the call, not the deal |
| `Deal.prepCount` / `postCallCount` / `openTaskCount` | Derived counters, see §4 |
| login / session records | D27 — adoption is measured from what people create. Accepted limitation: someone who logs in and creates nothing is indistinguishable from someone who never logged in |

## 8. Vocabulary traps, in one place

Three pairs of words that mean different things and are easy to swap. Getting any of them wrong
inverts something structural.

| | |
|---|---|
| **segment vs team** | Business users call level 2 a *team* and level 3 a *segment*. The **system is the other way round**: level 2 is the `segment` (`unit_type='region'`), level 3 is the `team`, named after its manager. Modelling with the business vocabulary inverts every `parent_id` and therefore every path — and all row-level security is a path prefix match (D4) |
| **motion vs segment** | Segments are `seg_new_business` / `seg_digital` / `seg_nurture` (three). Motions are `new_business` / `expansion` (two). A 3→2 mapping, which `default_se_motion` expresses (D15) |
| **motion vs `deal.type` vs `programPhase`** | `se_motion` is a property of the **acting SE**, used to pick the scoring catalog. `deal.type` is CRM routing. `account.program_phase` is where the account is in its lifecycle. All three use words from the same small set and none is derivable from another |
