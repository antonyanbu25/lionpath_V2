# Account record v2.1 — left column usability

Follow-on to [account-record-v2.md](./account-record-v2.md). Same routing and `data-action` hooks; layout and density only.

**Implementation:** [`web/account-view.js`](../../web/account-view.js), [`web/lifecycle.css`](../../web/lifecycle.css)

**ADR 004 Option B (2026-07-22):** Summary strip under header (domain · deal type · stage · primary contact · ICP); pursuit bar unchanged; left-column **Deals** collapsible when 2+ active or any archived; contact name → `#accounts/{id}/contacts/{contactId}` detail panel on same page. MEDDPICC remains account-level collapsible section.

---

## UX review — pain points

| Area | Issue | Impact |
|------|--------|--------|
| Left column stack | Deal team + full MEDDPICC grid + 7-column contacts table in ~5/12 body width | Vertical and horizontal cramming; scanning contacts requires horizontal scroll inside a narrow column |
| Contacts table | Name, title, email, DISC tag, influence tag, primary tag, activity in one row | `fw-tag` text (“High influence”, “DISC D”) wraps vertically in narrow cells |
| MEDDPICC | Eight fields × label + value + status tag in 2-column grid inside `fw-card` | Dominates left column before user reaches contacts; status tags add more Crayons chrome |
| Deal team | `fw-card` + avatar row + trailing tags/actions | Acceptable alone but compounds card stacking |
| Pursuit bar | Sticky band with motion, optional selects, engagement menu, full pipeline | Busy but intentional; main pain is **body** width allocation, not band B |
| Search filter | Applies to both columns | Contacts hidden by filter still compete for width when visible |

User constraint retained: **contacts stay on the record** (not moved to a separate route), but the left ~5fr column is not viable for a multi-contact table.

---

## UI review

| Topic | Finding |
|-------|---------|
| Visual hierarchy | Right column (activity) is the daily driver; left should be reference (team, qualification, people) — current stack gives MEDDPICC equal weight to contacts |
| Spacing | Repeated `fw-card` + 14px section gaps feel dense; flat sections read cleaner |
| `fw-tag` in tables | Tags need min-width; in `<td>` they break into stacked lines — use abbreviations + `title` tooltips instead |
| Grid 5/7 vs alternatives | 5/7 works for **team + short lists**; **fails** for wide tables. Full-width contacts band or 50/50 top + spanning row fixes table width without dropping contacts from the page |

---

## Complexity tiers

### Must-fix (MVP usability)

- Full-width **contacts band** below a two-column top row (team/MEDDPICC left, tabs right)
- **Collapsible MEDDPICC** (`<details>`, default closed) with summary showing title + completion %
- **Compact contact cells**: DISC letter, influence H/M/L, primary marker — not long `fw-tag` strings in table cells
- **max-height + scroll** on contacts table wrapper
- **Flatten** deal team (section, not nested card stack)

### Nice-to-have

- Hide email column; show under name (implemented in MVP for width)
- MEDDPICC status as single-letter badges when expanded
- 50/50 top columns on desktop (implemented)
- Pursuit bar height cap / pipeline row-only scroll on very narrow viewports

### Files touched (estimate)

| File | Change |
|------|--------|
| `web/account-view.js` | Layout HTML, MEDDPICC `<details>`, contact abbrev renderers, flat deal team |
| `web/lifecycle.css` | Body grid rows, contacts band scroll, abbrev styles, MEDDPICC summary |
| `web/scripts/test-account-view.mjs` | Assert new layout classes; DISC via title/abbrev |
| `docs/wireframes/account-record-v2.1-left-column.md` | This doc |
| `README.md` | Link to v2.1 |

---

## Conclusion — chosen layout

**Approach:** Two-row body grid — **row 1:** 50/50 **Deal team + collapsible MEDDPICC** (left) and **activity/artifacts** (right); **row 2:** **full-width contacts band** with compact columns and `max-height` scroll.

**Justification:**

1. Keeps contacts on the account record (user preference) while giving the table **~100% content width** instead of 5fr.
2. MEDDPICC remains one click away but **defaults collapsed** so deal team and contacts win above-the-fold space.
3. Abbreviations preserve Crayons elsewhere (header, deal team roles) but avoid broken tags in table cells.
4. Minimal domain/routing risk — markup/CSS only; all test hooks preserved.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Header + pursuit bar (unchanged v2)                                      │
├─────────────────────────────┬───────────────────────────────────────────┤
│ Deal team (flat section)    │ Filter + Activity | Preps | …             │
│ ▶ MEDDPICC (collapsed)      │                                           │
├─────────────────────────────┴───────────────────────────────────────────┤
│ Contacts (full width, compact DISC / H·M·L, scroll max-height)          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Manual QA checklist (v2.1)

- [ ] MEDDPICC collapsed by default; expand shows fields and “Not captured” / progress
- [ ] Contacts span full width; no horizontal cramming in left 5fr only
- [ ] Influence shows H/M/L (tooltip full word); DISC shows letter with tooltip
- [ ] Primary contact marked compactly; Activity expand still works
- [ ] Pursuit bar: deal-type, engagement-menu, deal-select (2+ deals) unchanged
- [ ] Detail search still filters contacts and tab content
- [ ] `cd web && npm test` passes
