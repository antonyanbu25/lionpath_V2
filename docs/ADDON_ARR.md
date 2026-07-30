# Addendum — Add-on ARR

Amends tasks 2.5, 2.6 and 2.8 in `cursor-build-pack-phase2-3-4.md`.
Requires `docs/PRICE_BOOK_SEED.md`.

**Why:** on a 40-agent Omni Pro deal with 14 Copilot seats and 2,000 AI sessions a month, add-ons
are $16,387 of $54,307 — 30% of ARR. Base-only pricing is not approximately right, it is
systematically wrong on exactly the deals your product cares most about.

---

## 1. Amend Task 2.5 Part B — extract add-on quantities

Append to the extraction task:

```
ADD-ON QUANTITIES. The model extracts stated quantities only. It never estimates a quantity, and
never derives one from agent count.

Per add-on, return { addonKey, quantity, unit, stated: bool, evidence, confidence }.

  freddy_ai_copilot         quantity = SEATS. Almost never equals base agent count. "14 of our 40"
                            is the normal shape. If a subset is implied but not counted, set
                            stated:false and leave quantity null — never default to agent count.
  freddy_ai_agent_sessions  quantity = SESSIONS PER MONTH. Consumption-based and NOT derivable
                            from agents. Only extract when a volume was actually said.
  connector_app_tasks       quantity = TASKS PER MONTH. Same rule.
  day_pass                  quantity = PASSES PER MONTH. Burst capacity, rarely committed.
  asset_units               Freshservice only. Packs of 500. Price is not published — extract the
                            asset count but expect the lookup to fail.

EXCLUSIONS ARE FIRST-CLASS OUTPUT, not silence. When an add-on is clearly in scope but no volume
was given — "we'll definitely want the AI agent" — return:
  { addonKey, quantity: null, stated: false, inScope: true, evidence: "<quote>" }
The line is excluded from the ARR total AND surfaced in the derivation panel as "in scope, not
quantified". An SE reading "$37,920" needs to see that the AI they spent twenty minutes discussing
is not in that number.

CONTRADICTIONS. Copilot requires Pro or Enterprise (see PRICE_BOOK_SEED.md). If Copilot seats are
extracted on a Growth deal, return the line flagged `tierConflict: true` rather than dropping it or
pricing it. That is a real finding — either the tier read is wrong or the customer was quoted
something impossible.
```

## 2. Amend Task 2.5 Part C — per-add-on unit maths

```
Add-on units are heterogeneous. There is no single formula. Implement each explicitly in
worker/src/arr/compute.ts:

  PER-SEAT (copilot)
    seats × unitPrice × 12
    seats is independently extracted. Never falls back to base agent count.

  CONSUMPTION WITH INCLUDED ALLOWANCE (ai agent sessions)
    annualVolume = monthlySessions × 12
    billable     = max(0, annualVolume − includedUnits)
    cost         = ceil(billable ÷ 100) × 49
    includedUnits is 500 and includedScope is "once_per_account" — see §3 below, this is NOT
    per-deal. Round UP: partial session packs are sold whole.

  CONSUMPTION, NO ALLOWANCE (connector tasks)
    ceil(annualTasks ÷ 5000) × 80

  DAY PASSES
    Excluded from ARR by default. Passes are burst capacity, not committed annual spend, and
    annualising a spiky number produces a confident lie. Compute and store the line with
    excluded:true, reason "not_committed_spend", so it shows in the panel without inflating the
    total. Make this a config flag, not a hard-coded decision.

  QUOTE-ONLY (freshservice asset units, freshservice enterprise base)
    Return null with reason "no_list_price". Never estimate, never fall back to a neighbouring
    tier.

Every add-on line carries its own confidence. A deal with a firm base and a hand-waved session
volume is not uniformly confident, and one number cannot express that.
```

## 3. New — Part F: the 500-session allowance is account-scoped

```
PRICE_BOOK_SEED.md records includedScope "once_per_account" for the 500 free AI Agent sessions.
Not per deal, not per year.

An account with two deals both quoting AI sessions gets 500 free ONCE. Applying the allowance
twice understates ARR on the second deal.

Implement allowance application at ACCOUNT level, not deal level:
1. Compute each deal's raw annual session volume
2. Apply the 500 allowance to the account's earliest-created deal that uses sessions
3. Every other deal on that account bills from session one

Store which deal consumed the allowance on the account so the derivation panel can explain why the
second deal shows no free tier. "Allowance applied to deal X" is the kind of thing an SE will
otherwise raise as a bug.

This is one of the clearest arguments for the account-level module in §5.
```

## 4. New — Part G: `arr_lines` collection

