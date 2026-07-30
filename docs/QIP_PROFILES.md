# QIP Profiles

Canonical scoring profiles for post-call analysis. Extracted from
`POST_CALL_SPEC_V2.md` §6.2 with the core-four amendment applied.

**Version:** `1.0`
**Status:** demo and discovery live · six profiles in shadow mode (§6)

One shared theme vocabulary. Each call type selects a subset and assigns weights summing to 100.
A theme key means the same thing in every profile it appears in — never fork a key per call type.

---

## 1. The core-four amendment

The profiles as originally specified shared **no theme across all eight**, which makes a
cross-type composite impossible to compute honestly:

| Theme | Present in | Missing from |
|---|---|---|
| `call_flow` | 7 of 8 | trial setup |
| `customer_engagement` | 7 of 8 | troubleshooting |
| `camera_on` | 7 of 8 | use case discussion |
| `objections` | 6 of 8 | trial setup, troubleshooting |

These four are now present in all eight profiles. Only three profiles changed:

| Profile | Change | Points taken from |
|---|---|---|
| Use case discussion | `+ camera_on 5` | `storytelling` 10 → 5 |
| Trial setup | `+ call_flow 5`, `+ objections 5` | `admin_access_enablement` 15 → 10, `cadence_checkpoints` 10 → 5 |
| Troubleshooting | `+ customer_engagement 5`, `+ objections 5` | `escalation_handling` 10 → 5, `documentation_followup` 10 → 5 |

Demo, discovery, technical deep dive, reverse demo and Q&A are **unchanged from the spec**.

Every profile still totals 100, and every profile's heaviest theme keeps its specified weight.

### Two composites, computed differently

**Type composite** — weighted, within one call type only.

```
sum(score × weight) over applicable lines ÷ sum(weight) over applicable lines
```
Always displayed with its denominator and profile name: `86 / 100 (demo v1.0)`.

**Spine composite** — cross-type, over the core four only, **unweighted**.

```
mean of raw theme scores for call_flow, customer_engagement, objections, camera_on
```

Unweighted is deliberate. `questions` is 5 points in demo and 20 in discovery — that weight
describes what the call type demands, not the SE's skill. Weighting a cross-type average would
reintroduce exactly the call-mix gaming that spec §6.1 warns about.

Never produce a single blended weighted composite across call types.

---

## 2. The eight profiles

### Demo — 100 *(unchanged)*

| Theme | Wt | | Theme | Wt |
|---|---|---|---|---|
| `research_agenda` | 5 | | `value` | **10** |
| `questions` | 5 | | `objections` | 5 ● |
| `slide_deck` | 5 | | `case_study_roi` | 5 |
| `cde_build` | **10** | | `comp_pitch` | 5 |
| `solutioning` | 5 | | `summarise` | 5 |
| `storytelling` | 5 | | `camera_on` | 5 ● |
| `call_flow` | **10** ● | | `customer_engagement` | **10** ● |
| `ai` | 5 | | `cta` | 5 |

Technical 80 / non-technical 20. Four themes carry 40 of 100: `cde_build`, `call_flow`, `value`,
`customer_engagement`. No dashboard should treat a comp-pitch miss as equal to a call-flow miss.

### Discovery — 100 *(unchanged)*

| Theme | Wt |
|---|---|
| `questions` | **20** |
| `research_agenda` | 10 |
| `incumbent_competition` | 10 |
| `pain_qualification` | 10 |
| `value` | 10 |
| `call_flow` | 10 ● |
| `ai` | 5 |
| `objections` | 5 ● |
| `summarise` | 5 |
| `camera_on` | 5 ● |
| `customer_engagement` | 5 ● |
| `cta` | 5 |

### Technical deep dive — 100 *(unchanged)*

| Theme | Wt |
|---|---|
| `technical_accuracy` | **20** |
| `solutioning` | 15 |
| `cde_build` | 15 |
| `architecture_fitment` | 10 |
| `questions` | 10 |
| `objections` | 10 ● |
| `value` | 5 |
| `call_flow` | 5 ● |
| `customer_engagement` | 5 ● |
| `camera_on` | 5 ● |

### Reverse demo — 100 *(unchanged)*

The customer drives; the SE observes and coaches. Taking the mouse back is the failure mode.

| Theme | Wt |
|---|---|
| `handover_discipline` | **20** |
| `task_design` | 15 |
| `coaching_without_taking_over` | 15 |
| `setup_framing` | 10 |
| `observation_note_capture` | 10 |
| `customer_engagement` | 10 ● |
| `objections` | 5 ● |
| `call_flow` | 5 ● |
| `summarise` | 5 |
| `camera_on` | 5 ● |

### Use case discussion — 100 *(amended)*

