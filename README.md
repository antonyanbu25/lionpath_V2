# Lionpath — SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research prospects **before** the call, debrief **after** the call, and manage **accounts, contacts, deals, and team coaching** in one place.

| | |
|---|---|
| **This branch** | **`2.1.29`** — org hierarchy, pre/post-call CRM parity, contact dedupe, pre-call dual-write fixes, fish sizing, DISC dos/donts |
| **Portal build** | `2.1.29` (`web/index.html` → `portal-build` meta) |
| **Live app** | [https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com) |
| **Live API** | [https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com) |
| **Upstream repo** | [github.com/skut264/lionpath](https://github.com/skut264/lionpath) |
| **Production deploy fork** | [github.com/antonyanbu25/lionpath_V2](https://github.com/antonyanbu25/lionpath_V2) (VPS pulls from here) |

---

## Table of contents

1. [What it does](#what-it-does)
2. [Release highlights (2.1.29)](#release-highlights-2129)
3. [Architecture](#architecture)
4. [Repository layout](#repository-layout)
5. [Quick start (developers)](#quick-start-developers)
6. [Demo logins](#demo-logins)
7. [Testing](#testing)
8. [Deploy](#deploy)
9. [Documentation index](#documentation-index)
10. [Contributing & remotes](#contributing--remotes)

---

## What it does

Lionpath is an internal SE coaching portal with two core workflows plus CRM-style account management:

| Workflow | When | Output |
|----------|------|--------|
| **Pre-call prep** | Before discovery/demo — company, emails, LinkedIn PDFs, AE context | Printable one-pager: company vs industry, discovery kit, fish sizing, DISC dos/donts |
| **Post-call analysis** | After a recorded call — Zoom link + confirm identities | Summary, next steps, Quality Coach scorecard, MEDDPICC, timeline |
| **Accounts & deals** | Ongoing pursuit | Global account/contact/deal records, lifecycle pipeline, team visibility |

Both prep and post-call write to the **same domain model** — accounts, contacts, and deals are global entities; prep briefs and post-call artifacts attach to shared lifecycles.

---

## Release highlights (2.1.29)

### Org hierarchy & RBAC

- **Structure:** Director (Vipin) → 3 segment leaders → team managers → ICs (~50-person roster in seed data)
- **Segments:** Antony branch, Nurture, Digital (Digital is flat — ICs report to segment leader, no squad manager layer)
- **Scoped visibility:** Segment leaders see their segment; managers see their team; director sees org
- **Org structure editor:** Settings UI for Vipin + senior managers (`web/org-structure-view.js`)
- **Manager proxy SE:** Leaders can run prep/post-call on behalf of ICs with correct `teamId` / acting owner
- **Terminology:** "Squad" renamed to **team** across UI and docs

See [docs/RBAC.md](./docs/RBAC.md), [docs/ORG_HIERARCHY_VISUAL.md](./docs/ORG_HIERARCHY_VISUAL.md).

### Pre-call ↔ post-call CRM parity

Account, contact, and deal creation now share one code path:

- **`web/domain/engagement-entities.js`** — `resolveEngagementEntities`, `collectParticipantEmails`, `collectContactDraftsFromPayload`
- Both `linkPrepToLifecycle` and `linkPostCallToLifecycle` delegate to the shared helper
- Same account resolution: explicit id → slug/domain → create
- Same contact upsert via `resolveContactOnAccount`
- Same deal routing and `linkContactsToDeal` join

**Contact dedupe fix:** Post-call confirm identities (`Howard Ehrenberg <email>`) now parse display names; name normalization treats dots as spaces so prep email (`howard@duckdiverllc.com`) and post-call email (`howard.ehrenberg@vivid-pix.com`) merge to one global contact.

See [docs/PRECALL_POSTCALL_CRM_PARITY.md](./docs/PRECALL_POSTCALL_CRM_PARITY.md), [docs/PRECALL_FIX_REPORT.md](./docs/PRECALL_FIX_REPORT.md).

### Pre-call fixes

- Dual-write no longer skipped when `session.teamId` is missing
- CRM resolve uses company domain for personal-email prospects
- Fish sizing uses full AE context (not only `additionalContext` string)
- LinkedIn PDF required per prospect email before generate
- DISC dos/donts: 3+3 from enrich API; web merge no longer drops `donts`

### Account / deal / contact hardening

- Firestore rules for org structure, account team, cross-team proxy
- 90-day new-business grace, expansion prep unblocked
- Deal-scoped contacts on call view; acting-owner audit fields
- Round-2 P0 fixes from dual review pipeline

See [docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md](./docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md), [docs/REVIEW_ROUND2_FIX_REPORT.md](./docs/REVIEW_ROUND2_FIX_REPORT.md).

### Search, briefs, UI

- RAG omni-search (⌘K): accounts, deals, contacts, briefs, calls, tasks
- All-briefs list from dashboard KPI
- Centered login with video background; profile popup aligned to design system
- Portal build cache-bust via `portal-build` meta

---

## Architecture

```
Browser (web/)  ──HTTPS──►  Worker API (worker/)  ──►  Gemini (+ google_search)
       │                           │
  Firebase Auth (optional)     Secrets in worker/.dev.vars
  localStorage / Firestore     Zoom share → VTT transcript
                               File/KV history (VPS)
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal — prep, post-call, dashboard, accounts, deals, org settings, Crayons (Dew) UI |
| **`web/domain/`** | Client-side domain store — accounts, contacts, deals, lifecycles, dual-write, RBAC |
| **`worker/`** | API — prep synthesize, post-call passes, contact enrich, search RAG, org structure API |
| **Production** | Docker Compose + Caddy on VPS — see [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) |

**Domain model (Salesforce-shaped):**

- **Account** — company hub; slug + domain dedupe
- **Contact** — `(accountId, email)` with name-based merge for same person, alternate emails
- **Deal** — opportunity on account; MEDDPICC on deal metadata
- **Lifecycle** — engagement spine linking prep briefs, post-calls, tasks
- **dealContacts** — join table; primary contact on deal

See [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md), [docs/adr/003-account-deal-engagement.md](./docs/adr/003-account-deal-engagement.md).

---

## Repository layout

```
├── web/                 # Portal UI + client domain layer
│   ├── domain/          # account-service, deal-service, dual-write, engagement-entities, org-service
│   ├── scripts/         # Regression tests (npm test)
│   └── dev-server.mjs   # Local static server :8788
├── worker/              # Node API :8787
│   ├── src/prep/        # Research, synthesize, fish sizing, recent news
│   ├── src/postcall/    # Multi-pass post-call pipeline
│   └── scripts/         # Seed Firestore users, worker tests
├── docs/                # ADRs, RBAC, fix reports, architecture
├── firestore.rules      # Security rules (org structure, account team, artifacts)
├── deploy/vps/          # Production Docker + Caddy
└── README.md            # This file
```

---

## Quick start (developers)

### Prerequisites

- **Node.js 18+** (24.x recommended)
- **Gemini API key** — [Google AI Studio](https://aistudio.google.com/apikey)
- **Firebase** (optional) — portal runs in dummy-auth mode without `firebase-config.local.js`

### One-time setup

```bash
git clone https://github.com/skut264/lionpath.git
cd lionpath
git checkout 2.1.29

cd worker
cp .dev.vars.example .dev.vars
# Edit .dev.vars — set GEMINI_API_KEY=...
npm install

cd ../web
npm install
```

### Run locally

```bash
# From repo root — starts worker :8787 + web :8788
npm run dev:all

# Or separately:
cd worker && npm run dev:node   # API
cd web && npm run dev           # UI
```

Open **http://localhost:8788** and sign in with demo credentials (see below).

**Notes:**

- Leave `web/firebase-config.local.js` unset for **dummy login** on localhost
- Worker requires `GEMINI_API_KEY` in `worker/.dev.vars` for prep/post-call
- Hard-refresh (Cmd+Shift+R) after pulling to pick up new `portal-build`

### Stop dev servers

```bash
npm run stop:dev   # kills processes on 8787 and 8788
```

---

## Demo logins

Dummy auth when Firebase `projectId` is empty (default on localhost):

| Role | Email | Password |
|------|-------|----------|
| **Director** | `vipin.thomas@freshworks.com` | `vipin123` |
| **Segment leader (Antony branch)** | `antony.sagayaraj@freshworks.com` | `leader123` |
| **Segment leader (Digital)** | `preethi.sri@freshworks.com` | `leader123` |
| **Team manager** | `ajay.raghavan@freshworks.com` | `mgr123` |
| **SE (generic)** | `se@freshworks.com` | `se123` |

Production uses **Google SSO** with `@freshworks.com` restriction. See [docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md).

Seed roster: `worker/scripts/seed-users.example.csv`, `web/dummy-users.js`, `web/domain/seed-dev.js`.

---

## Testing

```bash
# Full web regression suite (~2–5 min)
cd web && npm test

# CRM parity (prep ↔ post-call)
node web/scripts/test-prep-postcall-crm-parity.mjs
node web/scripts/test-precall-dual-write-e2e.mjs
node web/scripts/test-contact-deal-mapping.mjs

# Org hierarchy
node web/scripts/test-org-service.mjs
node web/scripts/test-org-structure.mjs

# Worker unit tests
cd worker && npx tsx scripts/test-rivals-context.ts
```

Key modules under test: `engagement-entities.js`, `dual-write.js`, `account-service.js`, `contact-service.js`, `org-service.js`.

---

## Deploy

### VPS production (Tony's fork → live site)

Production VPS deploys from **`antonyanbu25/lionpath_V2`**, branch **`2.1`**:

```bash
# On VPS
cd /opt/se-singha-paathai
git fetch antony
git checkout 2.1
git pull antony 2.1
cd deploy/vps && bash upgrade-now.sh
```

See [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md).

### Push workflow summary

| Remote | Repo | Branch | Purpose |
|--------|------|--------|---------|
| **`skut264`** | skut264/lionpath | `2.1.29` | Upstream / team development (this push) |
| **`antony`** | antonyanbu25/lionpath_V2 | `2.1` | Production VPS deploy |
| **`origin`** | antonyanbu25/lionpath_V2 | `2.1` | Local default (same as antony) |

To publish this release to skut264:

```bash
git checkout 2.1.29
git push -u skut264 2.1.29
```

To deploy to production after review, merge/cherry-pick into `2.1` on the antony fork and push `antony 2.1`.

---

## Documentation index

| Doc | Audience |
|-----|----------|
| [web/about.html](./web/about.html) | Product overview (browser-friendly) |
| [docs/HLD.md](./docs/HLD.md) · [docs/LLD.md](./docs/LLD.md) | Architecture |
| [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md) | Domain entities |
| [docs/RBAC.md](./docs/RBAC.md) | Roles and visibility |
| [docs/PRECALL_POSTCALL_CRM_PARITY.md](./docs/PRECALL_POSTCALL_CRM_PARITY.md) | Prep/post-call shared CRM path |
| [docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md) | DISC / enrich API |
| [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) | Production deploy |
| [TEAM_SETUP.md](./TEAM_SETUP.md) | Onboarding & tunnels |
| [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) | Leadership demo |

**Fix / review reports (2.1 pass):**

- [docs/PRECALL_FIX_REPORT.md](./docs/PRECALL_FIX_REPORT.md)
- [docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md](./docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md)
- [docs/REVIEW_ROUND2_FIX_REPORT.md](./docs/REVIEW_ROUND2_FIX_REPORT.md)
- [docs/ULTRA_REVIEW_A.md](./docs/ULTRA_REVIEW_A.md) · [docs/ULTRA_REVIEW_B.md](./docs/ULTRA_REVIEW_B.md)

---

## Contributing & remotes

```bash
# Add skut264 upstream (once)
git remote add skut264 https://github.com/skut264/lionpath.git

# Add production fork (once)
git remote add antony https://github.com/antonyanbu25/lionpath_V2.git

# Feature workflow
git checkout -b feature/my-change 2.1.29
# ... develop, npm test ...
git push -u skut264 feature/my-change
# Open PR to 2.1.29 on skut264/lionpath
```

**Do not commit:** `worker/.dev.vars`, `web/firebase-config.local.js`, API keys, `.cursor/` debug logs.

---

## License & ownership

Internal Freshworks SE tooling. Not for public distribution without approval.
