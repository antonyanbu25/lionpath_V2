---
title: QIP Scoring System
version: 2.1
status: Demo + Discovery locked · expansion catalog added (§8.9–§8.19) · golden-set pass + discovery incident N/A
supersedes: QIP_PROFILES.md v1.0, QIP_SCORING_V2.md v2.0
owner: Nivi
last_updated: 2026-09-03
schema_stable: true
---

# QIP Scoring System — v2.1

One score per call, out of 10. Built honestly from what the SE did, weighted honestly by what mattered in the call. No 0–100 pretending to be finer than it is. No blended composites across call types. No category weights invented on top of theme weights. One lever, one scale, defensible from the sub-parameter all the way up to the star at the top of the scorecard.

This document is both the **specification** for humans and the **source of truth** for calculation code. Every profile carries a `yaml` block that a parser can consume directly. The schema is defined in Appendix A. Nothing in this document is decorative — every table has a matching machine-readable block.

---

## Table of Contents

0. [Design principles — the six perspectives](#0-design-principles)
1. [What changed from v1.0 → v2.1](#1-what-changed)
2. [Architecture — three layers, one lever](#2-architecture)
3. [The math](#3-the-math)
4. [The five categories](#4-the-five-categories)
5. [Credit assignment method](#5-credit-assignment)
6. [Themes measure habits · flags catch incidents](#6-habits-vs-incidents)
7. [What v2.1 deliberately does not do](#7-non-goals)
8. [Profiles](#8-profiles)
   - 8.1 Demo
   - 8.2 Discovery
   - 8.3 Technical deep dive
   - 8.4 Reverse demo
   - 8.5 Use case discussion
   - 8.6 Trial setup
   - 8.7 Troubleshooting
   - 8.8 Q&A session
   - 8.9 Demo — Plan Upgrade (expansion)
   - 8.10 Discovery (expansion)
   - 8.11 Technical deep dive (expansion)
   - 8.12 Reverse demo (expansion)
   - 8.13 Use case discussion (expansion)
   - 8.14 Trial setup (expansion)
   - 8.15 Troubleshooting (expansion)
   - 8.16 Q&A session (expansion)
   - 8.17 Churn mitigation & retention (expansion)
   - 8.18 AI Vision Demo (expansion)
   - 8.19 Demo — Cross sell (expansion)
9. [Theme vocabulary — canonical definitions](#9-vocabulary)
10. [Sample computation walkthrough](#10-walkthrough)
11. [Practical guidance by role](#11-role-guidance)
12. [Open items](#12-open-items)

Appendix A: [JSON Schema for profile validation](#appendix-a-schema)
Appendix B: [Reference parser (pseudocode)](#appendix-b-parser)
Appendix C: [Sanity check test cases](#appendix-c-tests)

---

## 0. Design principles {#0-design-principles}

This spec is written to serve six perspectives at once. Each principle names the perspective it protects.

**Engineer** — Deterministic. Given the same inputs (per-sub-parameter scores) and the same profile, the code returns exactly the same overall QIP. No hidden state, no randomness, no floating-point sensitivity beyond the last decimal. Every profile has a machine-parseable definition in this document.

**Manager** — Coaching-actionable. A low score points to a specific sub-parameter with a written definition and a place to timestamp evidence. Nothing in the number is opaque — a manager holding this scorecard can walk into a 1:1 and say "on this call, at 34:12, the SE did X. The sub-parameter says Y. Here's what to try next time."

**SE** — Transparent. Every SE can reconstruct their own score on a napkin: `Σ(grade × credit) ÷ Σ(credit)`. If they disagree with a sub-parameter score, they point to the transcript and argue about the evidence, not about the math. No hidden weights, no unexplained adjustments, no black-box models above the score.

**Leader** — Behaviorally aligned. The credits reflect what actually determines whether calls advance deals. Doubling a theme's credit means "we care about this twice as much" — not "the model happens to see this more clearly." The scorecard drives the right SE behavior because it measures the right things.

**FDE** — Pragmatic. The scorecard cannot represent every failure mode. Catastrophic single events go to a separate flag lane (§6) rather than being force-fit into the credit system. Themes that depend on video have `requires_video: true` and gracefully degrade with reduced confidence when video isn't available.

**Solution Architect** — Composable. Adding a theme to a profile is a one-line change — credit assigned, sub-parameters written, denominator updates automatically. Adding a new profile is a new YAML block. Theme keys are portable across profiles (same meaning, potentially different credit). The system extends without rewrites.

---

## 1. What changed from v1.0 → v2.1 {#1-what-changed}

v1.0 (`QIP_PROFILES.md`) worked hard to make eight profiles comparable. It tried to force four "core" themes into every profile so a cross-type composite existed. It scored themes 0–100 against 5-level anchors, which is 21 fake gradations pretending to be 5 real ones. It let denominators renormalise per call (no deck shown → shrink the total), which quietly rewarded SEs for skipping things they were bad at. And it treated every "weighting" as a global reshuffle — adding one theme meant reweighting every profile.

v2.1 collapses those problems into four decisions:

| Decision | v1.0 | v2.1 |
|---|---|---|
| Score scale | 0–100 per theme | 0–10 per theme, built from five 0/1/2 sub-parameter checks |
| Weighting | Per-profile weights summing to 100 | Credit 3/2/1 per theme, per profile |
| Cross-type comparison | Forced through four shared themes | Handled at the category layer — same five categories everywhere |
| Category role | None (categories didn't exist) | Display and diagnosis only — no separate weight |

The result: theme grades are portable across profiles (an SE's `objections` grade means the same thing in a demo and a Q&A), credits are local (that same theme is credit 3 in demo, maybe credit 2 in discovery), and adding a theme is a one-line change — no reweighting cascade.

**v2.0 → v2.1 changes:** All six remaining profiles now have full sub-parameter definitions. Machine-readable YAML blocks added per profile. Theme vocabulary consolidated in §9. Appendices A/B/C added to support implementation.

**v2.1 expansion catalog (2026-09-01):** Eleven expansion profiles transcribed from *Expansion SE Framework (final)*. YAML `motion` field added. New theme keys: `microstory`, `ai_readiness_fit`, `ai_solutioning`. Spreadsheet nits fixed in transcription: Q&A `camera_on` SP2 filled with the standard camera line; Churn `research` SP2 (was a camera copy-paste) replaced with a CSM/renewal research check.

**Discovery incident applicability (2026-09-02):** On discovery (new-business and expansion), `objections` / `comp_pitch` / `case_study` are incident-shaped: if that moment never occurred, the theme is `evidence_unavailable` (UI N/A, out of the denominator). A 0 stays in the denominator only when the incident happened and the SE fumbled it. Habit themes are unchanged. Demo and other call types stay on the default rule (absent → 0, stays in denom). Storytelling removed from NB discovery (was credit 1; total credits 33 → 32).

**Three LLM passes + golden set (2026-09-03):** Production scoring is first score → verifier → human golden-set calibration (`scorecard-calibrate.ts`). The third pass is on by default (`SCORECARD_GOLDEN_PASS`); set `0` to skip. Seed examples live in `worker/src/postcall/golden-set/`; add more calls via `tools/import-qip-golden-xlsx.py`. A category whose every child theme is N/A is `null` (UI N/A), not 0. **Existing scorecards must be re-analysed** to pick this up. Reviewer note: [BRANCH_QIP_CALIBRATION.md](./BRANCH_QIP_CALIBRATION.md).

---

## 2. Architecture {#2-architecture}

### Three layers, one lever

```
Sub-parameter (0/1/2)  ←  where evidence lands
      ↓  sum of five
Theme grade (0–10)     ←  how well the SE did
      ↓  × credit (3/2/1)
Contribution           ←  what it did to the score
      ↓  Σ ÷ Σcredits
Overall QIP (0–10)     ←  the star at the top
```

The credit is the only lever that varies per profile. Everything else is either input (sub-parameters) or output (grade, contribution, category score, overall).

### Why five sub-parameters at 0/1/2

Five checks × three states (absent / partial / done well) generates every integer from 0 to 10, and each integer is *earned* by a specific evidence-bearing check rather than plucked from a rubric of feels. A model can score five well-defined 0/1/2 checks consistently across runs. It cannot tell a 7 from an 8 on a 0–100 scale, and neither can a human.

Sub-parameters must be genuinely independent — no check can be automatic given another. If SP1 is "the SE told a story" and SP2 is "the story was good," you've punished the same miss twice. The five must move separately.

### Why credit 3/2/1

Because the question that sets credit only has three answers (see §5).

### Why no category weights

Because it would be a second lever doing the same job as the first, and the two would compound in ways nobody can defend. Under a two-stage system, a credit-3 theme in a "small" category ends up worth less than a credit-3 theme in a "big" one — the credit number stops meaning one thing across the scorecard, which is the exact disease v2.0 was curing.

Categories exist to *read* the scorecard, not to weight it.

---

## 3. The math {#3-the-math}

### Theme grade
```
grade = SP1 + SP2 + SP3 + SP4 + SP5      (each 0/1/2 → grade 0–10)
```

### Contribution
```
contribution = grade × credit
```

### Category score
```
category = Σ(grade × credit) ÷ Σ(credit)      within the category
```

### Overall QIP
```
overall = Σ(grade × credit) ÷ Σ(credit)      across all themes
        = total grade-points ÷ total credits
```

**Never** compute overall as an average of category scores. Compute it straight from the themes. If categories are themselves credit-weighted internally, the two routes give the same number anyway — categories are a display layer, not a math layer.

### Applicability

A theme is **applicable** to a call if the profile includes it AND evidence exists in the transcript/video to score it. If a habit theme is genuinely non-applicable (e.g., `slide_deck` on a demo where no deck was shown), the SE receives a 0 for that theme, weighted by its credit. This is deliberate:

- Every call in the same profile has the same denominator for *habits*
- SEs cannot game the system by skipping themes they're bad at
- Low-credit themes for edge-case applicability mean the score penalty is small

If evidence for a theme genuinely cannot be gathered from the available inputs (e.g., video-dependent theme with no video), the theme is marked `evidence_unavailable: true` and excluded from the denominator, with the overall score's confidence lowered accordingly. This is different from a scored miss.

**Discovery exception (incident-shaped themes).** On discovery profiles (new-business and expansion), `objections`, `comp_pitch`, and `case_study` measure incidents, not habits. If the transcript has no objection / competitor moment / case study told, those themes are marked `evidence_unavailable` (UI N/A, out of the denominator). A 0 stays in the denominator only when the incident DID happen and the SE fumbled it. Habit themes (questions, pain, summarise, CTA, research, stakeholder mapping, etc.) are unchanged: absent → 0, stays in denominator. Demo and other call types stay on the default rule (absent → 0, stays in denom). This is the same `evidence_unavailable` path as `camera_on` / `requires_video`, with a discovery-specific N/A reason so the UI does not say "no video."

---

## 4. The five categories {#4-the-five-categories}

Same five in every profile. Themes underneath change; credits underneath change. Category names and definitions never do.

**Discovery and qualification** — Did the SE diagnose before prescribing? Quality of questioning, depth of pain uncovered, and how well they mapped the technical environment, use cases, decision criteria, and stakeholders. The tell: listening-to-talking ratio, and whether the questions got sharper as the call went on rather than flatter.

**Solution demonstration and technical fit** — Was the demo built around their discovered pain, or a feature parade on autopilot? Judge tailoring, technical accuracy, relevance of the workflows shown, and the tell-show-tell discipline of tying every capability back to something the customer actually said.

**Business value and outcome articulation** — Did they connect capability to consequence — ROI, KPIs, time saved, risk removed — or stop at "here's what the button does"? This is the line between a demo and a business case.

**Technical credibility and objection handling** — How they fielded the hard questions, edge cases, competitive jabs, and the "can it do X?" moments. Honesty about limitations counts for more than a slick dodge here; trust is the actual product an SE sells.

**Communication, engagement and call control** — Clarity and pacing, reading the room, keeping multiple stakeholders in the tent, and landing crisp next steps that advance the opportunity. A brilliant call that ends on "we'll circle back" just leaked all its energy.

Categories are the layer that makes cross-type comparison honest. An SE's Business Value score means the same thing across a demo, a discovery call and a QBR — because the category means the same thing even when the themes underneath differ.

The category identifiers used in machine-readable blocks:

| Category | Machine key |
|---|---|
| Discovery and qualification | `discovery_qualification` |
| Solution demonstration and technical fit | `solution_technical_fit` |
| Business value and outcome articulation | `business_value` |
| Technical credibility and objection handling | `credibility_objections` |
| Communication, engagement and call control | `communication_control` |

---

## 5. Credit assignment {#5-credit-assignment}

For every theme in every profile, one question sets the credit:

> **If the SE completely bombed this one theme, what happens to the call?**
>
> - The call failed. Nothing else rescues it. → **credit 3**
> - The call is weaker, but it survived. → **credit 2**
> - It's a polish note. → **credit 1**

That's the whole method. Same question asked for every theme in every profile — the answer changes because the call type changes.

### Why not more tiers

Widening credits to 5/3/1 or beyond has a tiny effect on any single theme's share of the score (the denominator inflates too) and a big effect on how defensible each credit is. Three tiers gives a one-sentence answer to any SE who challenges a weight. Ten tiers gives an opinion.

The big lever for making a theme actually carry a call is **fewer themes**, not fatter credits.

---

## 6. Themes measure habits · flags catch incidents {#6-habits-vs-incidents}

The scorecard measures behaviour that recurs — habits worth coaching. It cannot represent single catastrophic events. If an SE stated something flatly untrue at 34:12, taking `technical_accuracy` from 8 to 0 moves the overall from ~8.0 to ~7.4 on a 34-credit profile. A call that killed the deal scores a seven. That's not a tuning failure, it's arithmetic — weighted averages structurally dilute single events.

The answer is not a fatter credit. The answer is a **flag lane**, separate from the score:

**Deal risk log** — captures discrete events during the call:
- Factual claims that need verifying by product or engineering
- Commitments made outside remit (pricing, roadmap, contract terms)
- Missing stakeholders or process gaps surfaced but not addressed
- Legal, compliance, or security statements requiring review

The log doesn't touch the number. It goes to the SE and the AE. Someone confirms or clears each item within the week. This runs alongside the QIP the way the product-gap taxonomy does — same instrument, two outputs.

The distinction:

> **Habits** recur across calls, vary by SE, can be coached → **theme** (grade + credit)
>
> **Incidents** happened once, at a specific timestamp, need verification → **flag** (deal risk log)

Any future theme proposal that's really an incident in disguise goes to the flag lane instead of bloating the theme list.

On **discovery** only, three existing themes are themselves incident-shaped (`objections`, `comp_pitch`, `case_study`). They stay on the scorecard so a fumbled pushback still costs credit, but they are `evidence_unavailable` when the moment never occurred — see §3.

---

## 7. What v2.1 deliberately does not do {#7-non-goals}

Named here so they don't creep back in.

**No dual composites.** v1.0 had a "type composite" (weighted, within one profile) and a "spine composite" (unweighted, across the core four). v2.1 has one number per call, plus the star profile — the five category scores read together — for cross-type comparison.

**No two-stage weighting.** Category weights on top of theme weights would make a credit-3 theme mean different things depending on which category it's in. Categories are display only.

**No renormalising denominators for skipped habits.** In v1.0, if `slide_deck` was non-applicable, its weight came out of the denominator — quietly rewarding SEs bad at slide decks. v2.1 uses low credit (1) for habit themes that might not apply, and scores absence as 0 in the denominator. The allowed shrink is `evidence_unavailable` only: video themes with no recording, and discovery incident themes (`objections`, `comp_pitch`, `case_study`) when that moment never occurred. Those shrink the denominator because the SE could not be scored, not because they skipped a habit.

**No 0–100 scale.** A number pretending to be finer than the underlying anchors is noise dressed as precision. Sub-parameters are 0/1/2. Themes are 0–10. Categories are 0–10. Overall is 0–10. One scale from bottom to top.

**No forced cross-profile shared themes.** v1.0's "core four" was scaffolding to make cross-type composites computable. v2.1 doesn't need it; the category layer does that job cleanly.

**No hidden model adjustments.** If the scorer applies any confidence discount, moderation, or normalization, it must be visible on the scorecard with a stated reason. No silent adjustment ever.

---

## 8. Profiles {#8-profiles}

Each profile below has:
1. A prose intro naming its personality
2. A category × theme × credit table for humans
3. Sub-parameters written out for each theme
4. A machine-readable YAML block that parsers should consume

**Convention:** Sub-parameters may vary slightly across profiles (e.g., `customer_engagement` sets a higher bar in discovery). Where sub-parameters differ from the "reference" definition in §9, both the profile and the vocabulary section acknowledge the variance.

**Motion:** Every profile YAML block includes `motion: new_business` or `motion: expansion`. New-business profiles are §8.1–§8.8. Expansion profiles are §8.9–§8.19. Shared keys (e.g. `discovery`) are the same theme vocabulary with **different credits and sub-parameters** — scorecards must persist `seMotion` so composites never blend the two.

---

### 8.1 Demo {#8-1-demo}

**Personality:** A performance built around a discovered pain. The SE is validating what they heard in discovery through a tailored environment, tying every capability back to something the customer said, and closing on a next step that advances the deal.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 3 |
| Solution demonstration and technical fit | CDE / Build | 2 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | AI | 2 |
| Solution demonstration and technical fit | Slide Deck | 1 |
| Business value and outcome articulation | Value (ROI) | 3 |
| Business value and outcome articulation | Case Study | 2 |
| Technical credibility and objection handling | Objections | 3 |
| Technical credibility and objection handling | Comp Pitch | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Storytelling | 2 |
| Communication, engagement and call control | Summarise | 2 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 34**

```yaml
profile:
  key: demo
  motion: new_business
  name: Demo
  version: 2.1
  total_credits: 34
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Account, industry and role referenced specifically"
        - "Something from public signal used (funding, launch, hire, news)"
        - "Current stack or incumbent known before being asked"
        - "Named person on the call addressed with context, not generically"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Open-ended questions used, not just yes/no confirms"
        - "Questions got sharper as the call went on, not flatter"
        - "At least one question uncovered something not in the brief"
        - "Follows up meaningfully with clarifying questions"
        - "Silence was allowed; the SE didn't fill every pause"
    - key: cde_build
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Environment carried the customer's language — ticket types, categories, product names"
        - "Data volume and shape resembled theirs, not the default sandbox"
        - "At least one workflow shown was one they had described"
        - "Integrations or channels visible matched their stack"
        - "Nothing on screen contradicted what was said in discovery"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Each capability tied to a specific pain the customer named"
        - "Tell-show-tell — framed before, demonstrated, tied back after"
        - "Features not relevant to their use case were skipped, not paraded"
        - "Trade-offs acknowledged where fit was imperfect"
        - "At least one moment landed as 'that solves X for us,' not narration"
    - key: ai
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "AI shown solving a customer problem — Freddy Self-Service and Freddy Co-Pilot both demonstrated"
        - "Mechanics explained honestly — where it draws from, what it can't do"
        - "ROI or time saved was concrete, not 'faster'"
        - "Data, privacy or model questions pre-empted, not dodged"
        - "Integrated into the flow, not bolted on as a separate act"
    - key: slide_deck
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "The deck was tailored — logo, industry, name of the account somewhere"
        - "Slides advanced the argument, not filler between demos"
        - "Time on slides proportionate — not more than 15 minutes cumulative"
        - "Complex visuals were walked, not read"
        - "Deck ended on something memorable, not 'thank you'"
    - key: value
      credit: 3
      category: business_value
      sub_parameters:
        - "Value quantified — hours, headcount, tickets, revenue — not adjectival"
        - "Numbers were the customer's or clearly benchmarked, not invented"
        - "At least one metric tied to the champion's KPI, not just company-wide"
        - "Time-to-value addressed, not just eventual value"
        - "Value language used at least three times across the call, not once"
    - key: case_study
      credit: 2
      category: business_value
      sub_parameters:
        - "Reference was industry-adjacent or size-adjacent to the customer"
        - "A specific number was cited, not 'significant improvement'"
        - "Story had a named company with a slide, or an honest NDA placeholder"
        - "Parallel to customer's situation drawn explicitly"
        - "Told at moment of relevance, with good storytelling"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "The hard question was heard, not deflected or reframed"
        - "The answer engaged the specific concern, not a nearby easier one"
        - "Limitations named where they existed, not glossed"
        - "Roadmap used only where genuine, not as a shield"
        - "Pushback landed somewhere — acknowledged, parked with a date, or resolved"
    - key: comp_pitch
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "The specific competitor in the deal was addressed, not 'the market'"
        - "Differentiation was concrete, not adjective-based"
        - "At least one point framed from customer outcome, not feature comparison"
        - "Their tool treated with respect, not mocked"
        - "A trap or landmine planted for the next competitive conversation"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Call opened with agenda and check on time"
        - "Transitions between sections signposted, not abrupt"
        - "Time managed — no rushed last ten minutes"
        - "Detours bounded — parked or resolved, not sprawled"
        - "Call ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer talked at least a third of the time"
        - "Their name and words used back to them across the call"
        - "Multiple stakeholders in the room addressed, not just the loudest"
        - "Reactions read — pace or depth adjusted mid-flight"
        - "At least one moment of genuine back-and-forth, not monologue-and-nod"
    - key: storytelling
      credit: 2
      category: communication_control
      sub_parameters:
        - "A narrative frame was set at the top, not a feature list"
        - "Personas named and specific, not 'a user'"
        - "Customer's industry and vocabulary carried through the story"
        - "The thread was sustained past the opening"
        - "Landed on business outcome, not workflow"
    - key: summarise
      credit: 2
      category: communication_control
      sub_parameters:
        - "Key points recapped, not just next steps"
        - "What the customer said was reflected back, not only what the SE showed"
        - "Value restated in the customer's language"
        - "Open questions surfaced, not buried"
        - "Summary brief — under two minutes, not a second demo"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "A specific next step was proposed, not 'let's stay in touch'"
        - "It had an owner and a date, not just a verb"
        - "Advanced the deal — POC, stakeholder intro, security review"
        - "Customer confirmed verbally or in meeting"
        - "Captured in writing before the call ended or immediately after"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.2 Discovery {#8-2-discovery}

**Personality:** The call where you diagnose. Questioning, listening, and pain quantification are load-bearing. Solutioning and showing anything is the *sin* — the sin is doing them at all when they should be doing 70% of the talking.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 3 |
| Discovery and qualification | Questions | 3 |
| Discovery and qualification | Pain Qualification | 3 |
| Discovery and qualification | Incumbent Competition | 2 |
| Discovery and qualification | Stakeholder Mapping | 2 |
| Solution demonstration and technical fit | Solutioning | 1 |
| Solution demonstration and technical fit | AI | 1 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Business value and outcome articulation | Case Study | 1 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Comp Pitch | 1 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 3 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 32**

Incident-shaped themes on this profile (`objections`, `comp_pitch`, `case_study`) are N/A when the moment never occurred — see §3.

```yaml
profile:
  key: discovery
  motion: new_business
  name: Discovery
  version: 2.1
  total_credits: 32
  themes:
    - key: research
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Account, industry and role referenced specifically"
        - "Something from public signal used (funding, launch, hire, news)"
        - "Current stack or incumbent hypothesized before being asked"
        - "Named person on call addressed with context, not generically"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Open-ended questions used, not just yes/no confirms"
        - "Questions got sharper as call went on, not flatter"
        - "At least one question uncovered something not in the brief"
        - "Follows up meaningfully with clarifying questions"
        - "Silence was allowed; SE didn't fill every pause"
    - key: pain_qualification
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Pain was quantified — cost, time, headcount, tickets, revenue at risk"
        - "The consequence of not solving it was drawn out, not just the symptom"
        - "The customer's own words for the pain were captured, not paraphrased into product-speak"
        - "Multiple angles of the pain were probed — where does it hurt, who, how often"
        - "Pain was tied to something they already care about (KPI, initiative)"
    - key: incumbent_competition
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "The current tool was named specifically, not 'a legacy system'"
        - "What they like about it was uncovered, not just complaints"
        - "Who else is being evaluated was surfaced honestly"
        - "Buying process and timeline was mapped, not assumed"
        - "Switching cost and inertia was acknowledged, not dismissed"
    - key: stakeholder_mapping
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "The champion vs decision-maker vs blocker distinction was drawn"
        - "Names of people not on the call were captured"
        - "The buying committee's motivations were probed, not assumed"
        - "Risks — who could kill this deal — were identified"
        - "A path to reach absent stakeholders was agreed"
    - key: solutioning
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Where a capability naturally fit, it was gestured at, not paraded"
        - "Nothing was over-promised — 'let me confirm and come back' over 'sure we can'"
        - "The pattern-match to their world was made explicit ('this sounds like X we solve for...')"
        - "Tangents into product weren't allowed to derail discovery"
        - "What was mentioned in passing was noted for the follow-up demo"
    - key: ai
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "AI was mentioned in context of a pain they described, not as a headliner"
        - "It was framed as a capability to explore, not sold"
        - "Their existing AI stack or attitude was probed"
        - "Data or trust concerns were welcomed, not deflected"
        - "It didn't dominate airtime relative to core pain"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Value framed as hypothesis to test, not proof to accept"
        - "Their metrics were the anchor, not generic ROI stats"
        - "Time-to-value set up as an eventual conversation, not answered"
        - "Success criteria for a POC or trial were seeded"
        - "Value language tied to the champion's KPI at least once"
    - key: case_study
      credit: 1
      category: business_value
      sub_parameters:
        - "If used, the reference was industry-adjacent or size-adjacent"
        - "Used to draw them out ('does that sound familiar?'), not to close"
        - "Didn't crowd out their story"
        - "A named company or an honest NDA placeholder"
        - "Brief — under two minutes"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Concerns were welcomed and probed, not batted away"
        - "Answers acknowledged what was true about the objection first"
        - "Limitations were named where they existed, not glossed"
        - "Nothing was resolved with roadmap that shouldn't have been"
        - "Pushback landed somewhere — acknowledged, parked, or resolved"
    - key: comp_pitch
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "If it came up, the specific competitor was named"
        - "Differentiation was concrete, not adjectival"
        - "Their existing tool was treated with respect"
        - "It was defensive, not aggressive"
        - "It didn't derail into a competitive teardown"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with agenda and check on time"
        - "Transitions signposted"
        - "Time managed — no rushed last ten minutes"
        - "Detours bounded"
        - "Ended when it said it would, or renegotiated explicitly"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "The customer talked at least two-thirds of the time"
        - "Their name and words used back to them"
        - "Multiple stakeholders in the room were addressed"
        - "Reactions read and pace adjusted"
        - "At least one moment of genuine back-and-forth"
    - key: summarise
      credit: 3
      category: communication_control
      sub_parameters:
        - "Their pain was recapped in their words, not the SE's"
        - "What was learned about stakeholders and process was noted"
        - "Value hypotheses were named as hypotheses to test"
        - "Open questions and unknowns were surfaced honestly"
        - "Under two minutes, and they nodded"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "A specific next step was proposed (demo scheduled, stakeholder intro, data ask)"
        - "Owner and date, not just a verb"
        - "It advanced the deal"
        - "Customer confirmed verbally"
        - "Captured in writing"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.3 Technical deep dive {#8-3-tech-deep-dive}

**Personality:** Architects and engineers on the customer side probe the platform for fit with their stack, security, scalability, and extensibility. The failure mode is bluffing — this audience will detect it and lose faith in everything else. Technical accuracy and architectural fitment matter more than storytelling or business value.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 2 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | CDE / Build | 3 |
| Solution demonstration and technical fit | Technical Accuracy | 3 |
| Solution demonstration and technical fit | Architecture Fitment | 3 |
| Solution demonstration and technical fit | AI | 2 |
| Business value and outcome articulation | Value (ROI) | 1 |
| Technical credibility and objection handling | Objections | 3 |
| Technical credibility and objection handling | Comp Pitch | 1 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 2 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 32**

```yaml
profile:
  key: technical_deep_dive
  motion: new_business
  name: Technical deep dive
  version: 2.1
  total_credits: 32
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Customer's tech stack researched — languages, cloud, key vendors"
        - "Existing integrations and data flows understood before the call"
        - "Named engineers or architects on the call addressed with context"
        - "Recent technical announcements from customer surfaced (blog, GitHub, conference)"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Technical questions probed depth, not just surface"
        - "Non-functional requirements surfaced (scale, latency, availability, compliance)"
        - "Edge cases and failure modes explored, not just happy paths"
        - "Follow-ups asked when answers were incomplete"
        - "Silence allowed while they thought — SE didn't rush to fill it"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Each capability tied to a specific technical requirement they named"
        - "Trade-offs were named — what the design chose over what"
        - "Extension points and customization were shown, not just default paths"
        - "Multi-tenant, isolation, and permissions handled with specifics"
        - "At least one moment landed as 'that matches how we work,' not narration"
    - key: cde_build
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Environment reflected their scale — data volumes, user counts, integration surface"
        - "APIs, webhooks, or custom code visible in the demo, not just UI"
        - "Real data shapes present (not Lorem Ipsum), matching their domain"
        - "Configuration state matched what a customer of their maturity would run"
        - "Nothing on screen contradicted architectural claims"
    - key: technical_accuracy
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Statements about how features work were correct and specific"
        - "Numbers cited (rate limits, throughput, SLAs, uptime) were accurate, not ballpark"
        - "Where the SE didn't know, they said so and committed to confirm"
        - "Product terminology matched documentation, not colloquial approximations"
        - "No positioning claims (integrations, capabilities) that would fail on inspection"
    - key: architecture_fitment
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Their actual stack was diagrammed or referenced, not a generic architecture"
        - "Data flows in and out of Freshworks were mapped, not implied"
        - "Integration mechanisms (APIs, webhooks, native connectors) matched their existing tools"
        - "Non-functional requirements (scale, latency, uptime) addressed with specifics"
        - "Deployment model (hosting, region, isolation) aligned with their compliance needs"
    - key: ai
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Model architecture, training data, and inference path were explained honestly"
        - "Data residency and privacy handling addressed with specifics"
        - "Fine-tuning, RAG, and BYOM options positioned accurately"
        - "Failure modes and hallucination handling explained, not deflected"
        - "Integration points for their AI stack surfaced (MCP, APIs, model choice)"
    - key: value
      credit: 1
      category: business_value
      sub_parameters:
        - "Technical benefits were tied to business outcomes at least once"
        - "Total cost of ownership addressed, not just license cost"
        - "Operational overhead (maintenance, upgrades) named honestly"
        - "Time-to-implementation was realistic, not aspirational"
        - "Value language present but not dominant — audience was technical"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Hard technical questions engaged head-on, not deflected"
        - "Limitations named where they existed, with specifics"
        - "Roadmap used only where committed, with realistic timelines"
        - "Alternative approaches or workarounds offered when direct path was blocked"
        - "Pushback landed — acknowledged, engineered around, or parked with an owner"
    - key: comp_pitch
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "If competitors came up, technical differentiation was specific, not marketing-speak"
        - "Where they matched, honesty was preferred to hedging"
        - "Their tool was treated with technical respect"
        - "Comparisons focused on capability, not vendor politics"
        - "SE didn't derail into a competitive teardown"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with agenda and check on time"
        - "Transitions between topics signposted"
        - "Deep dives bounded so all planned topics got covered"
        - "Time managed for questions — not everything crammed into last five minutes"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Engineers on the call were addressed by name and role"
        - "Silence from quieter engineers was invited, not steamrolled"
        - "Reactions read — technical concerns pursued when they surfaced"
        - "Multiple stakeholders' concerns balanced, not just the loudest voice"
        - "At least one moment of genuine technical back-and-forth"
    - key: summarise
      credit: 2
      category: communication_control
      sub_parameters:
        - "Technical decisions and open questions recapped clearly"
        - "Commitments to confirm named with owners and dates"
        - "Architectural choices from the discussion reflected back"
        - "Concerns raised by the customer surfaced in the summary"
        - "Under two minutes, and technical audience nodded"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "Specific next step proposed — POC scope, architecture review, security questionnaire"
        - "Owner and date named on both sides"
        - "Technical artifacts to share (docs, sandbox access) committed with timelines"
        - "Confirmed by the customer, not just proposed"
        - "Captured in writing with technical specificity"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.4 Reverse demo {#8-4-reverse-demo}

**Personality:** The customer drives; the SE observes and coaches. Taking the mouse back is the failure mode. This isn't a demo, it's a test — of the product's usability and of the SE's coaching discipline.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Observation Note Capture | 3 |
| Solution demonstration and technical fit | Task Design | 3 |
| Solution demonstration and technical fit | Setup Framing | 2 |
| Business value and outcome articulation | Value (ROI) | 1 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Coaching Without Taking Over | 3 |
| Communication, engagement and call control | Handover Discipline | 3 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 3 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 28**

```yaml
profile:
  key: reverse_demo
  motion: new_business
  name: Reverse demo
  version: 2.1
  total_credits: 28
  themes:
    - key: observation_note_capture
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Points of struggle noted in real time, not reconstructed"
        - "Positive discoveries captured too — what excited them"
        - "Questions they asked during the exercise logged"
        - "Non-verbal signals (frustration, hesitation) noted"
        - "Notes shared or referenced in the summary, not held privately"
    - key: task_design
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Tasks were realistic — drawn from workflows they actually run"
        - "Difficulty appropriate — not too easy, not too advanced"
        - "Ordering built from simple to complex, not random"
        - "Each task had a clear success criterion — they knew when it was done"
        - "Total time was achievable in the session, not rushed at the end"
    - key: setup_framing
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Purpose of the exercise was framed clearly at the start"
        - "Ground rules stated — they'd drive, SE would observe, questions welcome"
        - "Environment and permissions checked before starting, not mid-task"
        - "What 'success' looks like for the session was named"
        - "Time expectations set — how long, what happens at the end"
    - key: value
      credit: 1
      category: business_value
      sub_parameters:
        - "Value framing bookended the session, not squeezed mid-flow"
        - "Their words about pain or ease were reflected back when relevant"
        - "Value language present but sparse — this is not a value pitch"
        - "Business outcomes referenced when a task validated one"
        - "No hard ROI selling during hands-on time"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Concerns about the tool during hands-on welcomed, not defended against"
        - "Genuine friction acknowledged, not spun"
        - "Limitations named where the customer bumped into them"
        - "Workarounds offered where honest, not as cover for gaps"
        - "Pushback captured for follow-up, not batted away"
    - key: coaching_without_taking_over
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Guidance was verbal and open-ended — 'what would you try next?', not 'click there'"
        - "Silence was allowed when they were thinking, not filled"
        - "Corrections happened after attempts, not before"
        - "Praise was specific, not generic ('good job')"
        - "When they got stuck, SE offered a hint before revealing the answer"
    - key: handover_discipline
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer had control of screen and mouse from the start"
        - "SE didn't grab back control when a task stalled"
        - "When SE demonstrated, it was declared and time-boxed, not sneaked"
        - "Multiple customer users got hands-on if present, not just one"
        - "SE stayed off camera focus when unnecessary — no talking over their thinking"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with framing and time check"
        - "Task transitions signposted"
        - "Time per task managed — struggling tasks bounded, not sprawled"
        - "Reserved time for reflection and Q&A at the end"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Multiple customer users had hands-on time, not just one dominant user"
        - "Their reactions during tasks were read and acknowledged"
        - "SE checked in between tasks — 'how did that feel?'"
        - "Silences during their thinking were respected, not filled"
        - "Energy in the room stayed engaged — no glazed eyes"
    - key: summarise
      credit: 3
      category: communication_control
      sub_parameters:
        - "What they struggled with was named clearly, not glossed"
        - "What excited them was named clearly, not just wins"
        - "Their words used back in the recap"
        - "Open questions and things to test next were captured"
        - "Under three minutes, and they added or corrected"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "Next step tied to what surfaced in the exercise, not generic"
        - "Owner and date named"
        - "Documentation or config help committed with a timeline"
        - "Customer confirmed the plan verbally"
        - "Captured in writing"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on for the framing and debrief portions"
        - "Camera state supported observation, not disrupted the customer's flow"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees on camera during framing and debrief"
```

---

### 8.5 Use case discussion {#8-5-use-case}

**Personality:** A whiteboard-style working session, not a performance. The customer describes a use case; the SE maps it to the platform in real time, gestures at trade-offs, and probes for what the customer isn't saying. Storytelling matters less than in a demo — this is thinking out loud together.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 3 |
| Discovery and qualification | Pain Qualification | 2 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | CDE / Build | 1 |
| Solution demonstration and technical fit | AI | 2 |
| Business value and outcome articulation | Value (ROI) | 3 |
| Business value and outcome articulation | Case Study | 1 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Comp Pitch | 1 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Storytelling | 1 |
| Communication, engagement and call control | Summarise | 2 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 31**

```yaml
profile:
  key: use_case_discussion
  motion: new_business
  name: Use case discussion
  version: 2.1
  total_credits: 31
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Prior use cases the customer flagged were remembered, not asked again"
        - "Their industry-specific workflows understood before the call"
        - "Public signal about the account referenced where relevant"
        - "Named people addressed with role context"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Questions probed how the use case is done today, not just what they want"
        - "Edge cases and exceptions surfaced, not just the happy path"
        - "Metrics for the use case explored — volume, frequency, criticality"
        - "Who owns the use case and who depends on it was uncovered"
        - "Silence allowed when they were thinking through the workflow"
    - key: pain_qualification
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "The specific pain within the use case quantified, not just described"
        - "Consequence of the current approach named — cost, delay, error rate"
        - "Their own words for the frustration captured"
        - "Frequency of the pain established — daily, weekly, edge case"
        - "Tied to a KPI or initiative if one existed"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Platform capability mapped to their exact use case, not a nearby one"
        - "Trade-offs of different approaches named — not just 'we can do this'"
        - "Configuration or customization needed was explicit"
        - "Where the fit was imperfect, honesty preferred to hedging"
        - "At least one moment landed as 'yes, that's exactly it,' not narration"
    - key: cde_build
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "If shown, environment matched the use case being discussed"
        - "Data or config resembled what their reality would look like"
        - "Nothing shown contradicted what was said"
        - "Screens supported the conversation, didn't hijack it"
        - "The whiteboard or diagram tool used matched the working-session tone"
    - key: ai
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "AI positioned honestly within the use case — where it helps, where it doesn't"
        - "Which AI capability (self-service, co-pilot, agents) tied to this use case named specifically"
        - "Data flow and privacy for AI on this use case addressed"
        - "Time and effort savings were concrete, not aspirational"
        - "Their existing AI approach for this use case probed"
    - key: value
      credit: 3
      category: business_value
      sub_parameters:
        - "Business outcome of solving this use case named — revenue, cost, risk"
        - "Metrics tied to the champion's KPIs, not company-wide"
        - "Time-to-value for this use case addressed, not just eventual value"
        - "ROI framed with their numbers or explicit benchmarks"
        - "Value language reinforced across the conversation, not once"
    - key: case_study
      credit: 1
      category: business_value
      sub_parameters:
        - "If referenced, the case was industry-adjacent and use-case-adjacent"
        - "Specific numbers cited"
        - "Named company or honest NDA placeholder"
        - "Parallel to their use case drawn explicitly"
        - "Brief — used to reinforce, not to close"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Concerns about the fit engaged head-on, not deflected"
        - "Where the use case exceeded platform capability, that was named"
        - "Roadmap used only where committed, with realistic dates"
        - "Workarounds offered honestly, not as cover"
        - "Pushback landed — acknowledged, parked, or resolved"
    - key: comp_pitch
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "If a competitor came up in the use case, specific comparison was made"
        - "Differentiation was concrete for this use case, not generic"
        - "Their current approach treated with respect"
        - "Defensive, not aggressive"
        - "Didn't derail the working session into a competitive pitch"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with framing of what the session was for"
        - "Transitions between use cases or facets signposted"
        - "Time managed — didn't sprawl on one facet at the cost of others"
        - "Detours captured for follow-up, not chased forever"
        - "Ended when it said it would, or renegotiated"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer talked at least half the time — this is a working session"
        - "Their words and diagrams used back to them"
        - "Multiple stakeholders on the call brought in"
        - "Reactions read — pace or direction adjusted when they went quiet"
        - "At least one moment of genuine collaboration, not presentation"
    - key: storytelling
      credit: 1
      category: communication_control
      sub_parameters:
        - "If stories used, they served the use case, not the SE's performance"
        - "Personas specific to their world"
        - "Industry language carried through"
        - "Stories brief — supporting, not dominating"
        - "Landed on business outcome relevant to the use case"
    - key: summarise
      credit: 2
      category: communication_control
      sub_parameters:
        - "The use case as understood was recapped in the customer's words"
        - "Solution approach and trade-offs recapped honestly"
        - "Open questions and things to confirm surfaced"
        - "Next actions tied to the use case, not generic"
        - "Under two minutes, and they nodded or corrected"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "Next step tied to advancing this specific use case"
        - "Owner and date named"
        - "POC scope or confirmation ask made concrete"
        - "Customer confirmed the next step verbally"
        - "Captured in writing"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.6 Trial setup {#8-6-trial-setup}

**Personality:** Where the deal either advances or dies in silence. A trial without agreed exit criteria is a trial that ends in silence. Success metrics, stakeholder ownership, and cadence carry the call. Solutioning barely appears — that work is done. This call is about accountability.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 2 |
| Discovery and qualification | Pain Qualification | 2 |
| Discovery and qualification | Stakeholder Mapping | 2 |
| Solution demonstration and technical fit | Solutioning | 1 |
| Solution demonstration and technical fit | Exit Criteria Defined | 3 |
| Solution demonstration and technical fit | Success Metrics Agreed | 3 |
| Solution demonstration and technical fit | Admin Access Enablement | 2 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Risk Identification | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Cadence Checkpoints | 2 |
| Communication, engagement and call control | Summarise | 3 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 33**

```yaml
profile:
  key: trial_setup
  motion: new_business
  name: Trial setup
  version: 2.1
  total_credits: 33
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Prior discovery and demo context remembered, not asked again"
        - "Customer's use cases understood before the call"
        - "Named stakeholders addressed with role context"
        - "Any technical or organizational constraints from prior calls acknowledged"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Questions confirmed what success looks like, not just what to build"
        - "Constraints (technical, organizational, timeline) probed explicitly"
        - "Assumptions from earlier calls verified, not carried over"
        - "Silent stakeholders on the call invited into the conversation"
        - "Follow-ups asked when answers were vague"
    - key: pain_qualification
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "The pain the trial is meant to solve was reconfirmed with numbers"
        - "Consequence of trial failure named — what happens if this doesn't work"
        - "Customer's words for what 'good' looks like captured"
        - "Frequency and criticality of the target use case verified"
        - "Tied to a KPI or initiative the customer already owns"
    - key: stakeholder_mapping
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Champion, decision-maker, blocker, and end-user roles named"
        - "Names of people who need to sign off but aren't on the call captured"
        - "Buying committee's incentives and worries surfaced"
        - "Deal-killer risks named — who could stop this and why"
        - "Path to absent stakeholders agreed"
    - key: solutioning
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Solutioning happened only where trial scope needed clarification"
        - "No new capabilities introduced — trial focused on what was scoped"
        - "Trade-offs re-acknowledged where relevant"
        - "Deferred conversations noted for post-trial"
        - "The call wasn't derailed by 'while we're here, can we also...'"
    - key: exit_criteria_defined
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Criteria are measurable — a number, a state, a demonstrated behavior"
        - "Both success AND failure paths are named — what a 'no' looks like"
        - "Criteria agreed by the champion, not just proposed by the SE"
        - "Written down, not just discussed"
        - "Criteria are specific to this customer, not templated"
    - key: success_metrics_agreed
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Each metric has a target — a number, not 'improved'"
        - "Each metric has an owner on the customer side, named"
        - "Baseline is captured — where they are today, not just aspirational"
        - "Metrics tie to business outcomes, not vanity numbers"
        - "Timeframe agreed for each metric — by when, not 'eventually'"
    - key: admin_access_enablement
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Who gets admin access is named, not 'the team'"
        - "Training scheduled with dates, not 'we'll figure it out'"
        - "Data and integration setup owners identified"
        - "Timeline to full enablement is realistic, not aspirational"
        - "Contingency named if the admin blocks or leaves"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Concerns about trial scope, timing, or resources engaged head-on"
        - "Trade-offs of the agreed scope acknowledged, not glossed"
        - "Timeline uncertainty named honestly, not overpromised"
        - "Trial success requires customer effort — that was communicated, not hidden"
        - "Pushback landed — parked with owner or resolved"
    - key: risk_identification
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Top risks named — technical, organizational, timing"
        - "Each risk has an owner — who watches for it, not 'we'll monitor'"
        - "Mitigation plan exists for each material risk"
        - "Trigger conditions specified — what signals the risk is materializing"
        - "Killer risks that would end the trial are explicit, not hidden"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with agenda and expected outcomes of the call"
        - "Transitions between setup topics signposted"
        - "Time managed — every planned item got covered"
        - "Detours parked for follow-up, not chased"
        - "Ended when it said it would, with a clear plan"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Multiple stakeholders on the call contributed"
        - "Champion's voice not the only one heard"
        - "Concerns from end-user or admin surfaced"
        - "Reactions read — pace adjusted when energy dropped"
        - "At least one moment of genuine agreement or negotiation"
    - key: cadence_checkpoints
      credit: 2
      category: communication_control
      sub_parameters:
        - "Checkpoint frequency set — weekly, biweekly, not 'check in'"
        - "First checkpoint has a date and calendar invite"
        - "Attendees for checkpoints named on both sides"
        - "What each checkpoint covers agreed — usage, blockers, questions"
        - "Escalation path if checkpoints slip is named"
    - key: summarise
      credit: 3
      category: communication_control
      sub_parameters:
        - "Exit criteria, success metrics, and timelines recapped clearly"
        - "Owners on both sides named again in the recap"
        - "Risks and open items surfaced"
        - "Customer's confirmation on the plan captured"
        - "Under three minutes, and they nodded or added"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "Immediate next actions named with owner and date"
        - "First checkpoint scheduled during the call, not 'we'll find a time'"
        - "Access and enablement steps confirmed with a start date"
        - "Written summary committed to be sent within 24 hours"
        - "Customer confirmed the plan verbally"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.7 Troubleshooting {#8-7-troubleshooting}

**Personality:** Different animal. The customer is worried or unhappy. Diagnosis and honesty carry the call; overpromising to calm the room makes it worse. Business value doesn't appear — this is not the moment.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 2 |
| Discovery and qualification | Problem Diagnosis | 3 |
| Solution demonstration and technical fit | Technical Accuracy | 3 |
| Solution demonstration and technical fit | Resolution or Clear Path | 3 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Expectation Setting | 3 |
| Technical credibility and objection handling | Escalation Handling | 2 |
| Communication, engagement and call control | Customer Reassurance | 2 |
| Communication, engagement and call control | Documentation Followup | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 2 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 33**

```yaml
profile:
  key: troubleshooting
  motion: new_business
  name: Troubleshooting
  version: 2.1
  total_credits: 33
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Ticket, prior interactions, and account context reviewed before the call"
        - "Recent changes to the customer's environment known if available"
        - "Named people on the call addressed with context, not generically"
        - "Prior escalations or unresolved issues from the account known"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Questions targeted the problem, not tangents"
        - "Reproducibility explicitly probed — one-time, intermittent, or consistent"
        - "Recent changes on the customer's side surfaced — what changed before it broke"
        - "Impact scope confirmed — who's affected, how many users"
        - "Follow-ups asked when answers were incomplete"
    - key: problem_diagnosis
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Symptoms separated from causes — what happened vs why"
        - "Reproducibility tested — one-time, intermittent, or consistent"
        - "Recent changes surfaced — what changed before it broke"
        - "Impact quantified — who's blocked, how many users, revenue at risk"
        - "Diagnosis completed before proposing fixes"
    - key: technical_accuracy
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Statements about how the product works were correct"
        - "Log messages, error codes, and behavior described accurately"
        - "Where SE didn't know, they said so — no bluffing"
        - "Terminology matched documentation, not colloquial"
        - "Any workaround or fix path was accurately described"
    - key: resolution_or_clear_path
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "If resolved on call, verification was done — not just 'should be fixed'"
        - "If not resolved, next step has an owner and a date"
        - "Root cause explained, not just the fix — so it doesn't recur"
        - "Workarounds provided if the full fix will take time"
        - "Follow-up communication plan agreed"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Customer pushback on the diagnosis engaged, not defended against"
        - "Timeline objections acknowledged, not glossed"
        - "Where the customer contributed to the issue, that was said gently but honestly"
        - "Alternative resolution paths offered when the primary was rejected"
        - "Pushback landed — acknowledged, escalated, or resolved"
    - key: expectation_setting
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Realistic timelines given, not optimistic ones"
        - "Uncertainty acknowledged where it existed"
        - "Trade-offs of different fix paths explained"
        - "What the customer needs to do vs what the SE will do — clear"
        - "No overpromising to calm the room"
    - key: escalation_handling
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Right escalation path identified — product, engineering, support"
        - "Escalation initiated on the call if warranted, not 'I'll ask'"
        - "What the escalated team needs was captured — logs, screenshots, repro"
        - "SLA on escalation response was communicated"
        - "SE stayed in the loop as the customer's advocate, not handed off"
    - key: customer_reassurance
      credit: 2
      category: communication_control
      sub_parameters:
        - "Customer's frustration acknowledged, not deflected"
        - "What is being done, right now, was communicated"
        - "Customer was not blamed, even when they contributed to the issue"
        - "Confidence expressed without being dismissive of impact"
        - "A human, not a script — the SE was present in the conversation"
    - key: documentation_followup
      credit: 2
      category: communication_control
      sub_parameters:
        - "What was diagnosed and agreed was written up, not just said"
        - "Sent to the customer within an agreed timeframe"
        - "Contains reproduction steps if the issue recurs"
        - "Names the owner for next steps clearly"
        - "Referenced by ticket ID or record for continuity"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with acknowledgment of the issue and framing of the call"
        - "Diagnosis and resolution phases signposted"
        - "Time managed — call didn't sprawl on diagnosis at the cost of resolution"
        - "Detours parked, not chased"
        - "Ended when it said it would, with a clear plan"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Customer was heard — their frustration acknowledged verbally"
        - "Technical folks on the customer side were invited to contribute"
        - "SE didn't monologue diagnostic thinking — customer stayed in the loop"
        - "Reactions read — pace or direction adjusted when concerns showed"
        - "At least one moment of collaborative diagnosis"
    - key: summarise
      credit: 2
      category: communication_control
      sub_parameters:
        - "Diagnosis, resolution or path forward, and owners recapped"
        - "Timeline for follow-up named"
        - "Customer's original concerns addressed in the recap"
        - "Any open items or verifications surfaced"
        - "Under two minutes, and customer confirmed"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "Specific next step named — what happens next and when"
        - "Owner on the Freshworks side named, not just 'we'll get back'"
        - "Documentation and follow-up commitment with timeline"
        - "Customer confirmed the plan verbally"
        - "Captured in writing referenced to ticket ID"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.8 Q&A session {#8-8-qna-session}

**Personality:** Focused format. Customer asks; SE answers. Bluffing is the single failure mode — this audience is here to detect it. Question handling, technical accuracy, and objection quality carry the call. Everything else is decoration.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Solution demonstration and technical fit | Solutioning | 2 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Technical credibility and objection handling | Question Handling | 3 |
| Technical credibility and objection handling | Technical Accuracy | 3 |
| Technical credibility and objection handling | Objections | 3 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 2 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 25**

```yaml
profile:
  key: qna_session
  motion: new_business
  name: Q&A session
  version: 2.1
  total_credits: 25
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Prior questions or open items from the customer were remembered"
        - "The customer's known priorities were kept in mind"
        - "Named people on the call addressed with context"
        - "Their industry and use cases informed the framing of answers"
        - "Prep showed in the framing of answers, not retrofitted later"
    - key: solutioning
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Where a question warranted a capability walkthrough, it was crisp and tied to their context"
        - "Trade-offs named honestly, not spun"
        - "Configuration or customization implications were flagged when relevant"
        - "Where the fit was imperfect, it was named"
        - "Answers didn't sprawl into unrelated capability tours"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Where value questions came up, answers cited concrete outcomes"
        - "Numbers were the customer's or clearly benchmarked"
        - "Time-to-value addressed if asked"
        - "Business impact tied to the specific capability being discussed"
        - "Value language present where relevant, not forced everywhere"
    - key: question_handling
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Questions answered accurately, not confidently-adjacent"
        - "Answers at the right depth — not too shallow, not lecturing"
        - "Where the SE didn't know, they said so — no bluffing"
        - "Complex questions broken into parts, not answered in one blob"
        - "Follow-up commitments (data, docs, confirmation) captured"
    - key: technical_accuracy
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Statements about how features work were correct and specific"
        - "Numbers cited (rate limits, SLAs, capacity) were accurate"
        - "Where the SE didn't know, they said so and committed to confirm"
        - "Product terminology matched documentation"
        - "No positioning claims that fail on inspection"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Hard questions engaged head-on, not deflected"
        - "Answers engaged the specific concern, not a nearby easier one"
        - "Limitations named where they existed, not glossed"
        - "Roadmap used only where committed"
        - "Pushback landed — acknowledged, parked, or resolved"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with framing of what the Q&A would cover"
        - "Transitions between questions were smooth, not abrupt"
        - "Time managed — questions weren't rushed at the end"
        - "SE didn't let one question dominate at the cost of others"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Multiple askers were invited — not just the loudest"
        - "Follow-up questions welcomed and answered"
        - "Silent participants brought in with light invitations"
        - "Reactions read — depth adjusted mid-flight"
        - "At least one moment of genuine back-and-forth"
    - key: summarise
      credit: 2
      category: communication_control
      sub_parameters:
        - "Key themes from the Q&A recapped, not just the last question"
        - "Follow-up commitments and owners named"
        - "Open items or unresolved questions surfaced"
        - "Customer's concerns addressed in the summary"
        - "Under two minutes, and audience nodded"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "Specific next step named — follow-up docs, meeting, POC scope"
        - "Owner and date named for each commitment"
        - "Confirmed by the customer verbally"
        - "Captured in writing"
        - "Advances the deal, not just 'we'll be in touch'"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```


New-business profiles above are unchanged in math. Each YAML block now carries `motion: new_business`. Expansion profiles below are a **separate catalog** — same theme keys where they overlap, different credits and sub-parameters. Never blend overall QIP across motions.

---

### 8.9 Demo — Plan Upgrade {#8-9-demo-plan-upgrade}

**Motion:** expansion

**Personality:** A positioning demo on a live account: the SE is selling a plan upgrade against actual usage, open tickets, and the champion’s KPI — not a first-time tour of the platform.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Account & Usage Context | 1 |
| Solution demonstration and technical fit | CDE / Build | 1 |
| Solution demonstration and technical fit | Solutioning | 2 |
| Solution demonstration and technical fit | AI | 3 |
| Solution demonstration and technical fit | Slide Deck | 1 |
| Business value and outcome articulation | Value | 3 |
| Business value and outcome articulation | Microstory | 2 |
| Technical credibility and objection handling | Objections | 3 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 24**

```yaml
profile:
  key: demo_plan_upgrade
  motion: expansion
  name: Demo — Plan Upgrade
  version: 2.1
  total_credits: 24
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Current product usage and adoption level referenced specifically — modules live, user count, volume"
        - "Known product issues or open tickets on the account acknowledged before being raised by the customer"
        - "Usage or health data reviewed before the call, not learned on the fly"
        - "Named stakeholder on the call addressed with context, not generically"
        - "Prep showed in the framing of the demo's opening, not retrofitted later"
    - key: cde_build
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Environment reflects the customer's industry, not a generic sandbox"
        - "Data and terminology recognizable to their world, even if not their exact instance"
        - "Setup was fit for a positioning demo — not over-built for the time available"
        - "Nothing on screen contradicted what's known about their actual account"
        - "Environment was ready before the call started, no live setup fumbling"
    - key: solutioning
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Each feature shown tied to a specific expansion opportunity, not a generic tour"
        - "Tell-show-tell used even briefly — framed, shown, tied back"
        - "Features irrelevant to their current usage were skipped, not paraded"
        - "At least one moment landed as 'that would help us,' not narration"
        - "Demo stayed proportionate to a positioning call, not a rebuild of the whole platform"
    - key: ai
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Every Freddy AI capability relevant to their plan or usage was shown, not just one"
        - "Mechanics explained honestly — where it draws from, what it can't do"
        - "ROI or time saved was concrete and tied to their own usage, not generic"
        - "Data, privacy, or model questions were pre-empted, not dodged"
        - "AI was positioned as the primary expansion hook of the call, not a footnote"
    - key: slide_deck
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Deck was tailored — logo, industry, or account name somewhere"
        - "Slides supported the value story, not filler between demo screens"
        - "Time on slides proportionate — a few minutes, not the majority of the call"
        - "Complex visuals were walked, not read"
        - "Deck ended on the expansion ask, not 'thank you'"
    - key: value
      credit: 3
      category: business_value
      sub_parameters:
        - "Value quantified — hours, tickets, cost, headcount — not adjectival"
        - "Numbers anchored to their own usage or clearly benchmarked"
        - "At least one value point tied to the champion's or admin's actual KPI"
        - "Value framed as what expansion adds, not just what they already have"
        - "Value language repeated at least twice across the call, not once"
    - key: microstory
      credit: 2
      category: business_value
      sub_parameters:
        - "Brief — under 30 seconds, not a slide-backed case study"
        - "A specific number or outcome cited, not 'significant improvement'"
        - "Industry- or size-adjacent to the customer"
        - "Told at the exact moment it reinforced a feature just shown"
        - "Didn't stall the demo's pace — in and out, not lingered on"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Frustration about existing product issues acknowledged first, not argued with"
        - "The specific issue raised was engaged, not deflected to 'the team is aware'"
        - "A path to resolution or a status update was given, not just sympathy"
        - "Limitations were named honestly where they existed"
        - "The conversation was steered back to expansion value, not left on the complaint"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Call opened with a clear purpose — positioning, not a generic check-in"
        - "Transitions between features signposted, not abrupt"
        - "Time managed — no rushed final minutes"
        - "Product-issue detours bounded, not allowed to consume the call"
        - "Call ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer talked at least a third of the time, even without formal discovery"
        - "Their name and known usage referenced back to them"
        - "Multiple stakeholders on the call addressed, not just the loudest"
        - "Reactions read — pace or depth adjusted mid-flight"
        - "At least one moment of genuine back-and-forth, not monologue-and-nod"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Key expansion opportunities recapped, not just features shown"
        - "Value points restated in the customer's language"
        - "Any open product concerns surfaced, not buried"
        - "Next step tied to the expansion opportunity discussed"
        - "Summary brief — under two minutes"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "A specific next step proposed — feature trial, follow-up, or approval ask"
        - "It had an owner and a date, not just a verb"
        - "Advanced the expansion — not 'let's stay in touch'"
        - "Customer confirmed verbally"
        - "Captured in writing before or immediately after the call"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and professional framing"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.10 Discovery {#8-10-exp-discovery}

**Motion:** expansion

**Personality:** Expansion discovery. The SE is mapping a new pain or adjacent use case on an account that already runs the product, using CSM context and usage data rather than public-signal cold prep.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 3 |
| Discovery and qualification | Incumbent / Competition | 1 |
| Discovery and qualification | Stakeholder Mapping | 1 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | AI | 2 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Business value and outcome articulation | Case Study | 1 |
| Technical credibility and objection handling | Objections | 3 |
| Technical credibility and objection handling | Comp Pitch | 1 |
| Communication, engagement and call control | Call Flow | 3 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 2 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 27**

Incident-shaped themes on this profile (`objections`, `comp_pitch`, `case_study`) are N/A when the moment never occurred — see §3.

```yaml
profile:
  key: discovery
  motion: expansion
  name: Discovery
  version: 2.1
  total_credits: 27
  themes:
    - key: research
      credit: 3
      category: discovery_qualification
      sub_parameters:
        - "Current usage, adoption level, and modules live on the account reviewed before the call"
        - "Health score, ticket history, or renewal timeline pulled from CSM records, not asked cold"
        - "Prior expansion conversations or shelved upsell/cross-sell asks remembered"
        - "Named stakeholder on the call addressed with context — role, tenure with product, past interactions"
        - "Prep showed in the framing of the opening, not retrofitted later"
    - key: incumbent_competition
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "The tool or workaround currently used for the adjacent need was named specifically, not assumed"
        - "What they like about that workaround was uncovered, not just its gaps"
        - "Any parallel evaluation of a point solution or competitor for this use case surfaced honestly"
        - "Switching or consolidation cost onto the existing platform was acknowledged, not dismissed"
        - "Budget owner and buying process for the expansion were mapped, not assumed to mirror the original deal"
    - key: stakeholder_mapping
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Champion vs. economic buyer vs. blocker for the expansion distinguished — often different from the original deal's"
        - "New stakeholders introduced by growth (new team, new region, new use case owner) were captured by name"
        - "CSM's existing relationship map was used and built on, not rebuilt from scratch"
        - "Risk to the expansion — budget freeze, reorg, competing priority — was identified"
        - "A path to reach stakeholders not on the call was agreed with the CSM"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Where a capability naturally fit the new pain, it was gestured at, not paraded"
        - "Nothing over-promised — \"let me confirm and come back\" over \"sure, that's included\""
        - "The pattern-match to their world was explicit, anchored in what they already run in the product"
        - "Tangents into a full platform tour weren't allowed to derail the expansion-specific discovery"
        - "What was mentioned in passing was logged for the follow-up demo"
    - key: ai
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "AI was mentioned only where it mapped to a pain just described, not as a headliner"
        - "Their current Freddy usage or attitude toward AI (if any modules are live) was checked first"
        - "It was framed as a capability to explore, not sold"
        - "Data, privacy, or trust questions were welcomed, not deflected"
        - "It didn't dominate airtime relative to the core expansion pain"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Value framed as a hypothesis to test against the new pain, not proof to accept"
        - "Their own usage data or account metrics anchored the value story, not generic ROI stats"
        - "Time-to-value for the expansion was set up as a conversation, not answered outright"
        - "Success criteria for a pilot or expansion trial were seeded"
        - "Value language tied to the champion's or admin's KPI at least once"
    - key: case_study
      credit: 1
      category: business_value
      sub_parameters:
        - "If used, the reference was an account that expanded from a similar starting footprint"
        - "Used to draw them out — \"does that path sound familiar?\" — not to close"
        - "Didn't crowd out their own story"
        - "A named account or an honest anonymized placeholder"
        - "Brief — under two minutes"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Concerns about cost, timing, or \"we're not using what we already have\" were welcomed, not batted away"
        - "Answers acknowledged what was true about the objection first"
        - "Underused modules or adoption gaps were named honestly, not glossed over"
        - "Nothing resolved with roadmap that shouldn't have been"
        - "Pushback landed somewhere — acknowledged, parked, or resolved"
    - key: comp_pitch
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "If a point solution or competitor came up for the adjacent use case, it was named specifically"
        - "Differentiation was concrete — why consolidating on the existing platform beats a bolt-on tool"
        - "Their current workaround was treated with respect"
        - "It was defensive, not aggressive"
        - "It didn't derail into a competitive teardown"
    - key: call_flow
      credit: 3
      category: communication_control
      sub_parameters:
        - "Opened with agenda and time check, framed as an expansion conversation, not a check-in"
        - "Transitions signposted"
        - "Time managed — no rushed last ten minutes"
        - "Detours into support issues or open tickets bounded, not chased"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer talked at least two-thirds of the time"
        - "Their name, usage patterns, and words used back to them"
        - "Multiple stakeholders in the room addressed, not just the loudest"
        - "Reactions read and pace adjusted"
        - "At least one moment of genuine back-and-forth"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "New pain recapped in the customer's words, not the SE's"
        - "What was learned about stakeholders, budget, and timing was noted"
        - "Value hypotheses named as hypotheses to test, tied to expansion"
        - "Open questions and unknowns surfaced honestly"
        - "Under two minutes, and they nodded"
    - key: cta
      credit: 2
      category: communication_control
      sub_parameters:
        - "A specific next step proposed — expansion demo, pilot scope, stakeholder intro, or business case"
        - "Owner and date named, not just a verb"
        - "It advanced the expansion, coordinated with the CSM's account plan"
        - "Customer confirmed verbally"
        - "Captured in writing, and shared with the CSM"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees (CSM included) also on camera"
```

---

### 8.11 Technical deep dive {#8-11-exp-tech-deep-dive}

**Motion:** expansion

**Personality:** A technical working session on how a new module or higher scale lands on the customer’s existing configuration — integrations, tenancy, and what must not break.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 1 |
| Discovery and qualification | Questions | 1 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | CDE / Build | 2 |
| Solution demonstration and technical fit | Technical Accuracy | 3 |
| Solution demonstration and technical fit | AI | 3 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Comp Pitch | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 26**

```yaml
profile:
  key: technical_deep_dive
  motion: expansion
  name: Technical deep dive
  version: 2.1
  total_credits: 26
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Customer's current configuration, integrations, and scale on the platform reviewed before the call"
        - "New technical requirement driving the expansion (new system, higher volume, new region) understood in advance"
        - "Named engineers or architects on the call addressed with context from prior tickets or calls"
        - "Recent technical changes on their side (migration, new vendor, org change) surfaced from CSM notes"
        - "Prep showed in the first five minutes, not retrofitted later"
    - key: questions
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Technical questions probed the specific gap driving the expansion ask, not generic capability"
        - "Non-functional requirements for the new use case surfaced — scale, latency, compliance"
        - "Edge cases specific to how they already run the platform were explored, not generic ones"
        - "Follow-ups asked when answers about the new requirement were incomplete"
        - "Silence allowed while they thought it through"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Each capability tied to the specific expansion requirement they named, not a platform tour"
        - "Trade-offs named — what the new configuration chooses over what they run today"
        - "Extension points or customization for the new use case shown, not just default paths"
        - "How the new module interacts with their existing setup (permissions, data model, tenancy) handled with specifics"
        - "At least one moment landed as \"that solves it without disrupting what we have,\" not narration"
    - key: cde_build
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Environment reflected their actual account — existing config, data shapes, integration surface"
        - "APIs, webhooks, or custom code relevant to the expansion shown, not just UI"
        - "Real data resembling their domain used, not a generic sandbox"
        - "Configuration state matched what a customer of their maturity and current usage would run"
        - "Nothing on screen contradicted what they already have live"
    - key: technical_accuracy
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Statements about how the new capability interacts with their current setup were correct and specific"
        - "Numbers cited (limits, throughput, SLAs) were accurate for their current plan/tier, not ballpark"
        - "Where the SE didn't know, they said so and committed to confirm"
        - "Product terminology matched documentation, not colloquial approximations"
        - "No positioning claims about the expansion that would fail on inspection"
    - key: ai
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Model architecture, training data, and inference path for the AI capability being added were explained honestly"
        - "Data residency and privacy handling addressed with specifics relevant to their existing setup"
        - "Fine-tuning, RAG, or BYOM options positioned accurately against what they already use"
        - "Failure modes and hallucination handling explained, not deflected"
        - "Integration points for their existing AI stack surfaced (MCP, APIs, model choice)"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Technical benefit of the expansion tied to a business outcome at least once"
        - "Total cost of the addition addressed, not just license cost, relative to what they already pay"
        - "Operational overhead (maintenance, upgrades) named honestly"
        - "Time-to-implementation for the expansion was realistic, not aspirational"
        - "Value language present but not dominant — audience was technical"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Hard technical questions about the expansion engaged head-on, not deflected"
        - "Limitations named where they existed, with specifics"
        - "Roadmap used only where committed, with realistic timelines"
        - "Alternative approaches offered when the direct path conflicted with their existing setup"
        - "Pushback landed — acknowledged, engineered around, or parked with an owner"
    - key: comp_pitch
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "If a point solution or competitor came up for the new use case, technical differentiation was specific"
        - "Where they matched, honesty was preferred to hedging"
        - "Their existing tool or workaround was treated with technical respect"
        - "Comparisons focused on capability, not vendor politics"
        - "Didn't derail into a competitive teardown"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with agenda and time check"
        - "Transitions between topics signposted"
        - "Deep dives bounded so all planned topics got covered"
        - "Time managed for questions"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Engineers on the call addressed by name and role"
        - "Silence from quieter engineers invited, not steamrolled"
        - "Reactions read — technical concerns pursued when they surfaced"
        - "Multiple stakeholders' concerns balanced, not just the loudest voice"
        - "At least one moment of genuine technical back-and-forth"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Technical decisions and open questions about the expansion recapped clearly"
        - "Commitments to confirm named with owners and dates"
        - "Architectural choices from the discussion reflected back"
        - "Concerns raised by the customer surfaced in the summary"
        - "Under two minutes, and the technical audience nodded"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Specific next step proposed — POC scope for the expansion, architecture review, security questionnaire"
        - "Owner and date named on both sides, including the CSM"
        - "Technical artifacts to share (docs, sandbox access) committed with timelines"
        - "Confirmed by the customer, not just proposed"
        - "Captured in writing with technical specificity"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.12 Reverse demo {#8-12-exp-reverse-demo}

**Motion:** expansion

**Personality:** The customer drives a new module or workflow. The SE observes, coaches without taking over, and ties the exercise to an expansion decision.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Observation & Note Capture | 1 |
| Solution demonstration and technical fit | Setup & Framing | 3 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Coaching Without Taking Over | 1 |
| Communication, engagement and call control | Handover Discipline | 1 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 17**

```yaml
profile:
  key: reverse_demo
  motion: expansion
  name: Reverse demo
  version: 2.1
  total_credits: 17
  themes:
    - key: observation_note_capture
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Points of struggle with the new module noted in real time, not reconstructed"
        - "Positive discoveries captured too — what excited them about the expansion feature"
        - "Questions they asked during the exercise logged"
        - "Non-verbal signals (frustration, hesitation) noted, especially where it touches their existing workflow"
        - "Notes shared or referenced in the summary, not held privately"
    - key: setup_framing
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Purpose of the exercise — evaluating the new module/use case — framed clearly at the start"
        - "Ground rules stated — they'd drive, SE would observe"
        - "Environment and permissions (including any sandbox tied to their real account) checked before starting"
        - "What \"success\" looks like for the expansion decision was named"
        - "Time expectations set — how long, what happens at the end"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Value framing bookended the session, not squeezed mid-flow"
        - "Their words about ease or friction with the new module reflected back when relevant"
        - "Value language present but sparse — this is not a value pitch"
        - "Business outcomes referenced when a task validated one"
        - "No hard ROI selling during hands-on time"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Concerns about the new module during hands-on welcomed, not defended against"
        - "Genuine friction with the new capability acknowledged, not spun"
        - "Limitations named where the customer bumped into them"
        - "Workarounds offered honestly, not as cover for gaps"
        - "Pushback captured for follow-up, not batted away"
    - key: coaching_without_taking_over
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "Guidance was verbal and open-ended, not \"click there\""
        - "Silence was allowed when they were thinking, not filled"
        - "Corrections happened after attempts, not before"
        - "Praise was specific, not generic"
        - "When they got stuck, SE offered a hint before revealing the answer"
    - key: handover_discipline
      credit: 1
      category: communication_control
      sub_parameters:
        - "Customer had control of screen and mouse from the start"
        - "SE didn't grab back control when a task stalled"
        - "When SE demonstrated, it was declared and time-boxed, not sneaked"
        - "Multiple customer users got hands-on time if present, not just one"
        - "SE stayed off camera focus when unnecessary"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with framing and time check"
        - "Task transitions signposted"
        - "Time per task managed — struggling tasks bounded, not sprawled"
        - "Reserved time for reflection and Q&A at the end, tied to the expansion decision"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Multiple customer users had hands-on time, not just one dominant user"
        - "Their reactions during tasks were read and acknowledged"
        - "SE checked in between tasks — \"how did that feel against what you do today?\""
        - "Silences during their thinking were respected, not filled"
        - "Energy in the room stayed engaged"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "What they struggled with on the new module was named clearly, not glossed"
        - "What excited them was named clearly, not just wins"
        - "Their words used back in the recap"
        - "Open questions and things to test next were captured, tied to the expansion decision"
        - "Under three minutes, and they added or corrected"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Next step tied to what surfaced in the exercise, not generic"
        - "Owner and date named, including the CSM"
        - "Documentation or config help committed with a timeline"
        - "Customer confirmed the plan verbally"
        - "Captured in writing"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on for the framing and debrief portions"
        - "Camera state supported observation, not disrupted the customer's flow"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees on camera during framing and debrief"
```

---

### 8.13 Use case discussion {#8-13-exp-use-case}

**Motion:** expansion

**Personality:** A working session on a new use case for an account that already has live workflows. Configuration impact on the existing setup is in scope; a platform tour is not.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 2 |
| Discovery and qualification | Pain Qualification | 1 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | CDE / Build | 1 |
| Solution demonstration and technical fit | AI | 1 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Business value and outcome articulation | Case Study | 1 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Comp Pitch | 1 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Storytelling | 1 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 24**

```yaml
profile:
  key: use_case_discussion
  motion: expansion
  name: Use case discussion
  version: 2.1
  total_credits: 24
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Prior use cases already live on the account were remembered, not asked again"
        - "The team or workflow behind the new use case understood before the call"
        - "Usage or health data relevant to adoption of the new use case reviewed"
        - "Named people addressed with role context"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Questions probed how the new use case is done today, not just what they want"
        - "Edge cases and exceptions surfaced, not just the happy path"
        - "Metrics for the use case explored — volume, frequency, criticality"
        - "Who owns the use case and who depends on it was uncovered"
        - "Silence allowed when they were thinking through the workflow"
    - key: pain_qualification
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "The specific pain within the new use case quantified, not just described"
        - "Consequence of the current approach named — cost, delay, error rate"
        - "Their own words for the frustration captured"
        - "Frequency of the pain established"
        - "Tied to a KPI or initiative if one existed, ideally one the CSM already tracks"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Platform capability mapped to their exact new use case, not a nearby one"
        - "Trade-offs of different approaches named"
        - "Configuration or customization needed made explicit, including impact on existing setup"
        - "Where the fit was imperfect, honesty preferred to hedging"
        - "At least one moment landed as \"yes, that's exactly it,\" not narration"
    - key: cde_build
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "If shown, environment matched the use case being discussed and their existing account"
        - "Data or config resembled what their reality would look like"
        - "Nothing shown contradicted what was said"
        - "Screens supported the conversation, didn't hijack it"
        - "The whiteboard or diagram tool used matched the working-session tone"
    - key: ai
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "AI positioned honestly within the new use case — where it helps, where it doesn't"
        - "Which AI capability (self-service, co-pilot, agents) ties to this use case named specifically"
        - "Data flow and privacy for AI on this use case addressed"
        - "Time and effort savings were concrete, tied to their own volume"
        - "Their existing AI approach or adoption elsewhere in the account probed"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Business outcome of solving this use case named — revenue, cost, risk"
        - "Metrics tied to the champion's or admin's KPIs, not company-wide"
        - "Time-to-value for this use case addressed"
        - "ROI framed with their numbers or explicit benchmarks"
        - "Value language reinforced across the conversation, not once"
    - key: case_study
      credit: 1
      category: business_value
      sub_parameters:
        - "If referenced, the case was industry- and use-case-adjacent, ideally an expansion story"
        - "Specific numbers cited"
        - "Named account or honest anonymized placeholder"
        - "Parallel to their use case drawn explicitly"
        - "Brief — used to reinforce, not to close"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Concerns about the fit engaged head-on, not deflected"
        - "Where the use case exceeded current plan or platform capability, that was named"
        - "Roadmap used only where committed, with realistic dates"
        - "Workarounds offered honestly, not as cover"
        - "Pushback landed — acknowledged, parked, or resolved"
    - key: comp_pitch
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "If a point tool or competitor came up in the use case, specific comparison was made"
        - "Differentiation was concrete for this use case, not generic"
        - "Their current approach treated with respect"
        - "Defensive, not aggressive"
        - "Didn't derail the working session into a competitive pitch"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with framing of what the session was for"
        - "Transitions between facets signposted"
        - "Time managed — didn't sprawl on one facet at the cost of others"
        - "Detours captured for follow-up"
        - "Ended when it said it would, or renegotiated"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Customer talked at least half the time — this is a working session"
        - "Their words and diagrams used back to them"
        - "Multiple stakeholders on the call brought in"
        - "Reactions read — pace or direction adjusted when they went quiet"
        - "At least one moment of genuine collaboration, not presentation"
    - key: storytelling
      credit: 1
      category: communication_control
      sub_parameters:
        - "If stories used, they served the use case, not the SE's performance"
        - "Personas specific to their world"
        - "Industry language carried through"
        - "Stories brief — supporting, not dominating"
        - "Landed on a business outcome relevant to the use case"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "The use case as understood was recapped in the customer's words"
        - "Solution approach and trade-offs recapped honestly"
        - "Open questions and things to confirm surfaced"
        - "Next actions tied to the use case, not generic"
        - "Under two minutes, and they nodded or corrected"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Next step tied to advancing this specific use case"
        - "Owner and date named, including the CSM"
        - "Pilot scope or confirmation ask made concrete"
        - "Customer confirmed the next step verbally"
        - "Captured in writing"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.14 Trial setup {#8-14-exp-trial-setup}

**Motion:** expansion

**Personality:** Scoping a trial of an expansion module: exit criteria, success metrics, admin enablement, and checkpoints — jointly owned with the CSM.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 1 |
| Discovery and qualification | Questions | 1 |
| Discovery and qualification | Stakeholder Mapping | 1 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Solution demonstration and technical fit | Exit Criteria Defined | 2 |
| Solution demonstration and technical fit | Success Metrics Agreed | 2 |
| Solution demonstration and technical fit | Admin Access & Enablement | 1 |
| Technical credibility and objection handling | Objections | 3 |
| Technical credibility and objection handling | Risk Identification | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Cadence & Checkpoints | 1 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 24**

```yaml
profile:
  key: trial_setup
  motion: expansion
  name: Trial setup
  version: 2.1
  total_credits: 24
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Prior discovery and demo context on the expansion module remembered, not asked again"
        - "Customer's current usage and health status understood before the call"
        - "Named stakeholders addressed with role context"
        - "Any technical or organizational constraints from prior calls acknowledged"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Questions confirmed what success on the new module looks like, not just what to build"
        - "Constraints (technical, organizational, timeline) probed explicitly"
        - "Assumptions from earlier calls verified, not carried over"
        - "Silent stakeholders on the call invited into the conversation"
        - "Follow-ups asked when answers were vague"
    - key: stakeholder_mapping
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Champion, decision-maker, blocker, and end-user roles for the expansion named"
        - "Names of people who need to sign off but aren't on the call captured"
        - "Buying committee's incentives and worries for the expansion spend surfaced"
        - "Deal-killer risks named — who could stop this and why"
        - "Path to absent stakeholders agreed with the CSM"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Solutioning happened only where trial scope needed clarification"
        - "No new capabilities introduced — trial focused on what was scoped"
        - "Trade-offs re-acknowledged where relevant"
        - "Deferred conversations noted for post-trial"
        - "The call wasn't derailed by \"while we're here, can we also...\""
    - key: exit_criteria_defined
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Criteria are measurable — a number, a state, a demonstrated behavior"
        - "Both success AND failure paths are named"
        - "Criteria agreed by the champion, not just proposed by the SE"
        - "Written down, not just discussed"
        - "Criteria are specific to this account's actual usage, not templated"
    - key: success_metrics_agreed
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Each metric has a target, not \"improved\""
        - "Each metric has an owner on the customer side, named"
        - "Baseline is captured from their existing account data, not just aspirational"
        - "Metrics tie to business outcomes, not vanity numbers"
        - "Timeframe agreed for each metric"
    - key: admin_access_enablement
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Who gets admin access for the new module is named, not \"the team\""
        - "Training scheduled with dates"
        - "Data and integration setup owners identified, coordinated with the CSM"
        - "Timeline to full enablement is realistic, not aspirational"
        - "Contingency named if the admin blocks or leaves"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Concerns about trial scope, timing, or resources engaged head-on"
        - "Trade-offs of the agreed scope acknowledged, not glossed"
        - "Timeline uncertainty named honestly, not overpromised"
        - "Trial success requires customer effort — that was communicated, not hidden"
        - "Pushback landed — parked with owner or resolved"
    - key: risk_identification
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Top risks named — technical, organizational, timing, or competing internal priority"
        - "Each risk has an owner"
        - "Mitigation plan exists for each material risk"
        - "Trigger conditions specified"
        - "Killer risks that would end the trial (budget cycle, renewal timing) are explicit"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with agenda and expected outcomes of the call"
        - "Transitions between setup topics signposted"
        - "Time managed — every planned item got covered"
        - "Detours parked for follow-up, not chased"
        - "Ended when it said it would, with a clear plan"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Multiple stakeholders on the call contributed"
        - "Champion's voice not the only one heard"
        - "Concerns from end-user or admin surfaced"
        - "Reactions read — pace adjusted when energy dropped"
        - "At least one moment of genuine agreement or negotiation"
    - key: cadence_checkpoints
      credit: 1
      category: communication_control
      sub_parameters:
        - "Checkpoint frequency set — weekly, biweekly, not \"check in\""
        - "First checkpoint has a date and calendar invite, with the CSM included"
        - "Attendees for checkpoints named on both sides"
        - "What each checkpoint covers agreed — usage, blockers, questions"
        - "Escalation path if checkpoints slip is named"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Exit criteria, success metrics, and timelines recapped clearly"
        - "Owners on both sides named again in the recap"
        - "Risks and open items surfaced"
        - "Customer's confirmation on the plan captured"
        - "Under three minutes, and they nodded or added"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Immediate next actions named with owner and date"
        - "First checkpoint scheduled during the call"
        - "Access and enablement steps confirmed with a start date"
        - "Written summary committed to be sent within 24 hours, copied to the CSM"
        - "Customer confirmed the plan verbally"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.15 Troubleshooting {#8-15-exp-troubleshooting}

**Motion:** expansion

**Personality:** Diagnose and resolve (or path) a product issue on a live account, with renewal and expansion-critical workflow impact named honestly.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 1 |
| Discovery and qualification | Questions | 1 |
| Discovery and qualification | Problem Diagnosis | 2 |
| Solution demonstration and technical fit | Technical Accuracy | 3 |
| Solution demonstration and technical fit | Resolution or Clear Path | 2 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Expectation Setting | 2 |
| Technical credibility and objection handling | Escalation Handling | 1 |
| Communication, engagement and call control | Customer Reassurance | 2 |
| Communication, engagement and call control | Documentation & Follow-up | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 25**

```yaml
profile:
  key: troubleshooting
  motion: expansion
  name: Troubleshooting
  version: 2.1
  total_credits: 25
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Ticket, prior interactions, and account health reviewed before the call"
        - "Recent changes to the customer's environment or usage known if available"
        - "Named people on the call addressed with context, not generically"
        - "Prior escalations or unresolved issues from the account known, including any renewal risk flagged by the CSM"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Questions targeted the problem, not tangents"
        - "Reproducibility explicitly probed — one-time, intermittent, or consistent"
        - "Recent changes on the customer's side surfaced — what changed before it broke"
        - "Impact scope confirmed — who's affected, how many users, whether it touches an expansion-critical workflow"
        - "Follow-ups asked when answers were incomplete"
    - key: problem_diagnosis
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Symptoms separated from causes"
        - "Reproducibility tested"
        - "Recent changes surfaced"
        - "Impact quantified — who's blocked, how many users, revenue or renewal at risk"
        - "Diagnosis completed before proposing fixes"
    - key: technical_accuracy
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Statements about how the product works were correct"
        - "Log messages, error codes, and behavior described accurately"
        - "Where the SE didn't know, they said so — no bluffing"
        - "Terminology matched documentation, not colloquial"
        - "Any workaround or fix path was accurately described"
    - key: resolution_or_clear_path
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "If resolved on call, verification was done, not just \"should be fixed\""
        - "If not resolved, next step has an owner and a date"
        - "Root cause explained, not just the fix"
        - "Workarounds provided if the full fix will take time"
        - "Follow-up communication plan agreed, coordinated with the CSM"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Customer pushback on the diagnosis engaged, not defended against"
        - "Timeline objections acknowledged, not glossed"
        - "Where the customer contributed to the issue, that was said gently but honestly"
        - "Alternative resolution paths offered when the primary was rejected"
        - "Pushback landed — acknowledged, escalated, or resolved"
    - key: expectation_setting
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Realistic timelines given, not optimistic ones"
        - "Uncertainty acknowledged where it existed"
        - "Trade-offs of different fix paths explained"
        - "What the customer needs to do vs. what the SE will do — clear"
        - "No overpromising to calm the room, especially near a renewal date"
    - key: escalation_handling
      credit: 1
      category: credibility_objections
      sub_parameters:
        - "Right escalation path identified — product, engineering, support"
        - "Escalation initiated on the call if warranted"
        - "What the escalated team needs was captured — logs, screenshots, repro"
        - "SLA on escalation response was communicated"
        - "SE stayed in the loop as the customer's advocate, alongside the CSM"
    - key: customer_reassurance
      credit: 2
      category: communication_control
      sub_parameters:
        - "Customer's frustration acknowledged, not deflected"
        - "What is being done, right now, was communicated"
        - "Customer was not blamed, even when they contributed to the issue"
        - "Confidence expressed without being dismissive of impact on their expansion plans or renewal"
        - "A human, not a script — the SE was present in the conversation"
    - key: documentation_followup
      credit: 2
      category: communication_control
      sub_parameters:
        - "What was diagnosed and agreed was written up, not just said"
        - "Sent to the customer within an agreed timeframe"
        - "Contains reproduction steps if the issue recurs"
        - "Names the owner for next steps clearly"
        - "Referenced by ticket ID and shared with the CSM for continuity"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with acknowledgment of the issue and framing of the call"
        - "Diagnosis and resolution phases signposted"
        - "Time managed — call didn't sprawl on diagnosis at the cost of resolution"
        - "Detours parked, not chased"
        - "Ended when it said it would, with a clear plan"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Customer was heard — their frustration acknowledged verbally"
        - "Technical folks on the customer side were invited to contribute"
        - "SE didn't monologue diagnostic thinking — customer stayed in the loop"
        - "Reactions read — pace or direction adjusted when concerns showed"
        - "At least one moment of collaborative diagnosis"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Diagnosis, resolution or path forward, and owners recapped"
        - "Timeline for follow-up named"
        - "Customer's original concerns addressed in the recap"
        - "Any open items or verifications surfaced"
        - "Under two minutes, and customer confirmed"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Specific next step named — what happens next and when"
        - "Owner on the Freshworks side named, not just \"we'll get back\""
        - "Documentation and follow-up commitment with timeline"
        - "Customer confirmed the plan verbally"
        - "Captured in writing, referenced to ticket ID, and shared with the CSM"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.16 Q&A session {#8-16-exp-qna-session}

**Motion:** expansion

**Personality:** Office hours on an expansion capability. Accurate answers against their current plan and setup; no sprawling capability tours.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 1 |
| Solution demonstration and technical fit | Solutioning | 3 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Technical credibility and objection handling | Question Handling | 2 |
| Technical credibility and objection handling | Technical Accuracy | 3 |
| Technical credibility and objection handling | Objections | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 20**

```yaml
profile:
  key: qna_session
  motion: expansion
  name: Q&A session
  version: 2.1
  total_credits: 20
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Prior questions or open items from the customer about the expansion were remembered"
        - "The customer's current usage and known priorities were kept in mind"
        - "Named people on the call addressed with context"
        - "Their industry and use cases informed the framing of answers"
        - "Prep showed in the framing of answers, not retrofitted later"
    - key: solutioning
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Where a question warranted a capability walkthrough, it was crisp and tied to their existing setup"
        - "Trade-offs named honestly, not spun"
        - "Configuration or customization implications flagged when relevant to their account"
        - "Where the fit was imperfect, it was named"
        - "Answers didn't sprawl into unrelated capability tours"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Where value questions came up, answers cited concrete outcomes"
        - "Numbers were anchored to their own usage or clearly benchmarked"
        - "Time-to-value addressed if asked"
        - "Business impact tied to the specific expansion capability being discussed"
        - "Value language present where relevant, not forced everywhere"
    - key: question_handling
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Questions answered accurately, not confidently-adjacent"
        - "Answers at the right depth — not too shallow, not lecturing"
        - "Where the SE didn't know, they said so — no bluffing"
        - "Complex questions broken into parts, not answered in one blob"
        - "Follow-up commitments (data, docs, confirmation) captured"
    - key: technical_accuracy
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Statements about how the expansion features work were correct and specific"
        - "Numbers cited (limits, SLAs, capacity) were accurate for their plan"
        - "Where the SE didn't know, they said so and committed to confirm"
        - "Product terminology matched documentation"
        - "No positioning claims that fail on inspection"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Hard questions about the expansion engaged head-on, not deflected"
        - "Answers engaged the specific concern, not a nearby easier one"
        - "Limitations named where they existed, not glossed"
        - "Roadmap used only where committed"
        - "Pushback landed — acknowledged, parked, or resolved"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with framing of what the Q&A would cover"
        - "Transitions between questions were smooth, not abrupt"
        - "Time managed — questions weren't rushed at the end"
        - "SE didn't let one question dominate at the cost of others"
        - "Ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Multiple askers were invited — not just the loudest"
        - "Follow-up questions welcomed and answered"
        - "Silent participants brought in with light invitations"
        - "Reactions read — depth adjusted mid-flight"
        - "At least one moment of genuine back-and-forth"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Key themes from the Q&A recapped, not just the last question"
        - "Follow-up commitments and owners named"
        - "Open items or unresolved questions surfaced"
        - "Customer's concerns about the expansion addressed in the summary"
        - "Under two minutes, and audience nodded"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Specific next step named — follow-up docs, meeting, pilot scope"
        - "Owner and date named for each commitment, including the CSM"
        - "Confirmed by the customer verbally"
        - "Captured in writing"
        - "Advances the expansion, not just \"we'll be in touch\""
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

### 8.17 Churn mitigation & retention {#8-17-churn-mitigation}

**Motion:** expansion

**Personality:** A save conversation. Usage decline, unresolved tickets, or competitive pressure is diagnosed with the CSM before a plan is proposed — no generic reassurance.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 1 |
| Discovery and qualification | Questions | 1 |
| Discovery and qualification | Problem Diagnosis | 2 |
| Solution demonstration and technical fit | Technical Accuracy | 3 |
| Solution demonstration and technical fit | Resolution or Clear Path | 2 |
| Technical credibility and objection handling | Objections | 2 |
| Technical credibility and objection handling | Expectation Setting | 2 |
| Technical credibility and objection handling | Escalation Handling | 2 |
| Communication, engagement and call control | Customer Reassurance | 1 |
| Communication, engagement and call control | Documentation & Follow-up | 1 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 2 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 24**

```yaml
profile:
  key: churn_mitigation
  motion: expansion
  name: Churn mitigation & retention
  version: 2.1
  total_credits: 24
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Health score trend, usage decline, and support ticket history reviewed before the call"
        - "CSM notes, renewal date, and any competitor or replacement-vendor signal reviewed, not learned on the fly"
        - "Named stakeholders addressed with context — especially any new champion after turnover"
        - "Root cause hypotheses (adoption gap, unresolved bug, competitive pressure) prepared in advance"
        - "Prep showed in first five minutes, not retrofitted later"
    - key: questions
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Questions probed why usage or sentiment dropped, not just what's broken today"
        - "Whether the drop is technical, adoption, or organizational (champion left, budget cut) was distinguished"
        - "Silent or newly-involved stakeholders were drawn into the conversation"
        - "Follow-ups pursued vague answers about \"it's just not working for us\""
        - "Silence allowed while they explained frustration, not filled with reassurance too early"
    - key: problem_diagnosis
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Symptoms (low adoption, unresolved tickets, missed value) separated from root causes"
        - "Whether the risk is product, people, or price was established before proposing a fix"
        - "Usage and ticket data used to confirm or challenge the customer's account of the problem"
        - "Impact quantified — what's actually at risk: seats, revenue, renewal date"
        - "Diagnosis completed and aligned with the CSM before proposing a save plan"
    - key: technical_accuracy
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Statements about unresolved issues or bugs were correct and specific, not defensive spin"
        - "Status of any open tickets or escalations described accurately"
        - "Where the SE didn't know current ticket status, they said so and committed to confirm"
        - "Terminology matched documentation and support records, not colloquial approximations"
        - "No claims about fixes or timelines that would fail on inspection"
    - key: resolution_or_clear_path
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "If a technical issue is the driver, a concrete fix or workaround was proposed with a date"
        - "If adoption is the driver, a re-enablement or training plan was proposed with a date"
        - "Root cause explained back to the customer, not just the remedy"
        - "Interim relief offered if the full fix will take time"
        - "Follow-up communication plan agreed, jointly owned with the CSM"
    - key: objections
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "\"We're thinking of leaving\" or \"this isn't working\" was heard, not argued down"
        - "Answers acknowledged what was true about the complaint first"
        - "Where the account was mishandled previously, that was named honestly, not glossed"
        - "Nothing resolved with a promise the SE/CSM couldn't keep"
        - "Pushback landed — acknowledged, escalated, or resolved with a date"
    - key: expectation_setting
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Realistic timelines for the save plan given, not optimistic ones to buy time"
        - "Uncertainty about outcome (e.g., pending internal budget decision) acknowledged"
        - "What the customer needs to do vs. what Freshworks will do was made explicit"
        - "Trade-offs of different remediation paths explained honestly"
        - "No overpromising just to get through the call"
    - key: escalation_handling
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "Right escalation path identified — product, support, leadership sponsor"
        - "Escalation initiated on the call if warranted, not deferred"
        - "What the escalated team needs was captured — account history, tickets, usage data"
        - "SLA or timeline on the escalation response communicated"
        - "SE stayed engaged as the customer's advocate alongside the CSM, not handed off silently"
    - key: customer_reassurance
      credit: 1
      category: communication_control
      sub_parameters:
        - "Customer's frustration and any trust already lost were acknowledged, not deflected"
        - "What is being done, right now, to address the risk was communicated"
        - "Customer was not blamed, even where their own adoption contributed to the gap"
        - "Confidence expressed without minimizing how close to leaving they are"
        - "A human, not a script — the SE was present and specific, not generic reassurance"
    - key: documentation_followup
      credit: 1
      category: communication_control
      sub_parameters:
        - "The save plan — root cause, actions, owners, dates — was written up, not just discussed"
        - "Sent to the customer within an agreed timeframe"
        - "Internal record updated so the CSM and account team have one source of truth"
        - "Names the owner for each next step clearly"
        - "Referenced to the account or ticket history for continuity"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Opened with acknowledgment of the relationship's current state, not a generic agenda"
        - "Diagnosis and resolution phases signposted"
        - "Time managed — call didn't dwell on blame at the cost of the plan"
        - "Detours into unrelated feature requests parked, not chased"
        - "Ended with a clear, mutually agreed plan"
    - key: customer_engagement
      credit: 2
      category: communication_control
      sub_parameters:
        - "Customer was heard fully before any defense or explanation was offered"
        - "Multiple stakeholders' concerns (champion, admin, exec sponsor) surfaced, not just one voice"
        - "SE and CSM coordinated in the room, not talking over each other"
        - "Reactions read — tone adjusted when the customer's frustration peaked"
        - "At least one moment of genuine, unscripted acknowledgment"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Root cause and agreed save plan recapped in plain terms"
        - "Owners and dates for every action named again"
        - "Customer's original concerns addressed explicitly in the recap"
        - "Any remaining open items or risks surfaced honestly"
        - "Under two minutes, and the customer confirmed or corrected"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "Specific next step named — what happens next and when, ahead of the renewal date"
        - "Owner on the Freshworks side named, not just \"we'll follow up\""
        - "Next checkpoint scheduled during the call, not left open-ended"
        - "Customer confirmed the plan verbally"
        - "Captured in writing and shared with the account team"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "CSM and other Freshworks attendees also on camera, presenting a united front"
```

---

### 8.18 AI Vision Demo {#8-18-ai-vision-demo}

**Motion:** expansion

**Personality:** Positioning a Freddy AI lever (self-service, co-pilot, or agent) against the account’s actual ticket volume and AI readiness. Honest about data, hallucination risk, and change management.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Research | 2 |
| Discovery and qualification | Questions | 2 |
| Discovery and qualification | AI Readiness & Fit | 1 |
| Solution demonstration and technical fit | AI Solutioning / Live Demo | 2 |
| Solution demonstration and technical fit | Technical Accuracy | 3 |
| Solution demonstration and technical fit | CDE / Build | 1 |
| Business value and outcome articulation | Value (ROI) | 2 |
| Business value and outcome articulation | Case Study / Proof Point | 1 |
| Technical credibility and objection handling | Objections | 3 |
| Technical credibility and objection handling | Expectation Setting | 3 |
| Communication, engagement and call control | Call Flow | 3 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 29**

```yaml
profile:
  key: ai_vision_demo
  motion: expansion
  name: AI Vision Demo
  version: 2.1
  total_credits: 29
  themes:
    - key: research
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Current Freddy/AI module adoption (if any) and account-wide AI readiness reviewed before the call"
        - "Ticket volume, deflection rate, or repetitive-query patterns pulled as AI opportunity signals"
        - "Named stakeholder's attitude toward AI (champion, skeptic) known from prior notes"
        - "Any existing AI initiatives elsewhere in their org referenced specifically"
        - "Prep showed in the framing of the opening, not retrofitted later"
    - key: questions
      credit: 2
      category: discovery_qualification
      sub_parameters:
        - "Open-ended questions probed where manual, repetitive work is happening today"
        - "Current attitudes or blockers to AI adoption (trust, budget, data governance) surfaced directly"
        - "At least one question uncovered a workflow suited to Freddy Copilot, Self-Service, or Agents"
        - "Follow-up questions pursued vague answers about \"we're exploring AI\" internally"
        - "Silence was allowed; the SE didn't rush to pitch a feature"
    - key: ai_readiness_fit
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Data quality and structure needed for the AI capability were assessed honestly, not assumed"
        - "The specific workflow was matched to the right AI lever — self-service, co-pilot, or agent — not a generic pitch"
        - "Team's change-readiness (training capacity, process maturity) was gauged"
        - "Where fit was weak, that was said plainly rather than oversold"
        - "A realistic starting scope (single team, single workflow) was proposed over a big-bang rollout"
    - key: ai_solutioning
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "The AI capability was shown solving the specific pain just described, not a generic showcase"
        - "Tell-show-tell used — framed, demonstrated, tied back to their own workflow"
        - "At least one moment landed as \"that would save us real time,\" not narration"
        - "Irrelevant AI features were skipped, not paraded"
        - "Demo used data or scenarios resembling their actual account, not a generic sandbox"
    - key: technical_accuracy
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Mechanics explained honestly — where the model draws from, what it can't do"
        - "Data residency, privacy, and security handling addressed with specifics, not reassurance alone"
        - "Where the SE didn't know a technical detail, they said so and committed to confirm"
        - "Hallucination risk and human-in-the-loop safeguards explained plainly"
        - "No claims about accuracy or capability that would fail on inspection"
    - key: cde_build
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Environment reflected their actual data shapes and terminology, not a generic sandbox"
        - "Setup was proportionate to a positioning conversation, not over-built"
        - "Nothing on screen contradicted what's known about their real ticket or usage data"
        - "Configuration matched their current plan/tier honestly"
        - "Environment was ready before the call, no live setup fumbling"
    - key: value
      credit: 2
      category: business_value
      sub_parameters:
        - "Value quantified in hours, tickets deflected, or headcount saved — not adjectival"
        - "Numbers anchored to their own ticket or usage volume, not generic industry stats"
        - "At least one value point tied to the champion's or admin's actual KPI"
        - "Time-to-value for AI adoption addressed honestly — pilot period, ramp time"
        - "Value language repeated more than once, tied consistently to their own data"
    - key: case_study
      credit: 1
      category: business_value
      sub_parameters:
        - "If used, the reference is an account that adopted the same AI lever from a similar starting point"
        - "A specific, credible number cited, not \"significant improvement\""
        - "Industry- or size-adjacent to the customer"
        - "Told at the moment it reinforced a capability just shown"
        - "Brief — didn't stall the conversation's pace"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Data privacy, model training, or \"will this replace jobs\" objections engaged directly, not deflected"
        - "The specific concern raised was answered, not a nearby easier one"
        - "Limitations of the AI capability named honestly where they existed"
        - "Roadmap used only where genuinely committed, not as a shield"
        - "Pushback landed somewhere — acknowledged, parked with a date, or resolved"
    - key: expectation_setting
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Realistic rollout and change-management timeline given, not an optimistic one"
        - "Training and enablement needs named explicitly, not glossed"
        - "What \"good\" adoption looks like in the first 30/60/90 days was defined"
        - "Trade-offs between AI levers (self-service vs. co-pilot vs. agent) explained honestly"
        - "No overpromising on accuracy or time savings to close the conversation"
    - key: call_flow
      credit: 3
      category: communication_control
      sub_parameters:
        - "Call opened with a clear purpose — positioning the AI lever, not a generic check-in"
        - "Transitions between discovery, demo, and value signposted"
        - "Time managed — no rushed final minutes on objections"
        - "Skepticism or objection detours bounded, not allowed to consume the call"
        - "Call ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer talked at least a third of the time, sharing their own AI attitudes and use cases"
        - "Their language and examples used back to them"
        - "Multiple stakeholders (including skeptics) addressed, not just the enthusiast"
        - "Reactions read — pace or depth on technical detail adjusted mid-flight"
        - "At least one moment of genuine back-and-forth, not a feature monologue"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Key AI opportunity and expected value recapped, not just features shown"
        - "Value points restated in the customer's own language and numbers"
        - "Any open trust, data, or governance concerns surfaced, not buried"
        - "Next step tied to the specific AI lever discussed"
        - "Summary brief — under two minutes"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "A specific next step proposed — AI pilot scope, sandbox trial, or stakeholder demo"
        - "It had an owner and a date, not just a verb"
        - "Advanced the AI expansion, coordinated with the CSM's account plan"
        - "Customer confirmed verbally"
        - "Captured in writing before or immediately after the call"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and framing professional"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees, including the CSM, also on camera"
```

---

### 8.19 Demo — Cross sell {#8-19-demo-cross-sell}

**Motion:** expansion

**Personality:** A positioning demo of an adjacent product or module to a live account. Same craft as a plan-upgrade demo, with competitive consolidation in play when a point solution is already in the stack.

#### Themes and credits

| Category | Theme | Credit |
|---|---|---|
| Discovery and qualification | Account & Usage Context | 1 |
| Solution demonstration and technical fit | CDE / Build | 1 |
| Solution demonstration and technical fit | Solutioning | 2 |
| Solution demonstration and technical fit | AI | 3 |
| Solution demonstration and technical fit | Slide Deck | 1 |
| Business value and outcome articulation | Value | 3 |
| Business value and outcome articulation | Microstory | 2 |
| Technical credibility and objection handling | Objections | 3 |
| Technical credibility and objection handling | Comp Pitch | 2 |
| Communication, engagement and call control | Call Flow | 2 |
| Communication, engagement and call control | Customer Engagement | 3 |
| Communication, engagement and call control | Summarise | 1 |
| Communication, engagement and call control | CTA | 1 |
| Communication, engagement and call control | Camera On | 1 |

**Total credits: 26**

```yaml
profile:
  key: demo_cross_sell
  motion: expansion
  name: Demo — Cross sell
  version: 2.1
  total_credits: 26
  themes:
    - key: research
      credit: 1
      category: discovery_qualification
      sub_parameters:
        - "Current product usage and adoption level referenced specifically — modules live, user count, volume"
        - "Known product issues or open tickets on the account acknowledged before being raised by the customer"
        - "Usage or health data reviewed before the call, not learned on the fly"
        - "Named stakeholder on the call addressed with context, not generically"
        - "Prep showed in the framing of the demo's opening, not retrofitted later"
    - key: cde_build
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Environment reflects the customer's industry, not a generic sandbox"
        - "Data and terminology recognizable to their world, even if not their exact instance"
        - "Setup was fit for a positioning demo — not over-built for the time available"
        - "Nothing on screen contradicted what's known about their actual account"
        - "Environment was ready before the call started, no live setup fumbling"
    - key: solutioning
      credit: 2
      category: solution_technical_fit
      sub_parameters:
        - "Each feature shown tied to a specific expansion opportunity, not a generic tour"
        - "Tell-show-tell used even briefly — framed, shown, tied back"
        - "Features irrelevant to their current usage were skipped, not paraded"
        - "At least one moment landed as 'that would help us,' not narration"
        - "Demo stayed proportionate to a positioning call, not a rebuild of the whole platform"
    - key: ai
      credit: 3
      category: solution_technical_fit
      sub_parameters:
        - "Every Freddy AI capability relevant to their plan or usage was shown, not just one"
        - "Mechanics explained honestly — where it draws from, what it can't do"
        - "ROI or time saved was concrete and tied to their own usage, not generic"
        - "Data, privacy, or model questions were pre-empted, not dodged"
        - "AI was positioned as the primary expansion hook of the call, not a footnote"
    - key: slide_deck
      credit: 1
      category: solution_technical_fit
      sub_parameters:
        - "Deck was tailored — logo, industry, or account name somewhere"
        - "Slides supported the value story, not filler between demo screens"
        - "Time on slides proportionate — a few minutes, not the majority of the call"
        - "Complex visuals were walked, not read"
        - "Deck ended on the expansion ask, not 'thank you'"
    - key: value
      credit: 3
      category: business_value
      sub_parameters:
        - "Value quantified — hours, tickets, cost, headcount — not adjectival"
        - "Numbers anchored to their own usage or clearly benchmarked"
        - "At least one value point tied to the champion's or admin's actual KPI"
        - "Value framed as what expansion adds, not just what they already have"
        - "Value language repeated at least twice across the call, not once"
    - key: microstory
      credit: 2
      category: business_value
      sub_parameters:
        - "Brief — under 30 seconds, not a slide-backed case study"
        - "A specific number or outcome cited, not 'significant improvement'"
        - "Industry- or size-adjacent to the customer"
        - "Told at the exact moment it reinforced a feature just shown"
        - "Didn't stall the demo's pace — in and out, not lingered on"
    - key: objections
      credit: 3
      category: credibility_objections
      sub_parameters:
        - "Frustration about existing product issues acknowledged first, not argued with"
        - "The specific issue raised was engaged, not deflected to 'the team is aware'"
        - "A path to resolution or a status update was given, not just sympathy"
        - "Limitations were named honestly where they existed"
        - "The conversation was steered back to expansion value, not left on the complaint"
    - key: comp_pitch
      credit: 2
      category: credibility_objections
      sub_parameters:
        - "If a competitor came up, it was addressed specifically, not generically"
        - "Differentiation was concrete, not defensive"
        - "Their existing tool or workflow was treated with respect"
        - "Didn't derail the call into a competitive teardown"
        - "Redirected back to their own product's expansion value"
    - key: call_flow
      credit: 2
      category: communication_control
      sub_parameters:
        - "Call opened with a clear purpose — positioning, not a generic check-in"
        - "Transitions between features signposted, not abrupt"
        - "Time managed — no rushed final minutes"
        - "Product-issue detours bounded, not allowed to consume the call"
        - "Call ended when it said it would, or with explicit renegotiation"
    - key: customer_engagement
      credit: 3
      category: communication_control
      sub_parameters:
        - "Customer talked at least a third of the time, even without formal discovery"
        - "Their name and known usage referenced back to them"
        - "Multiple stakeholders on the call addressed, not just the loudest"
        - "Reactions read — pace or depth adjusted mid-flight"
        - "At least one moment of genuine back-and-forth, not monologue-and-nod"
    - key: summarise
      credit: 1
      category: communication_control
      sub_parameters:
        - "Key expansion opportunities recapped, not just features shown"
        - "Value points restated in the customer's language"
        - "Any open product concerns surfaced, not buried"
        - "Next step tied to the expansion opportunity discussed"
        - "Summary brief — under two minutes"
    - key: cta
      credit: 1
      category: communication_control
      sub_parameters:
        - "A specific next step proposed — feature trial, follow-up, or approval ask"
        - "It had an owner and a date, not just a verb"
        - "Advanced the expansion — not 'let's stay in touch'"
        - "Customer confirmed verbally"
        - "Captured in writing before or immediately after the call"
    - key: camera_on
      credit: 1
      category: communication_control
      requires_video: true
      sub_parameters:
        - "SE's camera was on"
        - "Stayed on for full call, not just the opening"
        - "Background and professional framing"
        - "Lighting made face visible, not silhouetted"
        - "Other Freshworks attendees also on camera"
```

---

## 9. Theme vocabulary — canonical definitions {#9-vocabulary}

Every theme key with its canonical meaning. Sub-parameters may vary by profile (see individual profiles for exact text), but the theme measures the same underlying construct wherever it appears.

| Key | Category | Definition | Video-dependent |
|---|---|---|---|
| `research` | Discovery | Depth of prep on the account, industry, and named people | No |
| `questions` | Discovery | Quality and sharpness of discovery questions | No |
| `pain_qualification` | Discovery | Quantifying pain and drawing out consequence | No |
| `incumbent_competition` | Discovery | Mapping current tool and other bidders | No |
| `stakeholder_mapping` | Discovery | Who decides, who blocks, who else is affected | No |
| `observation_note_capture` | Discovery | Capturing what the customer struggled with and got excited by | Yes |
| `problem_diagnosis` | Discovery | Establishing what is actually broken before theorising | No |
| `solutioning` | Solution | Mapping capability to specific customer pain | No |
| `cde_build` | Solution | Environment reflects the customer's world | Yes |
| `ai` | Solution | AI shown solving customer problems, honestly | No |
| `ai_readiness_fit` | Discovery | Honest fit of data, workflow, and change-readiness to a specific AI lever | No |
| `ai_solutioning` | Solution | Live AI capability shown against the pain just described, not a generic showcase | No |
| `slide_deck` | Solution | Tailored, structured, argument-advancing slides | No |
| `technical_accuracy` | Solution / Credibility | Statements about the product are correct and specific | No |
| `architecture_fitment` | Solution | Mapped their actual stack, not a generic diagram | No |
| `task_design` | Solution | Reverse-demo tasks are realistic, ordered, achievable | No |
| `setup_framing` | Solution | Reverse-demo framing of purpose and ground rules | No |
| `exit_criteria_defined` | Solution | Measurable, agreed, written down — for trials | No |
| `success_metrics_agreed` | Solution | Specific metrics with targets and owners — for trials | No |
| `admin_access_enablement` | Solution | Who gets access, what training, by when | No |
| `value` | Business value | Quantifying return and connecting capability to outcome | No |
| `case_study` | Business value | Relevant references with proof, told well | No |
| `microstory` | Business value | A brief in-flow proof point (under 30 seconds), not a slide-backed case study | No |
| `objections` | Credibility | Handling hard questions and pushback with honesty | No |
| `comp_pitch` | Credibility | Competitive differentiation with respect and specificity | No |
| `question_handling` | Credibility | Answering accurately, at right depth, without bluffing | No |
| `expectation_setting` | Credibility | Honest timeline; no overpromising to calm the room | No |
| `escalation_handling` | Credibility | Pulled in the right people at the right time | No |
| `risk_identification` | Credibility | Named what could go wrong and who owns it | No |
| `coaching_without_taking_over` | Credibility | Guided without seizing the mouse or finishing sentences | Yes |
| `call_flow` | Communication | Structure, pacing, transitions, time management | Yes |
| `customer_engagement` | Communication | Rapport, interaction, keeping the session lively | Yes |
| `storytelling` | Communication | Narrative resonance and industry-specific framing | No |
| `summarise` | Communication | Recap of key points, value, and next steps | No |
| `cta` | Communication | Clear next steps that advance the deal | No |
| `camera_on` | Communication | Professional video presence throughout | Yes |
| `handover_discipline` | Communication | Gave the customer control and kept it there | Yes |
| `customer_reassurance` | Communication | Managed an unhappy customer's confidence honestly | Yes |
| `documentation_followup` | Communication | What was agreed is written down and sent | No |
| `cadence_checkpoints` | Communication | Checkpoints scheduled, not "ping me if you need anything" | No |
| `resolution_or_clear_path` | Solution | Fixed it, or left a plan with an owner and a date | No |

**Cross-profile behavior note:** A theme's category assignment can vary by profile in one case: `technical_accuracy` sits in `solution_technical_fit` for technical deep dive (where it's demonstrated) and `credibility_objections` for Q&A and troubleshooting (where it's tested under pressure). This is deliberate. The theme measures the same construct; the category reflects what the call is stressing. Machine implementations should trust the category assignment in each profile's YAML, not the vocabulary table.

---

## 10. Sample computation walkthrough {#10-walkthrough}

A worked example, end to end, using the demo profile.

### Given

Demo profile (34 credits). Sub-parameter scores for a middling call:

| Theme | Credit | SP1 | SP2 | SP3 | SP4 | SP5 |
|---|---|---|---|---|---|---|
| research | 2 | 2 | 2 | 1 | 2 | 1 |
| questions | 3 | 2 | 1 | 1 | 1 | 1 |
| cde_build | 2 | 1 | 1 | 0 | 1 | 1 |
| solutioning | 3 | 2 | 2 | 2 | 1 | 1 |
| ai | 2 | 1 | 2 | 1 | 1 | 1 |
| slide_deck | 1 | 2 | 2 | 2 | 1 | 1 |
| value | 3 | 1 | 1 | 1 | 1 | 1 |
| case_study | 2 | 1 | 1 | 1 | 2 | 1 |
| objections | 3 | 2 | 1 | 1 | 2 | 1 |
| comp_pitch | 2 | 1 | 1 | 2 | 1 | 1 |
| call_flow | 2 | 2 | 2 | 2 | 1 | 1 |
| customer_engagement | 3 | 2 | 2 | 1 | 2 | 1 |
| storytelling | 2 | 1 | 1 | 1 | 1 | 1 |
| summarise | 2 | 1 | 1 | 2 | 1 | 1 |
| cta | 1 | 1 | 1 | 1 | 0 | 1 |
| camera_on | 1 | 2 | 2 | 2 | 2 | 2 |

### Step 1: Theme grades

Sum of five sub-parameters:

| Theme | Grade |
|---|---|
| research | 8 |
| questions | 6 |
| cde_build | 4 |
| solutioning | 8 |
| ai | 6 |
| slide_deck | 8 |
| value | 5 |
| case_study | 6 |
| objections | 7 |
| comp_pitch | 6 |
| call_flow | 8 |
| customer_engagement | 8 |
| storytelling | 5 |
| summarise | 6 |
| cta | 4 |
| camera_on | 10 |

### Step 2: Contributions

`contribution = grade × credit`

| Theme | Grade | Credit | Contribution |
|---|---|---|---|
| research | 8 | 2 | 16 |
| questions | 6 | 3 | 18 |
| cde_build | 4 | 2 | 8 |
| solutioning | 8 | 3 | 24 |
| ai | 6 | 2 | 12 |
| slide_deck | 8 | 1 | 8 |
| value | 5 | 3 | 15 |
| case_study | 6 | 2 | 12 |
| objections | 7 | 3 | 21 |
| comp_pitch | 6 | 2 | 12 |
| call_flow | 8 | 2 | 16 |
| customer_engagement | 8 | 3 | 24 |
| storytelling | 5 | 2 | 10 |
| summarise | 6 | 2 | 12 |
| cta | 4 | 1 | 4 |
| camera_on | 10 | 1 | 10 |
| **Total** | | **34** | **222** |

### Step 3: Category scores

`category_score = Σ(contribution) ÷ Σ(credit)` within category

| Category | Credits | Grade-points | Score |
|---|---|---|---|
| discovery_qualification | 5 | 34 | 6.8 |
| solution_technical_fit | 8 | 52 | 6.5 |
| business_value | 5 | 27 | 5.4 |
| credibility_objections | 5 | 33 | 6.6 |
| communication_control | 11 | 76 | 6.9 |

### Step 4: Overall QIP

`overall = 222 ÷ 34 = 6.5 / 10`

Note: category grade-points sum to 34 + 52 + 27 + 33 + 76 = 222, and credits to 34. The star at the top matches the sum at the bottom — always.

### Step 5: Sanity checks

- All 0s: overall = 0.0 ✓
- All sub-parameters at 2 (all grades = 10): overall = 340 ÷ 34 = 10.0 ✓
- All sub-parameters at 1 (all grades = 5): overall = 170 ÷ 34 = 5.0 ✓
- Zero `solutioning` (credit 3), everything else at 8: overall = (34×8 − 24) ÷ 34 = 248 ÷ 34 = 7.3 (vs 8.0 baseline) — theme cost 0.7
- Zero `camera_on` (credit 1), everything else at 8: overall = (34×8 − 8) ÷ 34 = 264 ÷ 34 = 7.8 — theme cost 0.2

The 3.5× credit ratio between solutioning and camera_on translates into a 3.5× damage ratio — the arithmetic is behaving.

---

## 11. Practical guidance by role {#11-role-guidance}

### For managers running 1:1 coaching sessions

Read the star profile first, not the overall. If Business Value is 5.4 and Discovery is 8.0, the coaching conversation is about connecting capability to outcome — not about "your score is 6.5, let's improve." The category surfaces the pattern; the theme surfaces the specific behavior; the sub-parameter surfaces the specific evidence.

Never open a 1:1 with the overall number. Open with a theme where the SE did well, close with a theme with room to grow, and always ground both in a specific sub-parameter with a timestamp.

### For SEs receiving a scorecard

Every sub-parameter score has evidence. If you disagree with the score, point to the transcript. If the sub-parameter itself feels wrong for the call, that's a rubric-quality argument — bring it to Sathish or the calibration committee, not to your manager.

Categories are your at-a-glance diagnostic. If Discovery is high and Solution is low across many calls, that's a coaching pattern about tailoring the demo. If Communication is consistently low, that's a delivery pattern.

### For leaders reviewing team performance

Do not aggregate overall QIP across profiles by averaging. Aggregate at the category level. An SE with 20 calls (10 demo, 8 discovery, 2 Q&A) has three profile-specific averages — those are what you compare over time.

Watch the category shape, not the overall number. An SE whose Communication scores are consistently top-quartile but whose Business Value scores are bottom-quartile has a specific gap that a targeted enablement can close. An SE whose overall is 7.0 across all categories is a stable performer whose development plan looks different.

### For FDEs and implementers

Every theme with `requires_video: true` needs graceful degradation. The confidence discount for missing video should be visible on the scorecard with a stated reason. Never silently score a video-dependent theme from transcript alone.

Sub-parameters are the atomic unit. Store them as separate records. Never store only the theme grade — you lose the ability to explain the score and the ability to re-score if a sub-parameter definition changes.

### For solution architects extending the system

Adding a profile: create a new YAML block in §8 following the schema in Appendix A. No changes to §1–§7 required.

Adding a theme: assign it to a category, write five sub-parameters that move independently, and place it in one or more profiles with credits set by §5's question. No changes to any other profile required.

Renaming a theme key: forbidden without a migration path. Historical scorecards depend on the key.

### For the calibration process

Two SEs scoring the same transcript against the same profile should land within 1 point on the overall QIP. If they don't, the disagreement drives the rubric fix, not just the recalibration.

The model scoring the same transcript twice against the same profile should land within 0.5 points on the overall QIP. If it doesn't, the theme with the highest per-run variance is the theme with an ambiguous sub-parameter.

---

## 12. Open items {#12-open-items}

**Anchor calibration on all profiles.** The golden-set pass (v2.5) is live with hunting-demo and expansion seeds; discovery still has rules only. Keep adding human-scored calls to `golden-set/examples.ts` and check that two SEs looking at the same call agree within a point. Saved scorecards need a re-analyse to pick up new rules.

**Shadow mode approach.** A profile is ready to display live when its sub-parameters have been calibrated by SEs on real calls, and when the model produces the same score across two runs on the same transcript within ~0.5 points overall. Consistency plus manual calibration, not consistency alone.

**Deal risk log wiring.** Separate lane, separate storage. Needs its own taxonomy (claim to verify · commitment outside remit · missing stakeholder · process gap) and a workflow to route each item to the right owner within the week.

**v1.1 honesty themes.** `unknowns_handled`, `feasibility_honesty`, `technical_risk` — proposed in v1.0 §8, blocked because they required reweighting. Under credits they're a local addition to one or two profiles. Worth adding when someone owns writing the sub-parameters — this is where the rubric stops rewarding a confident bluff.

**Profile-specific sub-parameter variance.** `customer_engagement` currently varies between demo (customer talks 1/3) and discovery (customer talks 2/3). If this pattern extends to more themes and more profiles, we should formalize it as a documented per-profile override rather than treating each variance as ad hoc.

---

## Appendix A: JSON Schema for profile validation {#appendix-a-schema}

Every profile YAML block must validate against this schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["profile"],
  "properties": {
    "profile": {
      "type": "object",
      "required": ["key", "motion", "name", "version", "total_credits", "themes"],
      "properties": {
        "key": {
          "type": "string",
          "pattern": "^[a-z_]+$"
        },
        "motion": {
          "type": "string",
          "enum": ["new_business", "expansion"]
        },
        "name": {
          "type": "string"
        },
        "version": {
          "type": "string"
        },
        "total_credits": {
          "type": "integer",
          "minimum": 1
        },
        "themes": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["key", "credit", "category", "sub_parameters"],
            "properties": {
              "key": {
                "type": "string",
                "pattern": "^[a-z_]+$"
              },
              "credit": {
                "type": "integer",
                "enum": [1, 2, 3]
              },
              "category": {
                "type": "string",
                "enum": [
                  "discovery_qualification",
                  "solution_technical_fit",
                  "business_value",
                  "credibility_objections",
                  "communication_control"
                ]
              },
              "requires_video": {
                "type": "boolean",
                "default": false
              },
              "sub_parameters": {
                "type": "array",
                "minItems": 5,
                "maxItems": 5,
                "items": {
                  "type": "string",
                  "minLength": 10
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Additional validation rules beyond the schema:**

1. `total_credits` must equal the sum of `credit` across all themes in the profile
2. Every theme's `key` must appear in the vocabulary table (§9)
3. `sub_parameters` must contain exactly 5 items — 0/1/2 states × 5 items = 0–10 grade
4. Category keys must match the five defined in §4

---

## Appendix B: Reference parser (pseudocode) {#appendix-b-parser}

```python
import yaml
import re

def parse_qip_spec(md_path):
    """Parse the QIP spec markdown and extract all profile definitions.
    
    Returns a dict mapping profile_key -> profile definition.
    """
    with open(md_path, 'r') as f:
        content = f.read()
    
    # Extract every fenced yaml block
    yaml_blocks = re.findall(r'```yaml\s*\n(.*?)\n```', content, re.DOTALL)
    
    profiles = {}
    for block in yaml_blocks:
        try:
            data = yaml.safe_load(block)
        except yaml.YAMLError:
            continue
        if not isinstance(data, dict) or 'profile' not in data:
            continue
        p = data['profile']
        validate_profile(p)
        profiles[p['key']] = p
    
    return profiles


def validate_profile(profile):
    """Assert profile invariants beyond the JSON schema."""
    assert profile['total_credits'] == sum(t['credit'] for t in profile['themes'])
    for theme in profile['themes']:
        assert len(theme['sub_parameters']) == 5
        assert all(len(sp) >= 10 for sp in theme['sub_parameters'])
        assert theme['credit'] in (1, 2, 3)


def score_call(profile, sub_parameter_scores):
    """Compute overall, category, and theme scores for a call.
    
    sub_parameter_scores: {theme_key: [sp1, sp2, sp3, sp4, sp5]}
      Each sp value is 0, 1, or 2.
    
    Returns: {
      'overall': float,
      'categories': {category_key: float},
      'themes': {theme_key: {'grade': int, 'credit': int, 'contribution': int}}
    }
    """
    themes_out = {}
    category_totals = {}  # category_key -> [grade_points, credits]
    total_gp = 0
    total_credits = 0
    
    for theme in profile['themes']:
        key = theme['key']
        scores = sub_parameter_scores.get(key, [0, 0, 0, 0, 0])
        assert all(s in (0, 1, 2) for s in scores)
        assert len(scores) == 5
        grade = sum(scores)
        contribution = grade * theme['credit']
        themes_out[key] = {
            'grade': grade,
            'credit': theme['credit'],
            'contribution': contribution,
        }
        cat = theme['category']
        if cat not in category_totals:
            category_totals[cat] = [0, 0]
        category_totals[cat][0] += contribution
        category_totals[cat][1] += theme['credit']
        total_gp += contribution
        total_credits += theme['credit']
    
    categories_out = {
        cat: (gp / cr if cr > 0 else 0.0)
        for cat, (gp, cr) in category_totals.items()
    }
    overall = total_gp / total_credits if total_credits > 0 else 0.0
    
    return {
        'overall': round(overall, 2),
        'categories': {k: round(v, 2) for k, v in categories_out.items()},
        'themes': themes_out,
    }
```

---

## Appendix C: Sanity check test cases {#appendix-c-tests}

Any implementation must pass these tests. Failure indicates a bug.

### Test 1: All zeros
```
Given: all sub-parameters = 0 across every theme in any profile
Expect: overall = 0.0, every category = 0.0, every theme grade = 0
```

### Test 2: All twos (perfect call)
```
Given: all sub-parameters = 2 across every theme in the demo profile
Expect: overall = 10.0, every category = 10.0, every theme grade = 10
```

### Test 3: All ones (baseline call)
```
Given: all sub-parameters = 1 across every theme in the demo profile
Expect: overall = 5.0, every category = 5.0, every theme grade = 5
```

### Test 4: Credit weighting
```
Given: demo profile, all themes graded 8, solutioning (credit 3) graded 0
Expect: overall = (34×8 - 24) / 34 = 248/34 ≈ 7.29
Compare: same setup but camera_on (credit 1) graded 0 instead
Expect: overall = (34×8 - 8) / 34 = 264/34 ≈ 7.76
Difference: solutioning at 0 costs 3× more overall damage than camera_on at 0 ✓
```

### Test 5: Category scores sum consistency
```
Given: any set of scores in any profile
Compute: overall directly from themes
Compute: overall from weighted average of category scores (category × category_credits)
Expect: the two values are equal within floating-point tolerance ✓
```

### Test 6: Total credits match sum
```
For every profile in this document:
  Sum theme credits from the YAML block
  Compare against profile.total_credits
Expect: exact match for every profile ✓

Reference values (new_business):
  demo: 34
  discovery: 32
  technical_deep_dive: 32
  reverse_demo: 28
  use_case_discussion: 31
  trial_setup: 33
  troubleshooting: 33
  qna_session: 25

Reference values (expansion):
  demo_plan_upgrade: 24
  discovery: 27
  technical_deep_dive: 26
  reverse_demo: 17
  use_case_discussion: 24
  trial_setup: 24
  troubleshooting: 25
  qna_session: 20
  churn_mitigation: 24
  ai_vision_demo: 29
  demo_cross_sell: 26
```

### Test 7: Sub-parameter count
```
For every theme in every profile:
  Assert exactly 5 sub-parameters
Expect: every theme passes ✓
```

### Test 8: Vocabulary consistency
```
For every theme key used in any profile:
  Assert it appears in the vocabulary table (§9)
Expect: every key resolves ✓
```

---

## Postscript

The design goal was one lever, defensible from bottom to top. Sub-parameters generate theme grades. Credits weight themes. Overall aggregates the weighted contributions. No hidden weights, no shadow adjustments, no unexplained normalizations. An SE can rebuild their own score on a napkin. That is the property that makes the scorecard survive contact with the people it scores.

*A brilliant call that ends on "we'll circle back" just leaked all its energy.*

*— End of specification.*
