# Addendum 2 — Conversation Volume, Sessions and SE Input

Amends `ADDON_ARR.md` §1 and §2. Supersedes the treatment of AI Agent sessions as a directly
stated quantity.

**The problem:** customers state *conversation volume*. Nobody says "we need 72,000 AI sessions."
Extracting sessions directly means the field is almost always empty, and the largest add-on line on
AI deals silently vanishes from every ARR figure.

**The rule:** sessions are **50% of conversation volume.**

---

## 1. The chain

```
STATED     "about 12,000 support conversations a month"
             ↓  normalise
NORMALISED 144,000 conversations / year
             ↓  × 0.5   (ai_session_rate)
SESSIONS   72,000 / year
             ↓  − 500 account allowance,  ÷ 100,  round up
BILLABLE   715 packs × $49 = $35,035
```

One stated fact, one assumption. Both displayed, both editable.

On a 40-agent Omni Pro deal that lands at **$77,827** — base $37,920, Copilot $4,872, sessions
$35,035. Sessions are **45%** of the deal. That single rate is the most load-bearing number in the
ARR engine, which is why it lives in a versioned table and not in code.

---

## 2. Replaces ADDON_ARR.md §1 — what to extract

```
DO NOT ask the model for session counts. Ask for VOLUME, which is what customers actually say.

  conversationVolume
    value       number
    unit        per_day | per_week | per_month | per_year
    basis       average | peak | projected
    channelMix  optional array of { channel: email|chat|voice|social|whatsapp|portal, share }
                Capture only if described. "Mostly email and chat" is a real signal even without
                percentages. Not used in pricing today — stored for later.
    evidence    the quote
    confidence  0..1

  Also capture when stated, same shape:
    ticketVolume    may equal conversation volume, may not — never silently equate them
    connectorTasks  per month, if an integration volume was discussed

RULES
- basis matters. "We peak at 20,000 in December" is not an annual run rate. Never annualise a
  stated peak as if it were the average — flag it for the SE to resolve.
- Never convert conversations to sessions in the prompt. That multiplication belongs in compute.ts
  where it can be inspected and overridden.
- AI discussed but no volume given at all → { inScope: true, value: null }. Line excluded, reason
  visible. Never guess a volume from agent count.
```

## 3. The assumptions book

```
Assumptions get the same treatment as prices: versioned and effective-dated, so a Q2 estimate
still reproduces in Q4 after the rate changes. Same reasoning as spec §7.3.

  assumptions_book
    key           ai_session_rate | peak_to_average_ratio | conversations_per_ticket
    scope         global | product | channel | region
    scopeValue    e.g. "voice", "freshdesk_omni", "IN"
    value         number
    source        benchmark | internal_estimate | placeholder
    rationale     short text
    effectiveFrom, effectiveTo, version

SEED — one row resolves pricing today:

  { key: "ai_session_rate", scope: "global", value: 0.5,
    source: "internal_estimate",
    rationale: "Half of conversation volume assumed to reach the AI agent" }

  { key: "peak_to_average_ratio", scope: "global", value: 1.0,
    source: "internal_estimate",
    rationale: "No automatic adjustment — stated peaks are flagged, never scaled" }

Keep channel and region scopes in the SCHEMA but unpopulated. Global resolves everything for now;
when voice-heavy deals prove 50% is wrong for phone, adding a channel row is a data change rather
than a migration.

Store assumptionsBookVersion on the deal beside arrPriceBookVersion.
```

## 4. Compute

```
In worker/src/arr/compute.ts:

  normalise(volume, unit)                    -> annual conversations
  × aiSessionRate(scope)                     -> annual sessions
  − accountAllowance (500, once per account) -> billable
  ÷ 100, round UP, × unitPrice               -> annual cost

Emit the full chain into arr_lines.derivationJson, not just the final number:

  [ { step: "stated",     value: 12000, unit: "per_month", evidence: "<quote>", source: "call" },
    { step: "normalised", value: 144000, unit: "per_year" },
    { step: "sessions",   value: 72000, assumptionKey: "ai_session_rate",
      assumptionValue: 0.5, assumptionSource: "internal_estimate" },
    { step: "billable",   value: 71500, note: "less 500 account allowance" },
    { step: "priced",     packs: 715, unitPrice: 49, annualValue: 35035 } ]

CONFIDENCE COMPOUNDS. A stated volume at 0.9 through a 0.5-confidence rate is not a 0.9 line.
Multiply through and let the line reflect its weakest link.

The line is INCLUDED in the total, marked assumed:true until an SE confirms or overrides.
Excluding it would make AI-attached deals look identical to non-AI deals in every revenue view,
which defeats tracking AI attach as a first-class metric. Including it with the chain visible and
the confidence honest is the only version that survives a deal review.
```