```
ARR breakdown must be queryable, not buried in Deal.arrInputsJson. Per ARCHITECTURE.md rule 3,
"which deals have Copilot attached" is a cross-entity question and needs a collection.

  arr_lines
    id, dealId, accountId, callId
    kind              base | addon
    addonKey          null for base
    quantity, unit
    unitPrice, priceBookVersion
    annualValue
    stated            bool — was the quantity actually said on a call
    inScope           bool — discussed but unquantified
    excluded          bool
    exclusionReason   not_committed_spend | no_list_price | not_quantified | tier_conflict
    confidence
    evidence          the quote the quantity came from
    computedAt

Register in ENTITY_CATALOG.md, ID_STANDARDS.md, RELATIONSHIPS.md and RBAC.md before writing code.

Deal.arrEstimatePoint remains the canonical single number for sorting and filtering — it is the sum
of non-excluded arr_lines. The lines are the derivation; the point value is the interface.

SNAPSHOT ONTO THE CALL. calls.arrSnapshot already stores the point value. Also store the line
breakdown at that moment. A gap logged against a $54K deal must stay attributed to $54K even after
the customer drops Copilot in Q4.
```

## 5. Amend Task 2.6 — ARR module on the deal record

```
The ARR panel on the deal record becomes a full derivation module, reading arr_lines.

  Header       arrEstimatePoint, confidence badge, price book version
  Base line    product, tier, agent count, unit price, annual value, and where the agent count
               came from — the actual quote
  Add-on lines one row each: add-on, quantity, unit, unit price, annual value, confidence
  Excluded     rendered visibly, greyed, WITH REASON. Never hidden, never silently dropped.
               "Freddy AI Agent — discussed, volume not stated — excluded" is the single most
               useful row on this panel
  Conflicts    tierConflict lines flagged in a way that demands attention
  Footer       price book version, computed timestamp, and a re-compute action

Spec §7.1: the SE will want to argue with this number. This module is what lets them argue
productively — every line traceable to a quote, every exclusion explained. A number they cannot
interrogate is a number they will ignore.

Show add-ons as a share of total. "$16,387 of $54,307 — 30% add-on" is a fact a deal review will
actually use.
```

## 6. Amend Task 2.8 — add-on module on the account record

```
New module on the account record, aggregating arr_lines across every deal on the account.

  Total account ARR, split base vs add-on
  Add-on attach matrix — add-ons down, deals across, showing which are attached where
  The 500-session allowance: which deal consumed it (§3)
  Cross-sell gaps — add-ons on one deal and absent from another on the same account

THE ATTACH MATRIX IS THE POINT OF THIS MODULE. Copilot on the new-business deal and absent from
the expansion deal is a cross-sell conversation that is invisible from either deal record alone.
That is the same reasoning as spec §11.5 — a deal-only view cannot see across an account, and the
second product is usually mentioned once and never followed up.

Also surface: add-ons discussed on ANY call on this account but never quantified anywhere. Those
are the conversations that quietly died, and they are worth more than the ones already priced.
```

## 7. Unit tests

```
Add to the 2.5 test suite, using PRICE_BOOK_SEED.md:

1. Base only — 28 agents, Omni Growth
   28 × 29 × 12 = 9744                                              (spec §7.2 worked example)

2. Base + copilot subset — 40 agents Omni Pro, 14 copilot seats
   base   40 × 79 × 12 = 37920
   copilot 14 × 29 × 12 = 4872
   total 42792

3. Full stack with allowance — case 2 plus 2000 sessions/month
   sessions (24000 − 500) ÷ 100 = 235 packs × 49 = 11515
   total 54307, add-on share 30.2%

4. Second deal on same account, 1000 sessions/month, allowance already consumed
   (12000 − 0) ÷ 100 = 120 packs × 49 = 5880
   Asserts the allowance is NOT applied twice

5. Copilot on Growth
   Line returned with tierConflict:true, excluded from total, surfaced in panel

6. Sessions discussed, no volume stated
   Line returned quantity:null, inScope:true, excluded:true,
   exclusionReason "not_quantified". Total unchanged. Panel shows the row.

7. Freshservice Enterprise
   Base returns null, reason "no_list_price". No fallback to Pro. Estimate is null, not partial.

8. Rounding
   1 session over a pack boundary bills a whole pack. 501 annual sessions with allowance consumed
   = 6 packs, not 5.01.
```

---

## What this changes about confidence

Spec §7.6's bands were written for base-only pricing. With add-ons, confidence is no longer one
number for the deal — it is per line, and the deal-level figure is a weighted roll-up.

A deal with a firm 40-agent base and a hand-waved session volume is high-confidence on $37,920 and
near-zero on the rest. Collapsing that to one percentage hides exactly the thing an SE needs to see.

Keep `Deal.arrEstimatePoint` as the single sortable number — that decision stands. But the
derivation module is where the honesty lives, and per-line confidence is what makes it honest.
