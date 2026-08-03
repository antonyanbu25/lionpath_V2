# Post-call intelligence — build specification v2

**Product:** SE Singha Paathai
**Status:** MVP spec, ready for build
**Companion:** `se-singha-paathai-wireframe-v4.html` — clickable reference for every surface described here

> **This document supersedes `post-call-intelligence-spec.md` and `arr-engine-and-scoring-profiles.md`.** Both are now stale — in particular the original §5.3 excluded three call types from scoring, which is no longer the decision. Delete them or archive them; do not hand them to a builder alongside this.

---

## 1. What this is

An SE finishes a customer call. The recording lands here. The system pulls transcript and video, ties the call to the right deal, works out what kind of call it was, and produces:

1. **Call notes and minutes** — a narrative summary for the SE, and a customer-facing MoM they edit and send
2. **Coaching** — a weighted scorecard with timestamped evidence per line
3. **Deal intelligence** — technical commit movement, qualification, traction, next actions
4. **Product signal** — what customers asked for that we couldn't do, and what landed

Four consumers beyond the SE: their manager, leadership, the product org, and enablement.

### The two-score position

| | Grades | Lives on | Consumer |
|---|---|---|---|
| **QIP** | The SE's execution of one call | The **call** | SE, manager |
| **MEDPICC** | The deal's qualification state | The **deal** | SE, manager, leadership |

An SE can run a flawless call on a dying deal — 86 QIP, 42 MEDPICC. Keeping these separate is what stops the tool blaming people for deals that were never real.

---

## 2. Information architecture

Nine surfaces in three groups. This is settled; build to it.

```
CAPTURE
  Pre-call        generate the brief before the call
  Post-call       submit the recording after it

MINE
  All calls       every call, with QIP and what it moved
  Accounts        account list → account record
  My deals        deal list → deal record
  My coaching     private score trends and receipts

ROLL-UPS
  Team            manager view, drill-down to SE → account → deal → call
  Pipeline review leadership, descending by agent count / ARR
  Product signal  clustered gaps and wins across every call
```

### 2.1 Where each metric lives — and where it must not

**A metric lives on the object it measures.** This rule resolves most layout arguments before they start.

| Object | Owns | Deliberately absent |
|---|---|---|
| **Call** | QIP score, call notes, MoM, timeline of events, video facts, stakeholder profiles, TC delta, gaps raised | — |
| **Deal** | Deal summary, MEDPICC, TC current state, traction, deal velocity, ARR, fitment | **QIP** — it grades the SE, not the deal |
| **Account** | Account summary, all deals, all calls, contacts, gaps, firmographics, reason for evaluation | QIP, MEDPICC |
| **SE** | Per-type QIP averages, theme scores across all types | A single blended composite |

**Consequence to accept:** with QIP off the deal record, a manager reviewing a deal sees no signal about how it was run without clicking into a call. That is the correct trade — the deal screen is about the customer. If it proves to be friction, add a one-line "call quality" note to the deal's right rail rather than restoring the number to the header.

### 2.2 Technical commit is a deal state updated by calls

The one object that spans both. Handle it as snapshot-plus-delta:

- **Current state** lives on the deal — incumbent, competitor, identified risk, timeline for closure, reason for evaluation, AI attach, justification
- **Per-call delta** lives on the call — what this conversation confirmed, changed, or newly raised, each marked as `confirmed` / `changed` / `new`

This is what makes the commit legible over time. "TC = yes" as a static field tells you nothing about whether it's getting stronger or quietly rotting.

---

## 3. Inputs

### 3.1 Pre-call

| Field | Required |
|---|---|
| Company | Yes |
| Company domain | Yes — prefilled from prospect email |
| Prospect emails | Yes — comma separated, researched individually |
| LinkedIn profile PDFs | No |
| Meeting link (Zoom / Kaia) | No |
| Additional context | No |

Enrichment from website, funding records, traffic estimates, and the LinkedIn exports.

### 3.2 Post-call

| Field | Required | Notes |
|---|---|---|
| Recording link | Yes | Zoom or Kaia. Carries transcript, participants, video. |
| Passcode | Conditional | Only if not embedded in the link |
| Company name | Yes | Deal resolution; prefilled where resolvable |
| Prospect email(s) | Yes | Primary matching key |
| Deck link | No | Google Slides / .pptx — see 3.4 |
| LinkedIn PDFs | No | |
| Additional context | No | AE notes |

Anything derivable from the recording is **derived and shown for confirmation**, never asked twice: participants, domains, SE identity, call time, duration.

### 3.3 The pre-call brief is the answer key

Post-call must locate the brief for this account. This closes a loop nothing else can — several scorecard themes stop being transcript inference and become a diff against a document we already wrote:

| Brief output | Grades |
|---|---|
| Suggested agenda | Research & agenda |
| Discovery questions surfaced | Questions |
| Likely incumbent and competitor | Incumbent & competition |
| Stakeholder profiles and likely roles | MEDPICC · champion, economic buyer |

