# ADR 004 — Account record information architecture (CRM-inspired)

| Field | Value |
|-------|--------|
| **Status** | Accepted (Opportunity route split implemented 2026-07-23) |
| **Date** | 2026-07-22 |
| **Deciders** | Product, UX, Engineering |
| **Supersedes** | None (extends [ADR 003](./003-account-deal-engagement.md)) |
| **Related** | [account-record-v2.md](../wireframes/account-record-v2.md), [account-record-v2.1-left-column.md](../wireframes/account-record-v2.1-left-column.md), [account-record-v3-crm-inspired.md](../wireframes/account-record-v3-crm-inspired.md) |

---

## Context

Lionpath (Singapaathai) is an **SE prep portal**, not a full CRM. Per [ADR 003](./003-account-deal-engagement.md), the domain model is:

| Entity | Role on account record |
|--------|-------------------------|
| **Account** | Navigation backbone — identity, contacts, deal team, account-level firmographics / MEDDPICC (scope TBD), merged timeline |
| **Deal** | First-class pursuit — motion (`new_business` \| `expansion`), stage, status, scoped artifacts |
| **Contact** | People at account; own event stream; primary contact for lifecycle |
| **Lifecycle / engagement** | Aggregate spine for one SE lens on a deal — pipeline stage, prep/post-call/tasks, timeline |

Freshworks-style CRM screenshots show a **record shell**: header + **left “Overview” rail** (Account details, Activities, Contacts, Bookings, …) + main canvas. That pattern optimizes **many modules**, **admin breadth**, and **deep links** into sub-records on wide layouts.

Current implementation ([`web/account-view.js`](../../web/account-view.js)) already follows a **pursuit-first hybrid** aligned with wireframes v2 / v2.1:

- **Band A:** Record header (back, name, tags, New prep / Post-call)
- **Band B:** Sticky **pursuit bar** (motion, switch deal, lifecycle lens, engagement menu, pipeline stepper)
- **Band C:** Body — left reference column (deal team, collapsible MEDDPICC), right **artifact tabs** (Activity, Preps, Post-calls, Tasks), **full-width contacts band**

Usability review (v2.1) confirmed the main failure mode was **cramming a wide contacts table into a narrow left column**, not missing CRM-style object nav. v2.1 addressed density; users still want **legible, scalable** account UI as Deals lists and Contact drill-down grow.

**Forces**

1. **CRM familiarity** — SEs and managers think Account → Contact → Opportunity.
2. **Workflow linearity** — Daily job is **prep → call → tasks**, scoped to **one active deal** at a time, not hopping ten modules.
3. **Viewport** — Sidebar + ticket/product chrome leaves **limited horizontal space**; a second left rail competes with pursuit bar and artifact tabs.
4. **Scalability** — Multiple active deals, contact profiles, and future modules (e.g. firmographics editor) must not reintroduce cramming or duplicate field display (CRM “tiles + detail grid” anti-pattern).
5. **Routing** — `#accounts/{id}`, `#accounts/{id}/deals/{dealId}`, future `#contacts/{id}`; engagement context already flows from account detail ([ADR 003](./003-account-deal-engagement.md)).

**Question:** Should **Deals** and **Contacts** live in a **side-panel nav** like Freshworks, or stay embedded / routed differently?

---

## Decision (recommendation)

**Adopt Option B: Hybrid record shell — pursuit bar + summary strip + main-area tabs and related lists (evolve v2.1), not a CRM clone left rail.**

- Keep **Deal** context in the **sticky pursuit bar** (motion, switch deal, pipeline, lifecycle lens) — not a duplicate “Deals” item beside “Activities.”
- Keep **Contacts** as a **full-width related list** on the account overview with **row drill-down** to a dedicated Contact record route; do not mirror Contacts as both left-rail nav and bottom band.
- Use **main-column tabs** only for **time-ordered / artifact streams** (Activity, Preps, Post-calls, Tasks). Add **Deals** as a **related list panel or tab** when more than one deal or archived history matters — not as primary daily nav.
- Add a **compact account summary strip** (one row: domain, ICP, primary contact, stage, deal type) under the header for **legibility at a glance**; avoid repeating the same fields in tiles and a second detail grid.

