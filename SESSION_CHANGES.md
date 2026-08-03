# Session changes — Release 2.0.8.1-merge

Merged `lionpath-2.0.8.1.zip` (precall pipeline + UI) with `lionpath_V2-2.0.7.3-2026-08-03.zip` (QIP v2.1 post-call UX) onto branch `2.0.7.4`, preserving login SSO and contact-primary identity work.

**From 2.0.8.1 (precall):**
- Latest prep pipeline (`company-news.ts`, `rivals.ts`, prep validation, source display)
- Precall web UI (`precall.js`, `precall.css`, `precall-render.js`, `precall-brief-v9.js`, CRM resolve)

**From 2.0.7.3 (postcall):**
- QIP v2.1 scoring engine + generated rubric profiles
- Coach module, QIP radar, redesigned postcall/call-view UX
- Task F naming for deals and calls

**Preserved from 2.0.7.4 workspace:**
- Login SSO redesign (`login-showcase`, Google SSO block)
- Contact-primary post-call identity model (`stampCallIdentities`, CRM matches panel)
- `contacts-view.js` and sidebar alignment

**Version stamps:** `portal-build: 2.0.8.1-merge`, `workerBuild: 2.0.8.1-merge`

---

theme: make the **contact email(s)** the primary identifier for the post-call flow —
surface existing accounts/deals from typed emails, create/name records meaningfully,
and record AE / primary SE / secondary SE / contacts as first-class call identifiers.

> **Local run note:** the app runs locally with `web` on `:8788` and `worker` on `:8787`.
> The worker reads a Gemini API key from `worker/.dev.vars` (gitignored — **not** committed
> or included in any zip). Demo login: `se@freshworks.com` / `se123`.

---

## Phase 1 — Contact-primary CRM surfacing (no schema change)

Given the emails typed into the post-call form, look up every existing Account and Deal
already tied to those contacts and show them inline before an analysis runs.

- **Stores — cross-account reverse lookup (new methods):**
  - `findContactsByEmail(email)` and `findAccountsByDomain(domain)` added to both
    `web/domain/firestore-store.js` and `web/domain/local-store.js`.
    (Firestore single-field equality is auto-indexed — no `firestore.indexes.json` change.)
- **New module `web/postcall-contact-resolve.js`** — `resolveContactsForEmails(emails)`
  resolves each email → contact(s) → account(s) → deals, plus a corporate-domain fallback
  (free-mail domains excluded).
- **"Found in CRM" panel** under the post-call email field (`web/postcall.js`,
  `web/index.html` `#pc-crm-matches`, styles in `web/postcall.css`): per-email account/deal
  chips, clickable to select the account; "＋ New account" hint for unmatched emails.

## Phase 2 — Naming + all-emails-as-contacts

- **Deal titles:** `"<Account> - Deal <N> - <yyyy-mm-dd>"` (N increments per account).
  `nextDealTitle` / `resolveNewDealTitle` / `ensureDealTitle` in `web/domain/deal-service.js`;
  wired into `getOrCreateNewBusinessDeal`, `createExpansionDeal`, `ensureDealForLifecycle`.
- **Lazy retro-rename:** legacy `"New business"` / `"Expansion"` / account-name-echo titles
  are upgraded on read (`getDeal`, `listDealsForAccount`).
- **Migration script:** `worker/scripts/migrate-deal-titles.mjs` (`npm run migrate:deal-titles`)
  bulk-renames legacy deal titles in Firestore.
- **Call titles:** `"<Type> with <Account>"` (e.g. `"Discovery with Acme"`) via the shared
  `web/call-type-labels.js`; applied in `web/domain/dual-write.js`.
- **All typed emails become contacts:** `applyPostCallContactFrameworks`
  (`web/domain/contact-service.js`) now also ensures a contact for every typed
  `participantEmail`, not just transcript-derived attendees.

## Phase 3 — Identity model (AE, primary/secondary SE, contacts on the call)

- **Structured AE on the deal:** `Deal.metadata.ae = { name?, email? }`
  (types: `web/domain/types.js`, `worker/src/domain-model/deal.ts`; docs: `docs/ENTITY_CATALOG.md`).
