# Account record v4 — 1b Compact command

Supersedes the **layout shell** in [account-record-v3-crm-inspired.md](./account-record-v3-crm-inspired.md) while keeping Option B behaviors (summary facts, deals list, contact drill-down, pursuit bar logic). Design direction: external **1b Compact command** — dense meta rail, tight header, single-screen command deck.

**Implementation:** [`web/account-view.js`](../../web/account-view.js), [`web/lifecycle.css`](../../web/lifecycle.css).

---

## Detail — command chrome

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← All accounts    Acme Corp                          [New prep] [Post-call]   │  tight header
├──────────────────────────────────────────────────────────────────────────────┤
│ DOMAIN      MOTION    STAGE       PRIMARY CONTACT    ICP    PRIMARY SE  LAST│  meta rail (labeled cells, horizontal scroll)
│ acme.com    [NB]      Discovery   Alex Lee           …      Test SE     …  │
├──────────────────────────────────────────────────────────────────────────────┤
│ [NB|Expansion] [Switch deal▼] [Lens▼] [Engagement▼]  │ pipeline →→ terminal │  pursuit command (sticky)
└──────────────────────────────────────────────────────────────────────────────┘
```

**De-duplication:** Read-only facts only in meta rail. Pursuit row holds editable motion, deal switch, lens, engagement, pipeline.

---

## Detail — command deck (viewport-bounded scroll per column)

```text
┌─────────────────┬──────────────────────────────┬─────────────────┐
│ Contacts        │ Filter… Activity|Preps|…     │ Deal team       │
│ (narrow rows)   │ (timeline hero)              │ ▶ MEDDPICC      │
│ avatar name     │                              │ ▶ Deals (if 2+) │
│ title badges    │                              │                 │
└─────────────────┴──────────────────────────────┴─────────────────┘
   ~28%                    ~44%                        ~28%
```

**Contact focus:** Left column only → contact detail panel + back; center/right unchanged.

**Breakpoints:** &lt;960px — deck stacks: Activity → Contacts → Reference.

---

## List — compact command

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Accounts · filter input                                                      │
├──────────────┬────────┬────────┬─────────────┬──────────────┬───────────────┤
│ Company      │ Stage  │ Motion │ Primary SE  │ Last activity│ Score         │  desktop header
├──────────────┼────────┼────────┼─────────────┼──────────────┼───────────────┤
│ Acme · domain│ badge  │ tag    │ name        │ date         │ 8/10          │  row (fw-button)
└──────────────┴────────┴────────┴─────────────┴──────────────┴───────────────┘
```

Mobile: hide column header; each row shows label/value pairs.

---

## Preserved behaviors (must not regress)

| Behavior | Hook / route |
|----------|----------------|
| Pursuit type | `data-action="deal-type"` |
| Switch deal (2+ active) | `data-action="deal-select"`, label Switch deal |
| Lifecycle lens | `data-action="lifecycle-lens"` |
| Engagement menu | `data-action="engagement-menu"` |
| Prep / post-call context | `data-action="prep"`, `postcall` |
| Hash account | `#accounts/{accountId}` |
| Hash deal | `#accounts/{id}/deals/{dealId}` |
| Hash contact | `#accounts/{id}/contacts/{contactId}` |
| Contact drill-down | `data-action="open-contact"`, `back-from-contact` |
| Deals table | `data-action="select-deal"` when 2+ active or archived |
| Detail filter | `#account-detail-search` |
| List filter | `#account-list-search` |
| Account-level MEDDPICC | collapsible `account-meddpicc-details` |

---

## QA notes

- Chrome ~2–2.5 rows; deck visible at 1440×900 without page scroll.
- Meta rail horizontal scroll on narrow widths.
- Dew tokens from `dew-theme.css`; Crayons `fw-*` only.
