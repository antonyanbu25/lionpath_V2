# Lionpath — SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research a prospect **before** the call, debrief **after** the call, and track **accounts, contacts, and deal progress** in one place.

| | |
|---|---|
| **Branch** | **`2.0.2`** — accounts CRM UI, contact frameworks, MEDDPICC, org hierarchy ([tree/2.0.2](https://github.com/skut264/lionpath/tree/2.0.2)) |
| **Live app** | **[https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com)** |
| **API** | **[https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com)** |
| **Repo** | [github.com/skut264/lionpath](https://github.com/skut264/lionpath) |
| **Demo login** | `se@freshworks.com` / `se123` |

---

## What it does

Lionpath (SE Singha Paathai) is an internal SE coaching portal with two core workflows:

| Workflow | When to use | What you get |
|----------|-------------|--------------|
| **Pre-call prep** | Before discovery or demo — you have a company name, prospect email, and optional context | A printable one-pager brief: company vs industry comparison, business context, and an SE playbook |
| **Post-call analysis** | After a recorded customer call — you have a Zoom cloud recording link | Call summary, prioritized next steps (including follow-up email + CRM notes), and a Quality Coach scorecard |

Both flows share the same polished one-pager layout, personal dashboard, and sidebar history — so SEs stay in one place from prep through debrief.

**Branch `2.0.2` adds an account-centric layer:** each company is a CRM-style record with lifecycle stage, contacts (DISC / influence), MEDDPICC qualification, activity, and linked preps / post-calls / tasks.

---

## Key features (branch `2.0.2`)

### Accounts — CRM-style detail (Crayons UI)

- **Accounts list** — filter by company, domain, contact, or stage; open any account for full context
- **Lifecycle pipeline** — open stages (Research → Business case) as a stepper; terminal outcomes (Closed won / lost / Nurture) as separate actions (replaces stage dropdown)
- **Contacts** — `fw-card` + accordion per person; primary contact expanded by default; DISC and influence shown with designed empty states (**Not assessed**) when prep/post-call has not run yet
- **MEDDPICC scorecard** — completion %, field grid with **Not captured** / **Partial** / **Confirmed** tags; populated incrementally from prep and post-call merges
- **Activity & artifacts** — timeline with event icons; preps, post-calls, and tasks in tabs

Domain data lives under `web/domain/` (`account-service`, `contact-service`, `lifecycle-service`). See **[docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md)** and **[docs/RELATIONSHIPS.md](./docs/RELATIONSHIPS.md)**.

### Org hierarchy & access (Freshworks seed)

- Director → senior leaders → squad managers → ICs; scoped visibility for artifacts and coaching views
- Profile settings (display name, avatar), user menu, theme — see **[docs/RBAC.md](./docs/RBAC.md)** and **[docs/adr/002-org-hierarchy.md](./docs/adr/002-org-hierarchy.md)**

### Pre-call — v3 one-pager

- **Comparison hero table** — This company vs industry norm across industry, size/agents, support channels, incumbent stack, integrations, and more
- **Bullet sections** — About the business, support process, workflows
- **SE playbook grid** — Top use case, pain points, discovery-gap questions, demo flow steps
- **Collapsible sources** — Cited URLs for prospect facts; gaps say "unknown" rather than being invented
- **Smarter domain handling** — Company name is the primary research target; the UI warns on likely email-domain typos (e.g. `khanacademey.org` → `khanacademy.org`)

**Typical wait:** 15–45 seconds (Gemini + web research).

### Post-call — redesigned one-pager

Mirrors the pre-call layout for a consistent SE experience:

- **Comparison hero** — This call vs follow-up across key call dimensions
- **Bullet sections** — Discussion highlights, pains & objections, competitive mentions & decisions, open questions
- **SE playbook grid** — Top priority action, SE/AE tasks, customer commitments
- **Quality Coach** — Six-dimension rubric (Discovery, Demo alignment, Objections, Value articulation, Next-step clarity, Talk balance) with scores, evidence, strengths, and improvements
- **Collapsible sources** — Suggested follow-up email, CRM notes, transcript details

**Typical wait:** 10–25 seconds (Zoom transcript fetch + Gemini analysis).

### UI/UX overhaul

- Fluid, professional dashboard layout with a soothing teal/blue palette
- **Dark mode toggle** — persisted in browser localStorage
- Responsive sidebar with call history and quality-score badges
- Print / PDF and copy-to-clipboard on every result

### Lion splash (first visit)

A 5-second branded animation with a lion roar plays on the **first visit to the portal** (cookie-based, `index.html` only). Returning users go straight to the app.

### Post-call intelligence

- **Gemini** structured JSON extraction from Zoom audio transcripts
- **Quality scorecard** calibrated for honest, evidence-based coaching (not cheerleading)
- **Zoom integration** — paste share link + passcode; no Zoom OAuth required for MVP
- **Server-side history** on VPS production — analyses sync across sessions via the worker API; local dev falls back to browser storage

### Authentication (demo)

| Role | Email | Password |
|------|-------|----------|
| **SE** | `se@freshworks.com` | `se123` |
| **SE (alt)** | `se1@freshworks.com` / `se2@freshworks.com` | `se123` |
| **Manager** | `manager@freshworks.com` | `mgr123` |

Production uses **Firebase Google SSO** with `@freshworks.com` domain restriction. See **[docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md)** to enable real login (dummy mode remains when `projectId` is empty).

---

## Screenshots & views (no images attached)

| View | What an SE sees |
|------|-----------------|
| **Login** | Branded sign-in with demo credential hints |
| **My dashboard** | Rolling quality averages, radar chart, score trend, recent calls table |
| **Pre-call prep** | Company + email form → v3 one-pager with comparison table and SE playbook |
| **New analysis** | Zoom link form → redesigned post-call one-pager with Quality Coach |
| **History (sidebar)** | Past analyses with quality scores; click to reload any call |
| **Manager view** | Placeholder team dashboard (rollup planned — see Roadmap) |

For a leadership-friendly walkthrough of post-call flow and FAQ, see **[docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md)**.  
For a browser-friendly product summary, see **[web/about.html](./web/about.html)**.

---

## Architecture (brief)

```
Browser (web/)  ──HTTPS──►  Worker API (worker/)  ──►  Gemini (default) or Claude
       │                           │
  Firebase Auth (optional)     API keys (server secrets only)
  localStorage / Firestore     Zoom share API → VTT transcript
                               File/KV history (VPS / Cloudflare)
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal — pre-call, post-call, dashboard, **accounts**, history, profile, Crayons (Freshworks Dew) |
| **`worker/`** | API server — `/api/generate-prep`, `/api/analyze-call`, `/api/history`, Zoom transcript fetch |
| **VPS (production)** | Docker Compose + Caddy HTTPS — see **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** |
| **LLM** | Gemini 3.1 Flash Lite (default) — web search for pre-call; structured JSON for post-call |

**Why a worker instead of browser-side AI?** API keys stay server-side; one pipeline keeps schema, scoring, and prompts consistent for every SE.

---

## Recent updates

| Area | What changed |
|------|--------------|
| **`2.0.2` — Accounts CRM** | Lifecycle pipeline stepper, Crayons cards/accordions/tags, MEDDPICC scorecard, two-column detail layout |
| **`2.0.2` — Contact intelligence** | DISC + influence on contacts; MEDDPICC on accounts; merge from prep/post-call; contact events |
| **`2.0.2` — Org** | Freshworks org seed, hierarchy scopes, profile UX, expanded `npm test` in `web/` |
| **Pre-call v3** | Comparison table, bullet sections, SE playbook grid, collapsible sources |
| **Post-call redesign** | Mirror pre-call layout — Quality Coach, playbook grid |
| **UI/UX** | Dew/Crayons theme, dark mode, responsive dashboard |
| **Production deploy** | VPS at `lionpath.benjaminsquare.com` + `lionpathapi.benjaminsquare.com` |

---

## Roadmap

| Item | Status |
|------|--------|
| **Firebase Google SSO** | Config ready; enable when project ID is set |
| **Firestore history** (cross-device, durable) | Rules exist; wired when Firebase is on |
| **Manager team dashboard** | Rollup across SEs — placeholder view exists today |
| **Formal manager-approved rubric** | Replace MVP AI calibration with signed-off criteria |
| **Zoom OAuth** | Optional — for accounts where share links are restricted |
| **Manual VTT upload in UI** | API supports it; UI is link-first today |

---

## Team quick start

### For SEs (daily use) — no install

1. Open **https://lionpath.benjaminsquare.com**
2. Log in (`se@freshworks.com` / `se123`)
3. **Before a call:** Pre-call prep → company + email + context → brief
4. **After a call:** New analysis → Zoom link → summary, next steps, Quality Coach

### For developers (local laptop)

**Two terminals on your machine:**

1. **Install Node.js** — LTS from [nodejs.org](https://nodejs.org/)
2. **Clone (this release):** `git clone -b 2.0.2 https://github.com/skut264/lionpath.git` → `cd lionpath`
3. **API key:** `cd worker`, copy `.dev.vars.example` to `.dev.vars`, add **GEMINI_API_KEY** from [Google AI Studio](https://aistudio.google.com/apikey). Never commit `.dev.vars`.
4. **Terminal A (API):** `cd worker && npm install && npm run dev` → **http://localhost:8787**
5. **Terminal B (UI):** `cd web && npx wrangler pages dev .` → **http://localhost:8788**
6. **Open** **http://localhost:8788** — log in with `se@freshworks.com` / `se123`
7. **Tests (web):** `cd web && npm test` — account view, contacts/MEDDPICC, org hierarchy, prep disputes, profile

Set `WORKER_BASE_URL` in `web/firebase-config.js` to `http://localhost:8787` for local dev.

**Push to `2.0.2`:** use SSH remote `git@github.com:skut264/lionpath.git`. If the remote branch already has unrelated history, use `git push lionpath 2.0.2 --force-with-lease` only when you intend to replace that branch tip.

| Terminal | Command | URL |
|----------|---------|-----|
| 1 — Worker | `cd worker && npm install && npm run dev` | http://localhost:8787 |
| 2 — Web | `cd web && npx wrangler pages dev .` | http://localhost:8788 |

Full onboarding (tunnel sharing, team handoff): **[TEAM_SETUP.md](./TEAM_SETUP.md)**

### Team development workflow

1. Create a **feature branch** from `main` (e.g. `feature/fix-prep-typo-domain`)
2. Develop and test locally (both terminals above)
3. Open a **pull request to `main`** for review
4. Deploy production from `main` — see Deploy section below

---

## Documentation

| Doc | Audience |
|-----|----------|
| [web/about.html](./web/about.html) | Boss / SEs — what the portal does (browser-friendly) |
| [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) | Leadership demo — post-call flow, Quality Coach, FAQ |
| [docs/SHARE_WITH_TEAM.md](./docs/SHARE_WITH_TEAM.md) | SEs & managers — team share pack |
| [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md) | Developers — domain entities (Account, Contact, Lifecycle, …) |
| [docs/RELATIONSHIPS.md](./docs/RELATIONSHIPS.md) | Developers — how entities link |
| [docs/RBAC.md](./docs/RBAC.md) | Developers — roles and visibility |
| [TEAM_SETUP.md](./TEAM_SETUP.md) | Developers — local setup, tunnel sharing, onboarding |
| [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) | IT / admin — VPS deploy (`lionpath` + `lionpathapi` URLs) |
| [deploy/vps/SECURITY.md](./deploy/vps/SECURITY.md) | IT / admin — secrets, SSH, file permissions |

---

## Deploy

### Option A — VPS (production — `lionpath.benjaminsquare.com`)

See **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)**. Stack: Caddy HTTPS, nginx web, Node worker, file-based history at `/var/lib/se-paathai/history`.

```bash
cd /opt/se-singha-paathai/deploy/vps
./setup.sh    # once
nano .env     # GEMINI_API_KEY, ALLOWED_ORIGINS=https://lionpath.benjaminsquare.com
./start.sh
```

### Option B — Cloudflare Worker + Pages

```bash
cd worker && npx wrangler deploy
cd web && npx wrangler pages deploy .
```

Set `WORKER_BASE_URL` in `web/firebase-config.js` to the production Worker URL; add the Pages origin to `ALLOWED_ORIGINS`.

---

## Developer reference

### Prerequisites

- Node 18+ and `npx`
- Gemini API key (default) or Anthropic key
- Firebase project (optional) — portal runs in no-auth preview without it

### Worker — smoke tests

```bash
cd worker
npm install
echo 'GEMINI_API_KEY = "your-key"' > .dev.vars
npm run dev   # http://localhost:8787

# Pre-call
curl -s http://localhost:8787/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | jq .prep.companySnapshot

# Post-call
curl -s http://localhost:8787/api/analyze-call \
  -H 'content-type: application/json' \
  -d '{"transcript":"SE: Thanks for joining.\nCustomer: We use Zendesk.","companyName":"GetGo"}' | jq .analysis.callSummary.headline
```

Config in `worker/wrangler.toml` (`[vars]`):

- `LLM_PROVIDER` — `gemini` (default on VPS) or `anthropic`
- `MODEL` / `EFFORT` — pre-call model and reasoning effort
- `POSTCALL_EFFORT` — post-call effort (default `low`; no web research)
- `ALLOWED_ORIGINS` — CORS (include `https://lionpath.benjaminsquare.com` in prod)
- `ALLOWED_EMAIL_DOMAIN` — sign-in restriction (default `freshworks.com`)
- `FIREBASE_PROJECT_ID` — empty disables auth; set to enforce ID-token verification

### Model strategy

| Use case | Default model | Latency target |
|----------|---------------|----------------|
| Pre-call (research) | `gemini-3.1-flash-lite` + `google_search` | **15–45s** |
| Pre-call (max quality) | `gemini-3.5-flash` or Claude + web search | 30–90s |
| Post-call (transcript) | `gemini-3.1-flash-lite` | **8–20s** |

- **Grounding:** Freshworks facts from `worker/src/kb.ts`; prospect facts from web research with citations
- **Post-call transcript:** Last ~6k words (~30–40 min of speech) for speed
- **Zoom link flow:** `worker/src/zoomShare.ts` — share/play URL + passcode → public Zoom APIs → VTT → analysis