Research & agenda is the weakest theme to score from a transcript alone. With a brief on file it becomes the strongest.

If no brief exists, offer **create new deal** with company and emails prefilled from the participant list. A missing brief is never a dead end.

### 3.4 Deck link — optional, deliberately

If the deck was screen-shared, the frames are already captured, and frames are what the customer actually saw. A 40-slide deck where 12 were shown is scored on the 12.

The link adds one thing: **the gap between what they had and what they showed** — skipped slides, unused ROI content, template-library vs customized. Real coaching value, but v2, and only works if the link resolves. Mandatory guarantees a permanently broken field, because internal deck permissions are a mess everywhere.

---

## 4. Deal resolution

### 4.1 The identifier

Not company name (too fuzzy: "Pioneer Metering" vs "Pioneer Metering (Pty) Ltd"). Not domain alone. The strongest signal is **attendee email overlap with the pre-call brief** — if `sunil@pioneermetering.co.za` appears in both, that is the same human, not a fuzzy match.

| Rank | Signal | Strength |
|---|---|---|
| 1 | Exact prospect email in both brief and participant list | Near-certain |
| 2 | Email domain matches brief domain | Strong |
| 3 | Brief created within 30 days, same SE | Corroborating |
| 4 | Company name fuzzy match | Weak — tiebreaker only |
| 5 | Calendar / meeting title contains account name | Weak |

### 4.2 The failure case that matters

**One account, several open deals.** Acme running FD Omni with one SE and Freshservice with another. Domain matches both. Nothing in the transcript header disambiguates. Auto-matching silently attaches a demo score to the wrong opportunity and nobody notices for a quarter.

This is also the argument for the account module: seventeen accounts have more than one deal, and a deal-only view cannot see the collision.

### 4.3 Behaviour

| Condition | Behaviour |
|---|---|
| Exactly one candidate above threshold | Auto-tie. Confirmed banner with a change link. One glance, no click. |
| Two or more above threshold | Show top 3 with **why each matched**. SE picks. |
| Nothing above threshold | Search box + create-new prefilled from participants. |

Mis-attribution is expensive and silent. Confirmation costs one glance. Bias toward asking.

---

## 5. Pipeline

Separate model calls per module. One mega-prompt degrades on every dimension at once and you cannot tell which part broke.

```
Pass 0  RESOLVE         no LLM — fetch recording, participants, match deal
                        ↓
Pass 1  CALL TYPE       cheap + fast — transcript opening, title, share shape
                        ↓
                  ██ HUMAN CONFIRMS ██   ← everything downstream gates on this
                        ↓
Pass 2  VIDEO           frame sampling — camera %, share segments, attendee curve
                        ↓
   ┌──────────┬───────────┬───────────┬───────────┬───────────┐
Pass 3       Pass 4      Pass 5      Pass 6      Pass 7
SCORECARD    QUALIF.     TECH        PRODUCT     COMMITMENTS
(QIP)        (MEDPICC)   COMMIT      GAPS        → MoM + notes
   └──────────┴───────────┴───────────┴───────────┴───────────┘
                        ↓
Pass 8  TRACTION        hot / warm / cold — consumes 4, 5, 7
                        ↓
Pass 9  SUMMARIES       deal summary + account summary, read everything
```

Passes 3–7 run in parallel, all consuming passes 1 and 2 plus the pre-call brief.

**Pass 0 — Resolve.** Fetch recording, extract participant emails, run §4 matching, return ranked candidates with match reasons.

**Pass 1 — Call type.** Emits primary type + confidence + mix (`discovery: 0.4, demo: 0.6`). Above threshold the field is prefilled and nobody thinks about it; below, the dropdown opens itself. Every override is logged — that log tells you where the taxonomy is wrong, which it will be, because real calls are hybrids.

**Pass 2 — Video.** Outputs *facts*, not judgements:
- Camera-on percentage, **sampled across the call** — never one screenshot. On for 90 seconds then off is a different behaviour from on throughout.
- Share segments with timestamps → the timeline of events, nearly free
- Attendee count over time → catches people dropping mid-call
- Per-participant talk time and camera state → stakeholder profiles
- Customer cameras on → engagement signal, belongs to the **deal**, not the SE's score

*Cost control:* a 45-minute call at 10s sampling is 270 frames. Two-tier it — cheap frame-diffing for state tracking (face present, share region present, scene changed), and 15–20 keyframes to the vision model for judgement calls (CDE customization, deck quality). Fifteen good frames beat 270 mediocre ones.

**Pass 3 — Scorecard.** Consumes call type (which rubric), timeline (call flow), video facts (camera, CDE), brief (research & agenda). Every line emits **score + evidence + coaching note**.

**Pass 4 — Qualification.** MEDPICC, each element with evidence or an explicit "not surfaced."