| Theme | Wt | |
|---|---|---|
| `solutioning` | **20** | |
| `questions` | 15 | |
| `value` | 15 | |
| `research_agenda` | 10 | |
| `customer_engagement` | 10 ● | |
| `storytelling` | 5 | ← was 10 |
| `ai` | 5 | |
| `objections` | 5 ● | |
| `call_flow` | 5 ● | |
| `summarise` | 5 | |
| `camera_on` | 5 ● | ← added |

*Rationale:* storytelling carries less in a working session than in a demo. This is a whiteboard
conversation, not a performance.

### Trial setup — 100 *(amended)*

| Theme | Wt | |
|---|---|---|
| `exit_criteria_defined` | **20** | |
| `success_metrics_agreed` | 15 | |
| `admin_access_enablement` | 10 | ← was 15 |
| `stakeholder_mapping` | 10 | |
| `risk_identification` | 10 | |
| `customer_engagement` | 10 ● | |
| `cadence_checkpoints` | 5 | ← was 10 |
| `solutioning` | 5 | |
| `call_flow` | 5 ● | ← added |
| `objections` | 5 ● | ← added |
| `camera_on` | 5 ● | |

*Rationale:* exit criteria plus success metrics stay dominant at 35 of 100, which is the point of
this profile — a trial without agreed exit criteria is a trial that ends in silence.

### Troubleshooting — 100 *(amended)*

| Theme | Wt | |
|---|---|---|
| `problem_diagnosis` | **20** | |
| `technical_accuracy` | 15 | |
| `resolution_or_clear_path` | 15 | |
| `expectation_setting` | 10 | |
| `customer_reassurance` | 10 | |
| `escalation_handling` | 5 | ← was 10 |
| `documentation_followup` | 5 | ← was 10 |
| `customer_engagement` | 5 ● | ← added |
| `objections` | 5 ● | ← added |
| `call_flow` | 5 ● | |
| `camera_on` | 5 ● | |

*Note on the overlap:* `customer_reassurance` and `customer_engagement` stay separate keys.
Reassurance is specific to this profile — calming a customer who is already unhappy. Engagement
is the generic rapport-and-interaction theme shared across profiles, and it is what the spine
composite reads. Merging them would break the cross-type comparison.

*On `objections` here:* pushback on the diagnosis, the timeline, or the proposed fix.

### Q&A session — 100 *(unchanged)*

| Theme | Wt |
|---|---|
| `question_handling` | **25** |
| `technical_accuracy` | 20 |
| `objections` | 15 ● |
| `value` | 10 |
| `customer_engagement` | 10 ● |
| `call_flow` | 10 ● |
| `summarise` | 5 |
| `camera_on` | 5 ● |

● = core four, present in all eight profiles

---

## 3. Theme library — 38 themes

### Original sixteen *(from the Evaluation Blueprint)*

| Key | Definition | Source | Confidence |
|---|---|---|---|
| `research_agenda` | Preparation, customer context, structured flow | **Diff vs pre-call brief** | High |
| `questions` | Quality of discovery questions uncovering needs and pain | Transcript | High |
| `slide_deck` | Concise, engaging, aligned to customer priorities | Proxies only | **Low — flag it** |
| `cde_build` | Customer data/environment simulating real scenarios | Vision | Med-high |
| `solutioning` | Mapping features to specific customer challenges | Transcript | High |
| `storytelling` | Narrative resonating with the customer journey | Transcript | High |
| `call_flow` | Transitions, time management, logical sequencing | Share-track timestamps | High |
| `ai` | AI capability demonstrated and made relevant | Transcript | High |
| `value` | ROI and tangible benefit articulation | Transcript | High |
| `objections` | Handling tough questions and pushback | Transcript | High |
| `case_study_roi` | Real success stories with quantifiable results | Transcript | High |
| `comp_pitch` | Competitive positioning and differentiation | Transcript | High |
| `summarise` | Recap of key points, next steps, value delivered | Transcript | High |
| `camera_on` | Professional presence on video | Zoom video state, **sampled** | High — **never inferred from transcript** |
| `customer_engagement` | Rapport, interaction, keeping the session lively | Talk ratio, question count, cameras | High |
| `cta` | Clear next steps that drive momentum | Transcript | High |

### Twenty-two added by the newer profiles

