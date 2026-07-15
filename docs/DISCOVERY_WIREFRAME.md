# Discovery Pre-Call Wireframe (v6)

Share this with the team before changing the Discovery one-pager. Matches the **Account Snapshot** layout in `web/app.js` (`renderPrep`) and `worker/src/schema.ts`.

**Rules:** ONE table · read top → bottom · ≤8 words per cell · no invented stats · one printed page.

---

## Page layout

```
Toolbar (Print/PDF · Copy JSON)
    ↓
Header strip (company · domain · description · attendees)
    ↓
ONE Account Snapshot table
    ↓
Sources collapsible (footer only)
```

---

## Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DISCOVERY ONE-PAGER (PRE-CALL) — WIREFRAME v6                              │
│  Rule: ONE table. Read top → bottom. ≤8 words/cell. No invented stats.      │
└─────────────────────────────────────────────────────────────────────────────┘

[ Print / PDF ]  [ Copy JSON ]

┌─ HEADER STRIP (above table, not inside it) ─────────────────────────────────┐
│  Khan Academy                                    khanacademy.org             │
│  Non-profit ed org offering free online learning globally                    │
│  ● Jane Doe · VP Ops    ○ Sam Lee · IT lead    ● unknown attendee            │
│     (green=decision maker  grey=influencer  red=unknown)                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ ACCOUNT SNAPSHOT — SINGLE TABLE ───────────────────────────────────────────┐
│                                                                              │
│  ══════════════════ FIT ══════════════════                                   │
│  ┌──────────────────┬──────────────┬──────────────┬─────────────────────┐ │
│  │ Attribute        │ This company │ Industry norm│ GAP                 │ │
│  ├──────────────────┼──────────────┼──────────────┼─────────────────────┤ │
│  │ Omnichannel      │ Email only   │ Multi-channel│ Behind ●            │ │
│  │ Support          │              │ inbox        │ (red dot)           │ │
│  ├──────────────────┼──────────────┼──────────────┼─────────────────────┤ │
│  │ AI Deflection    │ None         │ Chatbot tier │ Large ●             │ │
│  ├──────────────────┼──────────────┼──────────────┼─────────────────────┤ │
│  │ Agent Assist     │ Manual macros│ Copilot tools│ Partial ●           │ │
│  └──────────────────┴──────────────┴──────────────┴─────────────────────┘ │
│  (warm accent on first "large gap" row — focal opportunity)                  │
│                                                                              │
│  ══════════════ ACCOUNT FACTS ══════════════                               │
│  ┌──────────────────┬────────────────────────────────────────────────────┐ │
│  │ Incumbent        │ Zendesk [entrenched]  (tag colour-coded)         │ │
│  │ Support agents   │ 40–60 est.                                         │ │
│  │ Market           │ Global K-12 ed tech                                  │ │
│  │ Business model   │ Non-profit donations                               │ │
│  │ Users            │ Teachers learners parents                          │ │
│  │ Uptime need      │ High during school year                           │ │
│  │ Funding / parent │ Non-profit standalone                              │ │
│  │ Head office      │ Mountain View CA                                   │ │
│  │ Languages        │ EN ES more                                         │ │
│  └──────────────────┴────────────────────────────────────────────────────┘ │
│                                                                              │
│  ════════════ INDUSTRY USE CASES (max 3) ════════════                      │
│  │ Scale learner support without hiring                                     │
│  │ Deflect repetitive how-to tickets                                        │
│  │ Enterprise district omnichannel rollout                                  │
│                                                                              │
│  ══════════════ DISCOVERY KIT (max 3) ══════════════                       │
│  ┌────────────────────────────┬──────────────────────────────────────────┐ │
│  │ Ask this                   │ Because                                  │ │
│  ├────────────────────────────┼──────────────────────────────────────────┤ │
│  │ How do you route tickets?  │ Uncovers channel fragmentation           │ │
│  │ What is ticket volume?     │ Sizes deal and staffing pain               │ │
│  │ Who owns support tooling?  │ Finds decision maker and blockers          │ │
│  └────────────────────────────┴──────────────────────────────────────────┘ │
│                                                                              │
│  ════════════════ DEMO PREP (max 3) ════════════════                       │
│  ┌──────────────────┬──────────────────┬────────────────────────────────┐ │
│  │ Pain             │ Capability       │ Value (qualitative only)       │ │
│  ├──────────────────┼──────────────────┼────────────────────────────────┤ │
│  │ Repetitive FAQs  │ Freddy AI Agent  │ Cuts manual repeat answers     │ │
│  │ Slow peak times  │ Omnichannel inbox│ One queue faster resolution    │ │
│  │ Agent inconsistency│ Freddy Copilot │ Faster consistent replies      │ │
│  └──────────────────┴──────────────────┴────────────────────────────────┘ │
│                                                                              │
│  ══════════════════ RESOURCES ══════════════════                             │
│  │ [Demo script ↗] [Customer reference ↗] [Slide pack ↗]                    │
│  │ [Zendesk vs Freshdesk ↗]  ← only if Zendesk detected                    │
│  │ [Intercom vs Freshdesk ↗] ← only if Intercom detected                   │
│  │ [ROI slide pack ↗]        ← optional, mid-market+ signals               │
│  └──────────────────────────────────────────────────────────────────────────│
└──────────────────────────────────────────────────────────────────────────────┘

▸ Sources (4)   ← collapsible footer ONLY (not in main table)
```

---

## Column reuse (one table)

| Section | Col 1 | Col 2 | Col 3 | Col 4 |
|---------|-------|-------|-------|-------|
| **FIT** | Attribute | This company | Industry norm | GAP + dot |
| **Account facts** | Label | Value (colspan 3) | — | — |
| **Use cases** | Full width (colspan 4) | | | |
| **Discovery kit** | Ask this | Because (colspan 3) | | |
| **Demo prep** | Pain | Capability | Value (colspan 2) | |
| **Resources** | Link chips (colspan 4) | | | |

Section labels (`FIT`, `Account facts`, etc.) are full-width grey band rows inside the same table.

---

## JSON → UI mapping

| UI row | JSON field |
|--------|------------|
| Header description | `description` |
| Attendee chips | `attendees[]` |
| FIT rows | `fitSnapshot[]` (3 rows: Omnichannel, AI Deflection, Agent Assist) |
| Incumbent + tag | `incumbent.incumbent_name`, `displacement` |
| Support agents | `companySizeAgents.agents`, `estimated` |
| Market … Languages | `businessContext.*` |
| Use cases | `industryUseCases[]` |
| Discovery kit | `discoveryKit[]` |
| Demo prep | `painCapabilityValue[]` |
| Resource chips | `pickDemoLinks()` in `web/demo-links.js` |
| Sources footer | `sources[]` |

---

## Removed (confirm with team)

- Support Maturity chip block
- Signals block (job listings / Similarweb)
- Separate cards and second collapsible “More context” stack

---

## Team feedback (reply in Slack)

1. **Approve as-is** / change section order / add-remove rows?
2. **Sources** — OK in footer, or move into table?
3. **Resources** — too many link chips?
4. **Account facts** — all 8 rows required?
5. **FIT rows** — locked to 3 attributes, or dynamic top gaps?

---

## Slack share

Copy-paste message: see [`docs/SLACK_DISCOVERY_WIREFRAME.txt`](SLACK_DISCOVERY_WIREFRAME.txt).

Live preview: generate a prep in **One-pagers → Discovery** after deploy.