**Pass 5 — Technical commit.** The whiteboard decomposition: incumbent, competitor, identified risk, timeline for closure, reason for evaluation, AI attach, what's working. Each emitted with a delta flag against the prior snapshot.

**Pass 6 — Product gaps.** Structured per §8, plus an embedding of the raw verbatim for clustering. Also emits the positive half — what landed.

**Pass 7 — Commitments.** Commitments made aloud, unanswered questions, promised builds, discovery fields still unknown. Call notes and the MoM draft both come from this.

**Pass 8 — Traction.** Hot / warm / cold with visible reasons and one recommended action.

**Pass 9 — Summaries.** Deal summary and account summary, both rewritten after every call. Always current, unlike the human-typed field they replace.

---

## 6. Scoring framework

> **Superseded for scoring math and profiles:** Implementation must follow [QIP_SCORING_V2_1.md](./QIP_SCORING_V2_1.md) — credits (3/2/1), five sub-parameters (0/1/2), overall QIP out of 10, five category scores, deal risk log. The v1.0 weight tables below are historical reference only.

### 6.1 Shared theme library, per-type weight profiles

**Do not build eight unrelated rubrics.** One vocabulary of themes; each call type selects a subset and assigns weights summing to 100.

This buys the thing separate rubrics destroy: **composite scores compare only within a type, but theme scores compare across all of them.** A manager can ask "how is Nivedha on Questions" across every call she ran. They cannot ask "what's her QIP score" as one number — surfaces must show per-type averages or theme-level, never a blend. A leaderboard of blended composites would quietly reward whoever runs the easiest call mix.

### 6.2 All eight profiles

**Demo — 100** *(from the existing Evaluation Blueprint; weights as-is)*

| Theme | Wt | | Theme | Wt |
|---|---|---|---|---|
| Research & agenda | 5 | | Value | **10** |
| Questions | 5 | | Objections | 5 |
| Slide deck | 5 | | Case study & ROI | 5 |
| CDE / build | **10** | | Comp pitch | 5 |
| Solutioning | 5 | | Summarise | 5 |
| Storytelling | 5 | | Camera on | 5 |
| Call flow | **10** | | Customer engagement | **10** |
| AI | 5 | | CTA | 5 |

Technical 80 / non-technical 20. Four items carry 40 of 100: **CDE/build, Call flow, Value, Customer engagement.** No dashboard should treat a comp-pitch miss as equal to a call-flow miss.

**Discovery — 100**

| Theme | Wt |
|---|---|
| Questions | **20** |
| Research & agenda 10 · Incumbent & competition 10 · Pain qualification 10 · Value 10 · Call flow 10 |
| AI 5 · Objections 5 · Summarise 5 · Camera on 5 · Customer engagement 5 · CTA 5 |

**Technical deep dive — 100**

| Theme | Wt |
|---|---|
| Technical accuracy | **20** |
| Solutioning 15 · CDE / build 15 |
| Architecture fitment 10 · Questions 10 · Objections 10 |
| Value 5 · Call flow 5 · Customer engagement 5 · Camera on 5 |

**Reverse demo — 100**

| Theme | Wt |
|---|---|
| Handover discipline | **20** |
| Task design 15 · Coaching without taking over 15 |
| Setup & framing 10 · Observation & note capture 10 · Customer engagement 10 |
| Objections 5 · Call flow 5 · Summarise 5 · Camera on 5 |

**Use case discussion — 100**

| Theme | Wt |
|---|---|
| Solutioning | **20** |
| Questions 15 · Value 15 |
| Research & agenda 10 · Storytelling 10 · Customer engagement 10 |
| AI 5 · Objections 5 · Call flow 5 · Summarise 5 |

**Trial setup — 100**

| Theme | Wt |
|---|---|
| Exit criteria defined | **20** |
| Success metrics agreed 15 · Admin & access enablement 15 |
| Cadence & checkpoints 10 · Stakeholder mapping 10 · Risk identification 10 · Customer engagement 10 |
| Solutioning 5 · Camera on 5 |

**Troubleshooting — 100**

| Theme | Wt |
|---|---|
| Problem diagnosis | **20** |
| Technical accuracy 15 · Resolution or clear path 15 |
| Expectation setting 10 · Customer reassurance 10 · Escalation handling 10 · Documentation & follow-up 10 |
| Call flow 5 · Camera on 5 |

**Q&A session — 100**

| Theme | Wt |
|---|---|
| Question handling | **25** |
| Technical accuracy 20 · Objections 15 |
| Value 10 · Customer engagement 10 · Call flow 10 |
| Summarise 5 · Camera on 5 |

### 6.3 Theme library

Roughly 38 themes across the eight profiles. Existing: `research & agenda` `questions` `slide deck` `CDE / build` `solutioning` `storytelling` `call flow` `AI` `value` `objections` `case study & ROI` `comp pitch` `summarise` `camera on` `customer engagement` `CTA`

