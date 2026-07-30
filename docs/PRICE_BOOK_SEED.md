# Price Book Seed — USD list, July 2026

Source: official Freshworks pricing pages, fetched 24 July 2026.

| Product | URL |
|---|---|
| Freshdesk | freshworks.com/freshdesk/pricing/ |
| Freshdesk Omni | freshworks.com/freshdesk/omni/pricing/ |
| Freshservice | freshworks.com/freshservice/pricing/ |
| Freshsales | freshworks.com/crm/pricing/ |

Fills the rows spec §7.4 marked *"fill from internal book"*. Read §7 limitations below before
treating this as complete.

---

## 1. Base plans — USD, per seat per month, billed annually

| Product | Tier | Price | Unit |
|---|---|---|---|
| **Freshdesk** | Growth | $19 | agent |
| | Pro | $55 | agent |
| | Enterprise | $89 | agent |
| **Freshdesk Omni** | Growth | $29 | agent |
| | Pro | $79 | agent |
| | Enterprise | $119 | agent |
| **Freshservice** | Starter | $19 | agent |
| | Growth | $49 | agent |
| | Pro | $99 | agent |
| | Enterprise | **no list price** | agent |
| **Freshsales** | Growth | $9 | **user** |
| | Pro | $39 | **user** |
| | Enterprise | $59 | **user** |

## 2. Add-ons

| Add-on | Applies to | Requires tier | Price | Unit |
|---|---|---|---|---|
| Freddy AI Copilot | all four products | Pro, Enterprise | $29 | agent/month |
| Freddy AI Agent sessions | Freshdesk, Omni | any | $49 | per 100 sessions |
| Connector app tasks | Freshdesk, Omni | any | $80 | per 5,000 tasks |
| Day pass — Freshdesk | Freshdesk | Growth / Pro / Ent | $2 / $7 / $12 | per pass |
| Day pass — Omni | Omni | Growth / Pro / Ent | $5 / $10 / $15 | per pass |
| Asset Units (ITAM) | Freshservice | any | packs of 500 | see internal book |

**Included allowances:** 500 Freddy AI Agent sessions on every paid Freshdesk and Omni plan, once
per account. 5,000 collaborators on Freshdesk Pro/Enterprise and Omni Pro/Enterprise.

---

## 3. Five things this data changes in task 2.5

**Tier names collide across products.** "Growth" is $19 in Freshdesk, $29 in Omni, $49 in
Freshservice, $9 in Freshsales. A tier name alone is meaningless. The price book key must be
`(product, tier, currency, term)` — never tier alone. An extraction that returns `tier: "Growth"`
without a confident product is unresolvable, not a lookup with a default.

**Freshservice Enterprise has no list price.** It is quote-only. The lookup must fail loudly and
the ARR estimate must return null with reason `no_list_price`, never fall back to Pro. This is
exactly the case spec §7.3 was protecting against.

**Freshsales is priced per USER, not per agent.** Different unit, different extraction question.
"How many agents" is the wrong question for a CRM deal. The extraction prompt needs a
product-conditional phrasing.

**The Omni fork is now exact.** Growth +$10, Pro +$24, Enterprise +$30 — matching spec §7.5's
"$10–30/agent/month fork" precisely. Worth quoting the real deltas in the extraction prompt:
misreading Omni as Freshdesk on a 40-agent Enterprise deal is a $14,400/year error.

**Copilot has a tier constraint.** Only available on Pro and Enterprise. If extraction returns
Copilot seats on a Growth deal, that is a contradiction to surface, not a line item to price.

---

## 4. Seed JSON