- **Call identity stamp:** `PostCallDoc.identities =
  { aeName, aeEmail, primarySeUserId, secondarySeUserIds[], contactIds[] }`
  (types: `web/domain/types.js`, `worker/src/domain-model/artifacts.ts`).
  Populated by `stampCallIdentities` in `web/domain/dual-write.js`, sourced from the
  confirmed gate identities + the account `seTeam` + created contacts.
- **Second-SE auto-add:** when a different SE analyzes a call on an existing account they
  are auto-added to `Account.seTeam` as `secondary` (respecting `MAX_SE_TEAM_SIZE`), reusing
  the existing `ensureSeTeamForPrepActor` (already invoked in the post-call dual-write path).
- The confirm gate already captured SE / AE / customer identities; those now persist.

## Phase 4 — Views, search, and "My contacts"

- **Shared contact tiles:** new `web/contact-tile.js` (`renderContactTileList`,
  `wireContactTiles`) reusing the existing `.account-contact-*` styles.
- **Deal view:** a Contacts panel (AE line + contact tiles) added to the deal-record aside
  (`web/deal-view.js`); tiles open the parent account (`onOpenAccount` wired in `web/app.js`).
- **Search:** contacts are now first-class search results and deals match by email
  (`web/search-service.js`, `web/global-search.js`).
- **"My contacts" surface:** new nav item + view (`web/index.html`, `web/app.js`,
  new `web/contacts-view.js`) listing every contact across the SE's accounts, via new
  `listContactsForSession` in `web/domain/account-service.js`.

## Confirm-gate "Account match" slim

The gate's account module now honors the account picked at intake: it shows
**"Account matched · <name>"** (with a *Change* button) and hides the company-name /
search fields when an account was already matched/picked; the full "search or create"
only appears for a genuinely unmatched, brand-new company. Eyebrow reads
**"Account matched"** vs **"Deal matched"** correctly. (`web/postcall.js` `renderConfirmationGate`.)

---

## Verification

- Domain-layer flow (`linkPostCallToLifecycle`) driven directly: account/deal creation,
  naming, contacts, AE-on-deal, call identity stamp, and second-SE auto-add all confirmed.
- **Real end-to-end run** through the live Gemini pipeline (pasted transcript): resolve →
  classify → confirm gate → generate → dual-write produced a correct call record
  (`Discovery with Northwind Traders`, deal `Northwind Traders - Deal 1 - <date>`, AE
  Dana Cole, both contacts, identity stamp, QIP 75).
- All existing tests that exercise the changed files pass (`test-deal-view`,
  `test-contact-service`, `test-search-service`, `test-account-view`, `test-deal-motion`,
  `test-deal-e2e`, `test-deal-call-linking`, `test-postcall-resolve-context`); worker
  `tsc --noEmit` clean. Pre-existing/environmental failures (Playwright not installed,
  `sessionStorage` in Node, a stale import in `test-nextsteps-shape`, ARR/theme
  version-string asserts) are unrelated to these changes.

## Optional follow-up (not done)

- **Account `domain` derivation:** when a post-call is created from a free-text company with
  no typed domain, `Account.domain` stays `null`. Email-based matching still works; deriving
  the domain from participant corporate emails in `dual-write.js` would also enable
  domain-based matching for future calls. ~2-line change, left out pending confirmation.

## New / changed files

**New:** `web/postcall-contact-resolve.js`, `web/call-type-labels.js`, `web/contact-tile.js`,
`web/contacts-view.js`, `worker/scripts/migrate-deal-titles.mjs`, `SESSION_CHANGES.md`,
`.claude/launch.json`.

**Changed:** `web/postcall.js`, `web/postcall.css`, `web/index.html`, `web/app.js`,
`web/deal-view.js`, `web/search-service.js`, `web/global-search.js`, `web/lifecycle.css`,
`web/domain/firestore-store.js`, `web/domain/local-store.js`, `web/domain/deal-service.js`,
`web/domain/dual-write.js`, `web/domain/contact-service.js`, `web/domain/account-service.js`,
`web/domain/types.js`, `worker/src/domain-model/deal.ts`, `worker/src/domain-model/artifacts.ts`,
`worker/package.json`, `docs/ENTITY_CATALOG.md`.