| Key | Definition | Source |
|---|---|---|
| `technical_accuracy` | Statements about the product are correct and specific | Transcript |
| `architecture_fitment` | Mapped their actual stack, not a generic diagram | Transcript |
| `incumbent_competition` | Uncovered the current tool and who else is in play | Transcript / brief diff |
| `pain_qualification` | Quantified the pain — cost, time, headcount — not just named it | Transcript |
| `handover_discipline` | Gave the customer control and kept it there | Share track + transcript |
| `task_design` | Tasks were realistic, ordered, and achievable in the time | Transcript |
| `coaching_without_taking_over` | Guided without seizing the mouse or finishing sentences | Share track + transcript |
| `setup_framing` | Framed the exercise, its purpose, and what success looks like | Transcript |
| `observation_note_capture` | Captured what the customer struggled with, not just outcomes | Transcript + artifacts |
| `exit_criteria_defined` | Measurable, agreed, written down. "Try it out" scores zero | Transcript |
| `success_metrics_agreed` | Specific metrics with targets and owners | Transcript |
| `admin_access_enablement` | Who gets access, what training, by when | Transcript |
| `cadence_checkpoints` | Checkpoints scheduled, not "ping me if you need anything" | Transcript |
| `stakeholder_mapping` | Who decides, who blocks, who else is affected | Transcript |
| `risk_identification` | Named what could go wrong and who owns it | Transcript |
| `problem_diagnosis` | Established what is actually broken before theorising | Transcript |
| `resolution_or_clear_path` | Fixed it, or left a plan with an owner and a date | Transcript |
| `expectation_setting` | Honest timeline. No overpromising to calm the room | Transcript |
| `customer_reassurance` | Managed an unhappy customer's confidence without deflecting | Transcript + talk ratio |
| `escalation_handling` | Pulled in the right people at the right time | Transcript |
| `documentation_followup` | What was agreed is written down and sent | Transcript + artifacts |
| `question_handling` | Answered accurately, at the right depth, without bluffing | Transcript |

### Video dependency

Four themes cannot be scored without Pass 2 video. In the demo profile they carry **35 of 100**:

| Theme | Demo wt | Without video |
|---|---|---|
| `cde_build` | 10 | `applicable: false` |
| `call_flow` | 10 | `applicable: false` |
| `customer_engagement` | 10 | `applicable: false` |
| `camera_on` | 5 | `applicable: false` — spec §6.5 forbids transcript inference |

The denominator renormalises and `analysis_confidence` drops. Nothing is fabricated, and the SE is
told which themes could not be scored and why.

`handover_discipline` and `coaching_without_taking_over` degrade heavily without share-track data
but remain partially scoreable from transcript.

---

## 4. Anchors

Unanchored rubrics drift call to call and scores become noise. Every theme needs anchored levels.

**One anchor exists. Thirty-seven do not.** Where `anchors_json` is empty, the prompt must say so
and the line's confidence must be reduced. Do not let a model invent anchors.

### Worked example — `storytelling`

| Score | Anchor |
|---|---|
| **5** | Named personas across all three lenses (end user, agent, admin), set in the customer's own industry using their vocabulary, carried as one continuous thread through the demo |
| **4** | Two or three personas, industry-relevant, mostly sustained but drops in places |
| **3** | Personas named but generic ("a customer", "an agent"), or industry framing that doesn't persist past the opening |
| **2** | Occasional narrative gesture, mostly feature walkthrough |
| **1** | Pure feature tour — "here's the ticket list, here's the automation builder" |

> **Per-product persona sets.** In Freshservice the "user" is an employee, not a customer. An SE
> running the FD persona set at an ITSM buyer should lose points for it.

Writing the remaining thirty-seven is the highest-leverage unglamorous task in this build. It needs
the people who have been hand-scoring, not a model.

---

## 5. Scoring rules

- Each line emits `{ score 0..100, applicable, confidence, evidence[], coachingNote }`
- Evidence is **verbatim with a timestamp**. A score without one is a score the SE wins the
  argument about
- Coaching note: max 20 words, one specific action
- **Applicability is evidence-driven, not label-driven.** The profile sets which themes are in
  scope; evidence decides which of those count. No deck shared means `slide_deck` is not
  applicable regardless of call type
- Non-applicable themes render greyed with the reason, **never as a zero**
- Every displayed score carries its denominator and profile name
- Human override on every line, logged with original, override, who, when, reason — this is the
  only calibration signal you will ever get

---

## 6. Shadow mode

Eight profiles is eight calibration problems. Demo and discovery have hand-scored history behind
the rubric design; the other six have none, because nobody has ever graded them.

| Profile | Status |
|---|---|
| Demo | **Live** |
| Discovery | **Live** |
| Technical deep dive | Shadow |
| Reverse demo | Shadow |
| Use case discussion | Shadow |
| Trial setup | Shadow |
| Troubleshooting | Shadow |
| Q&A session | Shadow |

Shadow scores compute and store normally but display as `provisional` and are excluded from
averages, the coaching queue, the spine composite, and the team heatmap.

### Promotion gate — consistency plus volume