Added by the newer profiles, each still needing anchors: `technical accuracy` `architecture fitment` `handover discipline` `task design` `coaching without taking over` `setup & framing` `observation & note capture` `exit criteria defined` `success metrics agreed` `admin & access enablement` `cadence & checkpoints` `stakeholder mapping` `risk identification` `problem diagnosis` `resolution or clear path` `expectation setting` `customer reassurance` `escalation handling` `documentation & follow-up` `question handling` `pain qualification` `incumbent & competition`

### 6.4 Anchors

Unanchored rubrics drift call to call and scores become noise. "Storytelling: 1–5" produces mush. Every theme needs anchored levels. Worked example:

**Storytelling — persona-led narrative**

| Score | Anchor |
|---|---|
| **5** | Named personas across all three lenses (end user, agent, admin), set in the customer's own industry using their vocabulary, carried as one continuous thread through the demo |
| **4** | Two or three personas, industry-relevant, mostly sustained but drops in places |
| **3** | Personas named but generic ("a customer", "an agent"), or industry framing that doesn't persist past the opening |
| **2** | Occasional narrative gesture, mostly feature walkthrough |
| **1** | Pure feature tour — "here's the ticket list, here's the automation builder" |

> **Per-product persona sets.** In Freshservice the "user" is an employee, not a customer. An SE who runs the FD persona set at an ITSM buyer should lose points for it.

**Writing the remaining ~37 anchors is the highest-leverage unglamorous task in this build.** Nothing downstream is trustworthy without them, and it needs the people who have been hand-scoring, not a model.

### 6.5 Scorability by source

| Theme | Source | Confidence |
|---|---|---|
| Call flow | Share track timestamps | High |
| Customer engagement | Talk ratio, customer question count, cameras | High |
| Questions, Value, Solutioning, Storytelling, AI, Objections | Transcript | High |
| Research & agenda | **Diff against pre-call brief** | High |
| CDE / build | Vision — is the tenant the customer's, or "Acme Corp" with stock seed data | Medium-high |
| Camera on | Zoom video state, sampled | High — **never inferred from transcript** |
| Slide deck | Proxies only — referenced? customer-specific? how long before product appeared? | **Low — flag it** |

### 6.6 Shadow mode for the newer profiles

Eight profiles is eight calibration problems. Demo and discovery have hand-scored history; troubleshooting, trial setup, Q&A, reverse demo have none because nobody has ever graded them.

**Ship demo and discovery live, the other six in shadow.** Scores compute and store but display as `provisional` and are excluded from averages, the coaching queue, and the team heatmap until consistency and volume gates pass — see `QIP_PROFILES.md` §6 (~20 shadow calls, composite SD ≤ 5, no theme SD > 15, dispute rate stable). Same code path, same tables — one boolean and an exclusion in the aggregation query. Promote one profile at a time; live profiles still suppress individual themes with SD > 15 until anchored.

---

## 7. ARR engine

### 7.1 Principle

ARR is **derived deterministically from a versioned price book**, never inferred by a model and never asked of an SE. The model extracts *inputs* only; arithmetic happens in a pure function.

A model asked to "estimate ARR" produces a plausible number with no audit trail. A function multiplying an extracted agent count by a table row produces a number you can point at and argue about — which is exactly what the SE will want to do.

### 7.2 Formula

```
ARR = Σ seats × unit_price(product, tier, currency, term) × 12 × (1 − discount)
    + Σ projected_annual_units × unit_price(addon, currency)
    − included_allowances
```

Worked example (Pioneer Metering, as shown on the deal record):

```
base    14 agents × $29/agent/mo  (FD Omni Growth, annual)  × 12 = $4,872
copilot 14 seats  × $29/agent/mo  (Freddy AI Copilot)       × 12 = $4,872
usage   AI Agent sessions — never discussed, excluded              $0
discount 0 (not extractable pre-contract)
────────────────────────────────────────────────────────────────────────
point estimate                                                  = $9,744
displayed band (tier unconfirmed — see 7.6)                = $15K–$20K
```

### 7.3 Price book schema

Effective-dated. A deal from Q1 must be valued at Q1 prices. Never overwrite a price row; close it and insert a new one.

```
price_book
  product        fd_support | fd_omni | freshservice | freshsales
  tier           growth | pro | enterprise
  currency       USD | EUR | INR | ZAR | SGD
  term           annual | monthly
  unit           per_agent_month
  price          decimal
  effective_from date
  effective_to   date | null
  source         list | regional_list | negotiated_floor

addon_price_book
  addon          copilot | ai_agent_sessions | day_pass | field_service
  applies_to     product[]
  requires_tier  tier[] | null
  unit           per_agent_month | per_100_sessions | per_unit
  price          decimal
  included_units int
  included_scope per_account_once | per_billing_cycle
  currency, term, effective_from, effective_to
```

### 7.4 Seed values — public list, USD, annual

**Verify every row against the internal price book before shipping.** These are public list prices and will not match negotiated or regional pricing.