Option A (full CRM left rail) is reserved for a future **“Account workspace”** mode if the product grows many modules (bookings, assets, integrations). Option C (hub-only lists, no pursuit chrome) is rejected for daily SE use because it hides deal context.

---

## Options considered

### Option A: Freshworks-like left rail (Overview → Details, Activities, Contacts, Deals, Team)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium–High — new shell, route↔nav sync, mobile collapse |
| Cost | Higher layout/CSS and a11y surface; two navigation systems unless pursuit bar is removed |
| Scalability | Good for **many** sub-modules (10+) |
| Team familiarity | High for CRM users |
| Fit for SE prep portal | **Low** — narrow viewport, ~3 object types, linear pursuit workflow |

**Pros**

- Familiar CRM mental model; easy deep links (`…/contacts`, `…/deals`).
- Room to add modules without crowding the main canvas.
- Clear separation when Contacts or Deals need full-page sub-views.

**Cons**

- **Duplicate navigation** with existing pursuit bar (Deal = motion + switcher + pipeline) and right-side artifact tabs (Activities overlap).
- **Horizontal tax** — left rail (~200px) + content + app chrome ≈ cramped artifact and contacts tables on laptop widths.
- **Wrong default path** — SEs need pipeline + prep actions above the fold, not “pick a module” first.
- Risk of **field redundancy** if “Account details” rail section repeats header tags and firmographics tiles like enterprise CRM overview pages.

---

### Option B: Hybrid — summary strip + pursuit bar + main tabs + related lists (v2.1 evolution)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low–Medium — incremental on current `account-view.js` |
| Cost | Lowest migration; wireframes v2/v2.1 already accepted direction |
| Scalability | Good for 3–8 sections via tabs + one related-list row per entity type |
| Team familiarity | Partial CRM (account header + related people) without full shell |
| Fit for SE prep portal | **High** |

**Pros**

- **Single deal context** — pursuit bar is the source of truth; no “Deals” nav fighting “Switch deal.”
- **Legibility** — summary strip + collapsed MEDDPICC + full-width contacts (v2.1) prioritizes scanning.
- **Artifact tabs** stay the daily driver on the right (or full-width on mobile stack).
- **Contact drill-down** via row click → `#contacts/{id}` (or slide-over) without permanent rail.

**Cons**

- Less obvious where to put ** fifth+ modules** (may need sub-routes or overflow menu later).
- **Deals history** (archived NB after handoff) needs an explicit **Deals** tab or list — not automatic from CRM muscle memory.
- Managers browsing “everything on account” may expect CRM-style module list.

---

### Option C: Account hub — related lists only (no pursuit subheader, no artifact tabs)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low initially |
| Cost | Low build, **high** product cost — hides pipeline and prep entry |
| Scalability | Lists scale; **workflow** does not |
| Fit for SE prep portal | **Low** for primary account detail |

**Pros**

- Simple IA: one scrollable hub (Team, Contacts, Deals, Activity list).
- No tab/rail duplication.

**Cons**

- Conflicts with [ADR 003](./003-account-deal-engagement.md) UX home (“account detail; deal switcher; pipeline per deal”).
- Buries **New prep / Post-call** and stage advancement behind lists.
- Becomes a **read-only CRM lite** unless pursuit chrome is re-added elsewhere.

---

## Trade-off analysis

| Topic | Option A (CRM rail) | Option B (Hybrid) | Option C (Hub) |
|-------|---------------------|-------------------|----------------|
| Deal context | Rail “Deals” + maybe pursuit bar (**duplicate**) | Pursuit bar only (**clear**) | List row only (**weak**) |
| Contact access | Rail + list (**duplicate**) | Full-width list + profile route (**clear**) | List only |
| Daily workflow | Extra click to Activities | Activity tab default (**best**) |
| Narrow viewport | Rail collapses; still heavy | Stack: pursuit → summary → tabs → contacts (**best**) |
| Add archived deals UI | New rail item | “Deals” tab or related list | Related list |
| CRM parity | Highest | Targeted (people + opportunity context) | Low |
| Legibility risk | Tiles + grid duplication | Summary strip once; collapsible qualification | List-heavy scroll |

**When side-panel nav for related objects is good**