Shadow profile promotion was originally gated on hand-scored calibration. **That gate is
deferred.** The revised gate is **consistency plus volume**: the model must score the same
transcript the same way twice before anyone trusts the number.

Hand-scored comparison (`calibrate-lib.ts`) remains useful for anchor writing and drift
diagnosis; it is not a promotion prerequisite.

### Readiness report (per profile)

Before promoting, pull a readiness report for that call type. Existing tooling:

| Signal | Source | Notes |
|---|---|---|
| Calls scored in shadow | `scorecards` where `provisional: true` and `callType` matches | Need **~20** for the volume signal to mean anything |
| Worst theme SD | Latest **4.1′ run** (`worker/scripts/self-consistency.mjs`) | Per-profile max theme SD from the most recent Pass 3 repeatability batch |
| Composite SD | Same 4.1′ run | Per-call composite SD aggregated for the profile |
| Anchor coverage by **weight** | `worker/scripts/rubric-anchor-coverage.mjs` | An unanchored 20-point theme matters more than three unanchored 5-pointers |
| Dispute rate | `se-score-disputes` (local log today) | On provisional scores, once SEs can see them — track trend, not a single snapshot |
| Override rate and direction | `score_overrides` append-only log | Generous vs harsh bias before promotion |

### Ready when

All of the following for that profile:

- Composite SD **≤ 5** (see `THRESHOLDS.compositeSd` in `worker/src/consistency-lib.ts`)
- **No theme** in that profile with SD **> 15** (`THRESHOLDS.themeScoreSd.needsAnchor`)
- **~20 calls** scored in shadow
- Dispute rate **not trending up**

### Promotion and backfill

When a profile is ready:

1. **Report before acting** — count scorecards that will flip (`provisional: true → false`) and
   list affected SEs (via `ownerUserId` / call ownership). No silent backfill.
2. **Promote one profile at a time.** Flip `provisional: false` on that rubric row. Watch for a
   week. Six at once means you cannot tell which one broke trust.
3. **Log who promoted** — append to the rubric audit trail (who, when, prior readiness snapshot).
4. **Backfill** — re-run aggregation eligibility for stored scorecards on that profile so
   historical shadow scores enter averages, coaching queue, spine composite, and heatmap.
5. **Rollback path** — flip `provisional: true` back on the rubric row; re-exclude those
   scorecards from aggregates. Promotion is reversible without re-scoring.

Implementation: one boolean on the rubric row (`provisional`), one exclusion in every aggregation
query. Theme-level suppression (below) is separate from profile-level provisional.

### Live profiles are not automatically exempt

Demo and discovery ship live because they have hand-scored history **behind the rubric design**,
not because they are inherently consistent. Run **4.1′** against them too.

If any theme in a **live** profile comes back with SD **> 15**, **suppress that theme's display**
until it is anchored — grey the line with reason, never show a number the model cannot repeat.
Profile-level `provisional: false` does not override per-theme instability.

---

## 7. Seed shape

```json
{
  "rubrics": [
    { "id": "rub_...", "callType": "demo", "version": "1.0",
      "totalPoints": 100, "active": true, "provisional": false }
  ],
  "rubricThemes": [
    { "rubricId": "rub_...", "themeKey": "cde_build", "weight": 10,
      "anchorsJson": null, "requiresVideo": true, "coreFour": false },
    { "rubricId": "rub_...", "themeKey": "call_flow", "weight": 10,
      "anchorsJson": null, "requiresVideo": true, "coreFour": true }
  ]
}
```

Register `rubrics` and `rubric_themes` in `ENTITY_CATALOG.md`, `ID_STANDARDS.md`,
`RELATIONSHIPS.md` and `RBAC.md` before seeding.

---

## 8. Proposed, not applied

Flagged for your decision. **Do not implement without a call from Sathish or you.**

Three themes that explicitly reward admitting ignorance:

| Key | Would sit in | What it measures |
|---|---|---|
| `unknowns_handled` | Q&A, technical deep dive | "I don't know, I'll confirm by Thursday" scores full. Bluffing scores zero |
| `feasibility_honesty` | Use case discussion | Said no when it was a no. Didn't roadmap-deflect a real gap |
| `technical_risk` | Technical deep dive | Surfaced blockers honestly rather than "we can do that" |

The argument: `technical_accuracy` scores whether statements were correct, but nothing currently
scores whether the SE *knew they didn't know*. A rubric that rewards confident-sounding answers
trains SEs to bluff at customers, and the product-gap taxonomy already has a `se_didnt_know`
disposition — meaning the system will detect the behaviour on the gap side while the scorecard
quietly rewards it.

Adding these means reweighting the affected profiles again, so it is a deliberate v1.1 decision,
not a patch.