| Product | Growth | Pro | Enterprise |
|---|---|---|---|
| Freshdesk (support desk) | $19 | $55 | $89 |
| Freshdesk Omni | $29 | $79 | $119 |
| Freshservice | *fill from internal book* | | |
| Freshsales | *fill from internal book* | | |

| Add-on | Price | Notes |
|---|---|---|
| Freddy AI Copilot | $29 /agent/mo annual · $35 monthly | Pro and Enterprise only. Purchasable for a **subset** of agents. |
| Freddy AI Agent | $49 per 100 sessions | First 500 included once per account on Pro/Ent. Sessions **expire each cycle, no rollover.** |

Monthly billing runs roughly 20% above annual — store as separate rows, not a multiplier; the ratio is not constant across tiers.

Seed sources: <cite index="6-1">Freshdesk splits into two lines — classic email and ticketing at $19, $55 and $89 per agent per month on annual billing, and Omni at $29, $79 and $119</cite>. <cite index="2-1">Copilot is documented as a flexi add-on starting at $29 per agent monthly on annual billing or $35 monthly, purchasable for a subset of agents, while the AI Agent is session-based with the first 500 sessions included and $49 per 100 thereafter</cite>.

### 7.5 Extraction traps

| Input | Trap |
|---|---|
| **Agent count** | **"We have 200 people" is not 200 agents.** Support headcount ≠ company headcount. Extract *licensed support agents*. Largest single source of drift. |
| **Product** | Omni vs support desk is a $10–$30/agent/month fork. If WhatsApp or live chat is in scope, it is Omni. Worse to get wrong than the tier. |
| **Tier** | Almost never stated aloud. Infer from features discussed (SLA + routing → Growth minimum; multilingual, custom roles → Pro+). Flag low confidence, widen the band. |
| **Term** | Rarely discussed. Default annual, store the assumption. |
| **Copilot seats** | "14 of 40" is common. Do not assume parity with base seats. |
| **AI Agent sessions** | Usage-based, **not derivable from agent count.** Include only if a ticket or chat volume was stated. Otherwise exclude and record the exclusion. |
| **Discount** | Not extractable pre-contract. Always 0. |
| **Currency / region** | Look up the regional row. **Never FX-convert a USD list price** into a local estimate. |

### 7.6 Confidence bands

Output a range, not a point. Width is driven by which inputs are uncertain, not a flat percentage.

```
band_width = 10% base
  + 25%  agent count inferred rather than stated
  + 20%  tier inferred rather than stated
  + 15%  product line ambiguous (support vs omni)
  + 30%  usage components in scope but unquantified
```

Display bands. "$15K–$20K" reads as an estimate. "$9,744" reads as a fact and invites an argument nobody can win.

### 7.7 Storage and reconciliation

```
arr_estimate_low, arr_estimate_high, arr_estimate_point
arr_actual              -- Salesforce opp.Amount only
arr_source              -- derived_from_agents | opp_amount | se_override
arr_price_book_version
arr_inputs_json         -- full extraction, so the number is reproducible
arr_computed_at
```

- **Estimate and actual are separate columns.** The delta is the calibration signal — if derived numbers run consistently 30% under closed amounts, seat extraction is missing something.
- **Snapshot ARR onto the call record.** Accounts change size; a gap logged in Q2 must not be silently revalued in Q4, or "ARR touched by this gap" becomes fiction.

### 7.8 Reference implementation

```python
def compute_arr(inputs, price_book, as_of):
    lines, notes = [], []

    base = price_book.lookup(
        product=inputs.product, tier=inputs.tier,
        currency=inputs.currency, term=inputs.term, as_of=as_of)
    lines.append(inputs.agents * base.price * 12)

    for addon in inputs.addons:
        p = price_book.lookup_addon(addon.key, inputs.product,
                                    inputs.currency, inputs.term, as_of)
        if p.requires_tier and inputs.tier not in p.requires_tier:
            notes.append(f"{addon.key} unavailable on {inputs.tier}")
            continue
        if p.unit == "per_agent_month":
            lines.append(addon.seats * p.price * 12)
        elif p.unit == "per_100_sessions":
            if addon.annual_units is None:
                notes.append(f"{addon.key} in scope but unquantified — excluded")
                continue
            billable = max(0, addon.annual_units - p.included_units)
            lines.append(billable / 100 * p.price)

    point = sum(lines)
    w = band_width(inputs)
    return ARR(point=point, low=point*(1-w), high=point*(1+w),
               source="derived_from_agents",
               price_book_version=price_book.version,
               inputs=inputs, notes=notes)
```

Pure function. Same inputs, same price book, same answer — and re-runnable when the price book changes.

---

## 8. Product gap taxonomy

The mistake to avoid: mixing product surfaces with cross-cutting concerns in one flat list. "Data residency" and "WhatsApp channel" are not the same kind of thing. **Two axes.**

### Axis 1 — Product area (routes to an owner)