- Many **independent modules** (support, bookings, assets, billing) with equal priority.
- **Wide** main canvas (full-page app location) and users who **browse** more than **execute one workflow**.
- **Deep linking** is the primary entry (email links to “Contacts tab”).

**When it is bad for Lionpath**

- Only **three** first-class objects and **one linear** pursuit loop (research → … → outcome).
- **Deal** is already selected in pursuit bar; **Activities** are deal-scoped artifact tabs.
- **Contacts** must stay visible on overview (user constraint in v2.1) — a rail item that navigates away **hurts** prep unless split view exists.

**Entity mapping (recommended UI)**

| Entity | Primary UI anchor | Secondary |
|--------|-------------------|-----------|
| Account | Header + summary strip | Firmographics / MEDDPICC in collapsible section (scope per ADR 003 open question) |
| Deal | Pursuit bar (motion, switch, pipeline, handoff) | Related **Deals** list/tab for inactive/archived |
| Contact | Full-width related list on overview | Contact record page; optional slide-over preview |
| Lifecycle lens | Pursuit bar “Lens” when multi-SE | Stage drives pipeline stepper only (no duplicate stage badge) |

**Legibility principles (explicit)**

1. **One canonical place per fact** — e.g. stage only on stepper; deal type on pursuit motion or summary strip, not also a giant tile.
2. **Summary strip** — max ~5 chips/labels; link “Edit details” for rare firmographic edits.
3. **Related lists** — compact columns (v2.1 abbreviations); avoid long `fw-tag` strings in cells.
4. **Progressive disclosure** — MEDDPICC collapsed by default; contact activity expand per row.

---

## Consequences

### Positive

- Preserves investment in v2/v2.1 layout and [`account-view.js`](../../web/account-view.js) structure.
- Scales to **Deals list** and **Contact profile** without second nav tree.
- Reduces CRM **duplicate field** UX that users flagged as noisy and illegible.
- Aligns with ADR 003: account backbone, deal switcher, lifecycle lens on pursuit chrome.

### Negative / cost

- Does not satisfy users who expect **pixel-parity** Freshworks record chrome; need onboarding copy (“Pursuit bar = your opportunity”).
- **Deals** and **Contact profile** routes must be designed deliberately (not implied by rail).
- If product later adds 6+ account modules, may need **Option A subset** (overflow “More” or workspace mode) — revisit this ADR.

### Revisit when

- Account detail moves to **full-page app** with ≥1200px dedicated width.
- Parallel **expansion deals** or CRM sync makes **Deals** module equal priority to Activity.
- User research shows **lost wayfinding** without module rail (metric: time-to-prep from account open).

---

## Action items

1. [ ] **Product + UX:** Approve Option B; reject duplicate left rail for MVP of Deals list + Contact drill-down.
2. [ ] **Wireframe:** Finalize [account-record-v3-crm-inspired.md](../wireframes/account-record-v3-crm-inspired.md) — summary strip fields, Deals related list/tab rules, Contact row → route behavior.
3. [ ] **Implement summary strip** under `account-record-header` (domain, deal type, stage, primary contact, ICP) — single row, no duplicate tile grid.
4. [ ] **Implement Deals related list or tab** — show active + archived deals; row opens deal context (updates pursuit bar + hash `#accounts/{id}/deals/{dealId}`); hide tab when only one active deal if product prefers minimal chrome.
5. [ ] **Contact drill-down route** — `#contacts/{contactId}` (or nested under account) with back to account; keep full-width list on account overview; optional slide-over for quick view in a later sprint.
6. [ ] **MEDDPICC scope decision** (carry from ADR 003) — document in ENTITY_CATALOG before showing deal-specific MEDDPICC in UI.
7. [ ] **CSS / responsive:** Document stack order mobile: header → summary → pursuit → tabs → contacts; cap pursuit bar height per v2.1 nice-to-have.
8. [ ] **Tests:** Extend `web/scripts/test-account-view.mjs` for summary strip, Deals panel visibility rules, and contact link targets.

---

## Related

- [ADR 003 — Account, Deal, engagement](./003-account-deal-engagement.md)
- [ENTITY_CATALOG.md](../ENTITY_CATALOG.md)
- Implementation: [`web/account-view.js`](../../web/account-view.js), [`web/lifecycle.css`](../../web/lifecycle.css)
