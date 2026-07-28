# Account record v3 — CRM-inspired IA comparison

Companion to [ADR 004](../adr/004-account-record-crm-ia.md). Compares three shells for `#accounts/{accountId}` (and deal hash variants). **Recommended:** Option B.

**Baseline implemented today:** v4 **1b Compact command** shell ([account-record-v4-1b-compact-command.md](./account-record-v4-1b-compact-command.md)) — command chrome + three-column deck + compact list; behaviors from Option B below.

**Prior baseline:** v2 pursuit bar + v2.1 body grid + summary strip ([account-record-v2.1-left-column.md](./account-record-v2.1-left-column.md)).

**CRM reference (Freshworks-style):** Record header; left **Overview** nav (Account details, Activities, Contacts, Bookings, …); main canvas switches by nav item; often **duplicate** summary tiles and a detail field grid.

---

## Shared elements (all options)

| Element | Purpose |
|---------|---------|
| Record header | Back, account name, primary actions (**New prep**, **Post-call**) |
| Engagement context | Writes `setAccountEngagementContext({ accountId, dealId, prepType, lifecycleId })` on prep/post-call |
| Entity mapping | **Account** = record root; **Deal** = pursuit; **Contact** = related people; **Lifecycle** = SE lens on selected deal |

**Legibility rule (all options):** One canonical surface per fact — no CRM-style “tile row + identical field grid” for the same attributes.

---

## Option A — Freshworks-like left rail

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ← All accounts   Acme Corp   [domain] [NB]              [New prep][Post] │
├──────────────┬─────────────────────────────────────────────────────────────┤
│ OVERVIEW     │  (Main canvas — changes with rail selection)                 │
│ ● Details    │                                                             │
│   Activities │  Example: "Contacts" selected → full contacts table +      │
│   Contacts   │  filters; pursuit pipeline may be hidden or duplicated       │
│   Deals      │                                                             │
│   Team       │  Example: "Activities" → timeline (overlaps artifact tabs)   │
│   Bookings*  │                                                             │
│              │  *Bookings = placeholder for future modules                  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

| Nav item | Lionpath content |
|----------|------------------|
| Account details | Firmographics, MEDDPICC, tags — **risk: duplicates header/summary** |
| Activities | Account/deal timeline — **overlaps** Activity tab |
| Contacts | Full contact list + add contact |
| Deals | All deals (active/archived) + create deal |
| Team | Deal team (`seTeam`) |

**Pros:** Familiar; room for many modules; clean deep links (`…/contacts`).  
**Cons:** Competes with horizontal space; **Deal** context split between rail “Deals” and (if kept) pursuit bar; SE daily path adds clicks; Contacts hidden when user is on “Activities.”

**When to choose:** Full-page app width, 6+ modules, browse-first personas (ops/admin), not primary SE prep surface.

---

## Option B — Hybrid (recommended) — v2.1 + summary strip + optional Deals panel