| Area | Sub-areas |
|---|---|
| Ticketing & workflow | Ticket lifecycle · SLA & escalation · Automation & routing · Forms & fields |
| Channels | Email · WhatsApp · Chat & messaging · Voice · Social · In-app |
| AI — customer facing | AI Agent / bot · Deflection · Self-service · Knowledge answers |
| AI — agent facing | Copilot · Summarization · Drafting · Next-best-action |
| AI — platform | Model config · Guardrails · Training & tuning · AI analytics |
| Knowledge | KB authoring · External sources · Search · Multilingual |
| Reporting & analytics | Prebuilt reports · Custom reports · Dashboards · Data export |
| Admin & config | User & role management · Bulk config · Sandbox · Migration tooling |
| Integrations & extensibility | Native integrations · API · Webhooks · Marketplace · Custom apps |
| ITSM-specific | Asset & CMDB · Change & release · Project & PPM · Contracts |
| CRM / sales-specific | Pipeline · Sequences · Quoting · Forecasting |
| Platform | Performance & scale · Uptime · Mobile · Accessibility · UI/UX |
| Commercial | Packaging · Pricing · Licensing model · Contract terms |

### Axis 2 — Cross-cutting tags (orthogonal, multi-select)

`data residency` · `security & compliance` · `localization` · `scale limits` · `accessibility` · `migration` · `TCO`

**Why two axes:** five ASEAN deals raised data residency — against AI, against knowledge, against channels. One axis and it fragments into three unrelated rows. Two axes and it's one $88K story with a clear owner.

### Per-gap fields

| Field | Values |
|---|---|
| Product area | Axis 1, fixed list |
| Cross-cutting tags | Axis 2, multi-select |
| Verbatim | Customer's own words, always retained |
| Disposition | Hard blocker · Workaround offered · Roadmap deflection · **SE didn't know** |
| Deal impact | Blocker · Friction · Nice to have |
| Competitor named | And whether they were said to do it better |
| Gap type | **Real gap** vs **enablement gap** |
| ARR touched | Joined from the opportunity, never asked |
| Embedding | Over the verbatim, for clustering |

> **Real vs enablement gap.** A third of "product gaps" turn out to be things the product already does and the SE didn't know about. Routing those to product wastes a PM's week; routing them to enablement fixes the actual problem.

### What's working

The positive half is a first-class object, not an afterthought: what landed, the verbatim, the product area, and whether the account is a reference candidate. This is where case studies come from, and it's the half that makes product actually read the dashboard.

### Governance

Fixed list, no free text into area. Keep an `Other` bucket, review monthly — a term appearing five times becomes a sub-area. **Version the taxonomy** so v1 classifications stay interpretable when v2 lands. Cluster over embeddings of verbatims, not labels — that catches the theme the taxonomy didn't anticipate.

---

## 9. Cross-cutting rules

Each is cheap now and expensive to retrofit.

**Evidence per line item.** A score without a timestamped quote is a score the SE wins the argument about. Every scorecard line carries score + evidence + coaching note.

**Visible denominators and profile names.** `86 / 100 (demo v1.2)` and `71 / 100 (discovery v1.0)` are different objects. Show the profile on every score.

**Human override on every score, logged.** Not for adoption — for **calibration**. The log is how you discover the model is systematically generous on Storytelling and harsh on Objections. Store original, override, who, when, reason.

**Confidence score per call.** A 78 where 30 points came from low-confidence inference is a different object from a 78 on clean signals. Only high-confidence calls feed the coaching queue.

**Hot / warm / cold, not 0–100.** It's how the team already talks, and nobody argues about whether a deal is a 61 or a 67 when the label is "warm." Always with visible reasons and one recommended action.

**MoM is the only customer-facing output.** Different trust bar entirely. Human edits before send. **Never auto-send.** Track `sent_at` — drafted-but-never-sent is itself a useful metric.

**Call notes ≠ MoM.** Notes are internal and blunt ("the call ended without a customer-owned next step, which is what turned a good demo into 60 days of silence"). MoM is customer-facing and diplomatic. Generate them separately; never derive one by lightly editing the other.

**Rubric versioning.** Version the rubric on every scorecard row so weight changes leave old scores interpretable and re-runs explicit.

---

## 10. Data model