## 5. The SE input surface

```
This decides whether anyone trusts the number. Build it properly.

WHERE: inline in the ARR module on the deal record (task 2.6). Not a modal, not a separate form.
The SE is staring at a number they disagree with — the edit belongs where they are looking.

EDITABLE, each independently:
  stated volume and unit · ai_session_rate for this deal · agent count · Copilot seats ·
  connector task volume · a direct session override that bypasses the chain entirely

EACH FIELD SHOWS:
  current value · where it came from (a quote, a named assumption, or a prior SE edit) ·
  what it was before, if edited

Editing recomputes downstream live. The SE watches the total move as they type. That
responsiveness is what turns a report into a tool.

CONFIRM ASSUMPTIONS — one click. Accepts the defaults as reviewed for this deal, flips assumed to
false, raises confidence. Deliberately distinct from editing: "I looked and it's right" is
different information from "I changed it", and both beat silence.

PROVENANCE per step: stated | derived | se_override (with who, when, optional reason).
Extends the arrSource pattern in spec §7.7 from deal level down to line level.

LOG EVERY OVERRIDE. If SEs consistently push the rate from 0.5 to 0.7, the default is wrong and
the log is the only thing that will tell you. Build the report in Phase 4 beside the QIP
calibration harness — same shape of problem.

A deal-level override changes that deal only. Changing assumptions_book is an admin action with
its own permission.
```

## 6. Amend ADDON_ARR.md §5 — the deal ARR module

```
The sessions row expands to show its chain, collapsed by default:

  Freddy AI Agent sessions      715 packs × $49       $35,035   ⚠ assumed
    └ stated      12,000 conversations/month  "we handle about 12,000 a month"
    └ normalised  144,000 / year
    └ sessions    72,000  (50% of volume)                        [edit]
    └ billable    71,500  (less 500 account allowance)
                                                  [ confirm assumptions ]

The ⚠ badge is load-bearing. Forty-five percent of this deal rests on one unreviewed rate, and the
panel must say so rather than presenting $35,035 as equal in standing to the base line.

Badge clears and confidence rises once assumptions are confirmed or overridden.
```

## 7. Unit tests — replaces tests 9–16

```
9.  Normalisation
    12,000/month → 144,000/yr · 400/day → 146,000/yr · 2,500/week → 130,000/yr

10. Standard derivation
    144,000 × 0.5 = 72,000 → less 500 = 71,500 → 715 packs × $49 = $35,035

11. Full deal — 40 agents Omni Pro, 14 Copilot, 12,000 conversations/month
    base 37,920 + copilot 4,872 + sessions 35,035 = 77,827
    Sessions are 45.0% of total

12. Second deal on same account, allowance already consumed
    60,000 conversations/yr × 0.5 = 30,000 sessions, no allowance deducted
    300 packs × $49 = $14,700

13. Peak basis
    "We peak at 20,000 in December" → basis:"peak", NOT annualised, flagged.
    Excluded from total until the SE resolves it.

14. Confidence compounding
    Stated 0.9 × rate confidence 0.5 → line confidence ≤ 0.45, never 0.9

15. SE override of the rate
    0.5 → 0.7 recomputes to 100,800 sessions → 1,003 packs × $49 = $49,147.
    Writes an override record with user and timestamp. Flips assumed:false.

16. Direct session override
    Bypasses the chain. derivationJson records the bypass and retains the original chain.

17. Pack rounding
    71,501 billable → 716 packs, not 715.01

18. No volume stated, AI in scope
    quantity null, inScope true, excluded true, reason "not_quantified".
    Total unchanged, row visible in the panel.
```

---

## One caution worth recording

50% is plausible for chat, messaging and email. It is clearly too high for voice — phone
conversations barely deflect to a text agent.

If a voice-heavy deal comes through, that rate will overstate ARR noticeably. Nothing to do about
it now, and not worth pre-solving. The channel scope staying in the `assumptions_book` schema is
what lets you add a `voice: 0.1` row in five minutes the first time it bites, rather than reworking
the derivation under pressure.