```json
{
  "price_book": [
    { "product": "freshdesk",  "tier": "growth",     "currency": "USD", "term": "annual", "unit": "agent_month", "price": 19,  "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshdesk/pricing" },
    { "product": "freshdesk",  "tier": "pro",        "currency": "USD", "term": "annual", "unit": "agent_month", "price": 55,  "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshdesk/pricing" },
    { "product": "freshdesk",  "tier": "enterprise", "currency": "USD", "term": "annual", "unit": "agent_month", "price": 89,  "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshdesk/pricing" },

    { "product": "freshdesk_omni", "tier": "growth",     "currency": "USD", "term": "annual", "unit": "agent_month", "price": 29,  "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshdesk/omni/pricing" },
    { "product": "freshdesk_omni", "tier": "pro",        "currency": "USD", "term": "annual", "unit": "agent_month", "price": 79,  "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshdesk/omni/pricing" },
    { "product": "freshdesk_omni", "tier": "enterprise", "currency": "USD", "term": "annual", "unit": "agent_month", "price": 119, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshdesk/omni/pricing" },

    { "product": "freshservice", "tier": "starter", "currency": "USD", "term": "annual", "unit": "agent_month", "price": 19, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshservice/pricing" },
    { "product": "freshservice", "tier": "growth",  "currency": "USD", "term": "annual", "unit": "agent_month", "price": 49, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshservice/pricing" },
    { "product": "freshservice", "tier": "pro",     "currency": "USD", "term": "annual", "unit": "agent_month", "price": 99, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshservice/pricing" },
    { "product": "freshservice", "tier": "enterprise", "currency": "USD", "term": "annual", "unit": "agent_month", "price": null, "quoteOnly": true, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/freshservice/pricing" },

    { "product": "freshsales", "tier": "growth",     "currency": "USD", "term": "annual", "unit": "user_month", "price": 9,  "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/crm/pricing" },
    { "product": "freshsales", "tier": "pro",        "currency": "USD", "term": "annual", "unit": "user_month", "price": 39, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/crm/pricing" },
    { "product": "freshsales", "tier": "enterprise", "currency": "USD", "term": "annual", "unit": "user_month", "price": 59, "effectiveFrom": "2026-07-24", "effectiveTo": null, "source": "freshworks.com/crm/pricing" }
  ],

  "addon_price_book": [
    { "addon": "freddy_ai_copilot", "appliesTo": ["freshdesk","freshdesk_omni","freshservice","freshsales"], "requiresTier": ["pro","enterprise"], "unit": "agent_month", "price": 29, "includedUnits": 0, "includedScope": null, "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "freddy_ai_agent_sessions", "appliesTo": ["freshdesk","freshdesk_omni"], "requiresTier": [], "unit": "per_100_sessions", "price": 49, "includedUnits": 500, "includedScope": "once_per_account", "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "connector_app_tasks", "appliesTo": ["freshdesk","freshdesk_omni"], "requiresTier": [], "unit": "per_5000_tasks", "price": 80, "includedUnits": 0, "includedScope": null, "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },

    { "addon": "day_pass", "appliesTo": ["freshdesk"], "requiresTier": ["growth"],     "unit": "per_pass", "price": 2,  "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "day_pass", "appliesTo": ["freshdesk"], "requiresTier": ["pro"],        "unit": "per_pass", "price": 7,  "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "day_pass", "appliesTo": ["freshdesk"], "requiresTier": ["enterprise"], "unit": "per_pass", "price": 12, "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "day_pass", "appliesTo": ["freshdesk_omni"], "requiresTier": ["growth"],     "unit": "per_pass", "price": 5,  "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "day_pass", "appliesTo": ["freshdesk_omni"], "requiresTier": ["pro"],        "unit": "per_pass", "price": 10, "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },
    { "addon": "day_pass", "appliesTo": ["freshdesk_omni"], "requiresTier": ["enterprise"], "unit": "per_pass", "price": 15, "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null },

    { "addon": "asset_units", "appliesTo": ["freshservice"], "requiresTier": [], "unit": "per_500_units", "price": null, "quoteOnly": true, "note": "ITAM licensing metric, packs of 500 — price not published", "currency": "USD", "term": "annual", "effectiveFrom": "2026-07-24", "effectiveTo": null }
  ],

  "version": "2026-07-24-usd-list"
}
```

---

## 5. Unit test — validates against the spec

Spec §7.2's Pioneer Metering example expects a $9,744 point estimate.

```
28 agents × $29 (freshdesk_omni / growth / USD / annual) × 12 = $9,744
```

Exact against this seed. The worked example was built on current Omni Growth list price, so if
`compute.ts` and this price book are both correct, the test passes without adjustment. If it
doesn't, one of the two is wrong — which is precisely why the test exists.

---

## 6. What is still missing

| Gap | Why it matters | Where to get it |
|---|---|---|
| **Regional rows (INR, EUR, GBP, AUD, SGD)** | Spec §7.5 forbids FX-converting a USD list price. Every non-US deal is currently unpriceable | Internal price book |
| **Monthly-term rows** | Pages advertise ~20% saving for annual, so monthly ≈ list ÷ 0.8. Do not compute it — pull the real rows | Internal price book |
| **Freshservice Enterprise** | Quote-only. No list price exists | Deal desk, per-deal |
| **Freshservice Asset Units** | Sold in packs of 500, price not published | Internal price book |
| **Freshsales Suite, Freshmarketer, Freshchat, Freshcaller** | Separate SKUs with their own pricing pages | Their own pricing pages |
| **Partner and negotiated rates** | List is not what enterprise deals close at | Internal price book |

**Load this as `2026-07-24-usd-list` and treat it as a starting version, not the truth.** Public
list pricing is what a customer sees on the website; the internal book is what deals are actually
written against. When the internal rows arrive, close these with `effectiveTo` and insert new ones
— never overwrite, per spec §7.3.

The India point matters immediately, given the ad link that started this. An Indian deal priced off
a USD list row will be wrong, and the spec already told you not to FX-convert it. Until INR rows
exist, region `IN` should return null with reason `no_regional_price`, not a converted number.