```
accounts              id, name, domain, industry, region, sub_region, hq,
                      support_agent_count, incumbent, competitor,
                      reason_for_evaluation, why_ai

deals                 id, account_id, sf_opportunity_id, name, stage, product,
                      ae_id, se_id, close_date, created_at, updated_at,
                      functional_fitment, technical_fitment, competitive_position,
                      copilot_flag, copilot_agents, forecast_month,
                      arr_estimate_low, arr_estimate_high, arr_estimate_point,
                      arr_actual, arr_source, arr_price_book_version,
                      arr_inputs_json, arr_computed_at

briefs                id, deal_id, account_id, created_at, agenda_json,
                      suggested_questions, flagged_incumbent, flagged_competitor,
                      stakeholder_profiles_json, prospect_emails[]

calls                 id, deal_id, account_id, brief_id, recording_url, deck_url,
                      occurred_at, duration_s, call_type, call_type_confidence,
                      call_type_mix_json, call_type_overridden_by,
                      rubric_version, analysis_confidence, provisional,
                      match_method, match_confidence, call_notes,
                      arr_snapshot, sequence_index

call_participants     call_id, email, name, title, is_internal, role_guess,
                      camera_on_pct, talk_time_pct, joined_at, left_at

video_facts           call_id, camera_on_pct, keyframe_refs[], attendee_curve_json,
                      cde_customized, cde_evidence

timeline_segments     call_id, start_s, end_s, segment_type
                      (slides | product | cde | customer_screen | none), label

timeline_markers      call_id, at_s, kind (gap | objection | win | weak_cta), label

rubrics               id, call_type, version, total_points, active
rubric_themes         rubric_id, theme_key, weight, anchors_json

scorecards            id, call_id, rubric_id, raw_score, denominator,
                      confidence, provisional
scorecard_lines       scorecard_id, theme_key, score, max_score, applicable,
                      confidence, evidence_json[], coaching_note
score_overrides       scorecard_line_id, original, override, user_id,
                      reason, created_at

qualification         call_id, deal_id, framework, metrics, economic_buyer,
                      decision_criteria, decision_process, paper_process,
                      identified_pain, champion, competition
                      -- each {value, evidence, surfaced bool}

technical_commit      deal_id, status (yes|no|pending|at_risk), justification,
                      incumbent, competitor, identified_risk,
                      timeline_for_closure, reason_for_evaluation, ai_attach,
                      updated_at            -- CURRENT STATE, lives on the deal

tc_deltas             call_id, deal_id, field, previous, current,
                      change_type (confirmed|changed|new), evidence
                                            -- PER-CALL MOVEMENT, lives on the call

product_gaps          id, call_id, deal_id, account_id, product_area, sub_area,
                      cross_cutting_tags[], verbatim, disposition, deal_impact,
                      gap_type, competitor_named, arr_touched, embedding,
                      taxonomy_version, status
gap_clusters          id, label, centroid, deal_count, arr_total, status

what_works            id, call_id, account_id, product_area, verbatim,
                      reference_candidate

follow_ups            id, call_id, deal_id, description, owner (se|ae|customer),
                      due_date, status, source_quote
objections            id, call_id, objection_text, handling, landed, theme

deal_signals          call_id, deal_id, traction (hot|warm|cold), reasons_json[],
                      recommended_action, days_silent, next_step_owner,
                      days_in_stage, stage_median_days

mom_drafts            call_id, draft_body, edited_body, sent_at, sent_by
deal_summaries        deal_id, summary, generated_at, source_call_ids[]
account_summaries     account_id, summary, generated_at, source_call_ids[]

price_book            (see §7.3)
addon_price_book      (see §7.3)
```

---

## 11. Surfaces

### 11.1 Pre-call
Form per §3.1, then the generated brief. Shows explicitly which brief output grades which post-call theme — that mapping is the argument for why pre-call and post-call are one product rather than two tools.

### 11.2 Post-call
Recording link, company, emails, optional deck/LinkedIn/context. Matched-deal banner with the match reason. Call-type dropdown pre-filled with confidence. Fifteen seconds when the match is clean.

### 11.3 All calls
Every call: type, account, deal, date, length, **QIP**, what it moved on the technical commit, whether the MoM was sent. Filter by type and window. Metrics: call count, hours, MoM sent ratio, calls with no next step, gaps surfaced.

### 11.4 Call record
The deepest object in the product.