Evolution of current layout; adds **summary strip** and explicit **Deals** surface without a second nav tree.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ A. HEADER (unchanged v2)                                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ B. SUMMARY STRIP (new) — one row, scannable                                   │
│  acme.com · NB · Discovery · Primary: Jane Doe · ICP: Product X            │
├────────────────────────────────────────────────────────────────────────────┤
│ C. PURSUIT BAR (sticky, unchanged v2) — Deal + Lifecycle lens               │
│  [ New business | Expansion ]  [Switch deal ▼]  [Lens ▼]  [Engagement ▼]   │
│  ── Research — Discovery — Demo — Eval — BC — Won/Lost/Nurture ──          │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ D1. Reference (left ~50%)   │ D2. Artifacts (right ~50%)                   │
│  Deal team (flat)            │  Filter…                                     │
│  ▶ MEDDPICC (collapsed)      │  Activity | Preps | Post-calls | Tasks       │
│  ▶ Deals (collapsed)*        │                                              │
│    *list when 2+ or archived │                                              │
├──────────────────────────────┴─────────────────────────────────────────────┤
│ E. CONTACTS BAND (full width, v2.1 compact columns, scroll max-height)      │
│  Name / Title / DISC / Influence / Primary / Activity expand                │
│  Row click → Contact record (or slide-over phase 2)                         │
└────────────────────────────────────────────────────────────────────────────┘
```

**Alternative for Deals (same option):** Move **Deals** to a fifth main tab `Activity | … | Deals` when list is long; keep pursuit bar as sole **active deal** control. Pick one pattern in implementation — not both rail and tab.

| Area | Entity |
|------|--------|
| Summary strip | Account + selected **Deal** stage/type + primary **Contact** |
| Pursuit bar | **Deal** motion, switch, pipeline; **Lifecycle** lens |
| Left reference | Account **Team**, account/deal **MEDDPICC** (scope TBD) |
| Right tabs | **Engagement** artifacts (lifecycle events) |
| Contacts band | **Contact** related list |

**Pros:** Pursuit-first; contacts stay on overview; scalable Deals history; minimal new chrome.  
**Cons:** Not full CRM parity; “where are all deals?” requires Deals collapsible/tab discipline.

---

## Option C — Account hub (related lists only)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Header + actions only (no pursuit bar or summary)                           │
├────────────────────────────────────────────────────────────────────────────┤
│ Related list: Deal team                                                     │
│ Related list: Contacts                                                      │
│ Related list: Deals (all)                                                   │
│ Related list: Activity (flat chronological)                               │
│ Related list: Preps / Post-calls / Tasks                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Pros:** Simplest IA; no tab/rail duplication.  
**Cons:** Hides pipeline and deal switcher; poor fit for prep workflow; conflicts with ADR 003 UX home.

---

## Side-by-side

| Criterion | A — Left rail | B — Hybrid ✓ | C — Hub |
|-----------|---------------|--------------|---------|
| SE prep → call path | Extra nav clicks | Shortest | Long scroll |
| Deal context | Split rail / bar | Pursuit bar | Weak |
| Contacts on overview | Only when nav selected | Always (band E) | List section |
| Horizontal space | Worst | Best | Good |
| Add 5th module | Easy | Tab / “More” | List |
| CRM duplicate fields | High risk | Low (summary strip) | Medium |

---

## Contact profile drill-down (Option B)

Not a side-panel nav item — a **route** from contacts band:

```text
#contacts/{contactId}   (or #accounts/{accountId}/contacts/{contactId})

┌────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Acme Corp                                                         │
│ Contact name · title · email                                                │
├────────────────────────────────────────────────────────────────────────────┤
│ Influence, DISC, primary flag (editable policy TBD)                         │
│ Contact event timeline (ContactEvent stream)                                │
│ Link to account · deals they touch (read-only chips)                        │
└────────────────────────────────────────────────────────────────────────────┘
```

Keeps account overview focused on pursuit; deep work on a person gets full width.

---

## Deals list rules (Option B)

| Condition | UI |
|-----------|-----|
| 0 deals | Pursuit bar uses lifecycle lens only; Deals section hidden |
| 1 active deal | No “Switch deal”; optional collapsed Deals showing history empty |
| 2+ active deals | Switch deal in pursuit bar + Deals list mirrors selection |
| Archived NB after handoff | Deals list shows archived row; selecting sets read-only or “view history” mode |

Row action: set `selectedDealId`, update hash `#accounts/{id}/deals/{dealId}`, refresh pursuit bar and scoped tabs.

---

## Manual QA checklist (when B is implemented)

- [x] Summary strip shows no field that also appears verbatim in expanded MEDDPICC header (domain/type/stage/primary/ICP in strip; header name-only)
- [x] Stage on summary strip + pipeline stepper (short label in strip; stepper remains canonical for advancement)
- [x] Contacts band full width; row navigates to contact route
- [x] Deals panel/tab visible per rules above; switch deal syncs pursuit bar
- [ ] Mobile: bands stack summary → pursuit → tabs → contacts
- [ ] Search filter still applies to contacts + tab content

**Implemented:** 2026-07-22 in `web/account-view.js`, `web/app.js` (hash `#accounts/{id}/contacts/{contactId}`), `web/lifecycle.css`.

---

## Related

- [ADR 004 — Account record CRM IA](../adr/004-account-record-crm-ia.md)
- [account-record-v2.md](./account-record-v2.md)
- [account-record-v2.1-left-column.md](./account-record-v2.1-left-column.md)