- **Deal context strip** — deal, stage, ARR, TC status, AI attach, traction, position in sequence. The call never floats free of its deal.
- **Verdict strip** — QIP with delta vs the SE's average, MEDPICC, traction, analysis confidence, and a one-line read of the tension between them
- **Call notes** — internal narrative summary, editable
- **Stakeholder profiles** — everyone in the room: title, talk share, camera state, attendance pattern, role inference, attendance history across the deal
- **Timeline of events** — share segments as a spine with markers pinned at the moments that mattered
- **Tabs:** QIP scorecard (expandable rows, evidence inline) · Technical commit (whiteboard decomposition with per-call deltas, pending actions, what's working, fitment) · Deal health (MEDPICC, objections, traction reasons) · Product signal · Minutes

### 11.5 Accounts
List: account, region, deal count, total ARR, products in play, calls, health, last touch.

Record: generated account summary spanning every call across every deal · firmographics · **all deals** · **all calls** chronologically · gaps raised · ARR derivation panel showing the working · contacts with an explicit empty state when no economic buyer exists · reason for evaluation and why-AI.

*Why separate from deals:* cross-sell is invisible from a deal list. Seventeen accounts have more than one deal, and the second product is usually mentioned once on a call and never followed up.

### 11.6 My deals
List sorted by **traction**, not close date — close date is what the SE typed in April. Columns: deal, account, stage, ARR, calls, MEDPICC, TC, AI attach, traction, days silent. **No QIP column.**

Record: deal summary · MEDPICC · deal velocity (days in stage vs stage median) · traction with reasons and recommended action · fitment · technical commit with justification · calls on the deal showing what each one moved · ARR derivation · collapsed reporting fields.

### 11.7 My coaching
Private. Per-type averages (never blended), theme bars comparable across types, score trend, weakest theme with timestamped receipts, dispute button on every score.

### 11.8 Team
**Heatmap that reads down the columns.** If comp pitch and ROI are red for five of six SEs, that's one missing battle card, not five coaching conversations. Structurally hard to use as a leaderboard.

Full drill-down; every number is a link:
```
Team ─ heatmap cell ──→ SE detail, theme expanded
     ─ SE row       ──→ SE detail
     ─ metric card  ──→ filtered list

SE detail ─ accounts ──→ Account ──→ Deal ──→ Call ──→ scorecard line ──→ quote
          ─ calls    ──→ Call
          ─ receipts ──→ Call, scorecard tab, theme expanded
```
Three clicks from "the team is weak on comp pitch" to the exact sentence in the exact call. A coaching conversation that starts with evidence is a different conversation from one that starts with a number.

### 11.9 Pipeline review
Leadership. Whiteboard order: descending by agent count / ARR · TC yes/no · blockers · hot/warm/cold · pending action items · AI attach. Quarter and sub-region filters.

> **AI attach appears three times on the whiteboard** — inside technical commit, in the roll-up table, and in the pipeline review. Not a field: a first-class metric with its own column everywhere it fits.

### 11.10 Product signal
Clusters, not rows. **What's not working** (gaps, blockers, real vs enablement) and **what's working** (reference and case study pipeline). Plus why customers opt into AI and why they don't — reason-for-evaluation and why-AI were columns 17 and 18 of the TC sheet; here they're the punchline. Residency showing up as both the top blocker and the top AI-decline reason is one root cause the spreadsheet could never surface, because the two facts lived in different columns and nobody joined them.

**Close the loop.** Every gap shows the SE what happened to it. If an SE files feedback into a void, they file it once.

---

## 12. Open decisions

| # | Decision | Why it blocks |
|---|---|---|
| 1 | **Remaining ~37 anchors** | Unanchored rubrics drift; scores become noise. Needs the hand-scorers, not a model. |
| 2 | **Freshservice and Freshsales price rows** | ARR is wrong for every non-Freshdesk deal until these exist. |
| 3 | **Degenerate inputs** | 8-minute call, customer no-show, single-speaker transcript, recording won't fetch. "Score it anyway" is the wrong answer. |
| 4 | **Re-runs** | Same recording twice; rubric changed and you want to rescore. Version on the row or old scores become uninterpretable. |
| 5 | **Permissions** | SE sees own · manager sees team · leadership sees roll-up · product sees gaps across everyone. Decide before the first dashboard query is written. |
| 6 | **Calibration set** | Hand-scored history is labelled training data. Run the model against it, inspect per-theme deltas, **before anyone sees a score.** |
| 7 | **Per-product persona sets** | FD vs Freshservice vs CRM — the "user" persona differs and Storytelling scoring depends on it. |
| 8 | **Consent for visual analysis** | Zoom's recording notice covers recording. It probably does not cover automated visual analysis of customer faces. A two-line check with legal is far cheaper now than unwinding later. |

---

## 13. Build sequence

**Phase 1 — the spine.** Pass 0 resolve → Pass 1 call type → Pass 2 video → Pass 3 scorecard (demo and discovery live, rest shadow) → Pass 7 commitments → call notes + MoM. Surfaces: post-call, call record, all calls.

**Phase 2 — the deal.** Pass 4 MEDPICC → Pass 5 technical commit → Pass 8 traction → Pass 9 summaries → ARR engine. Surfaces: my deals, deal record, accounts.

**Phase 3 — the audiences.** Product signal first (it's what gets noticed by the PM org) → team heatmap and drill-down → pipeline review.

**Phase 4 — breadth.** Calibrate and promote the six shadow profiles → deck-diff scoring → pre-call and post-call fully joined.

**Throughout:** override logging from day one. It costs nothing now and it is the only calibration signal you will ever get.

---

## 14. Note on v2 ingestion

Zoom and Salesforce connect directly. Every call lands automatically, `arr_source` flips from `derived_from_agents` to `opp_amount` with nothing downstream breaking, and the post-call page becomes a manual override rather than the front door. **The intake screen is scaffolding — do not polish it past functional.** The surfaces are what survive.

One thing survives the change to automatic capture: mandatory ingestion removes selection bias but **not rubric gaming**. If anything it sharpens it, because every call now counts and the only lever left is performing for the scorecard. Keep human override, keep the log, keep evidence on every line.
