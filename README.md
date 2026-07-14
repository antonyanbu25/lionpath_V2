# SE Singha Paathai — SE Portal

**One portal for Freshworks Solution Engineers:** research a prospect **before** the call, then debrief **after** the call — summaries, next steps, and coaching in a single dashboard.

**Live (team):** **[https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com)**  
**Repo:** [github.com/skut264/lionpath](https://github.com/skut264/lionpath)

| Doc | Audience |
|-----|----------|
| [web/about.html](./web/about.html) | Boss / SEs — what the portal does (browser-friendly) |
| [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) | Leadership demo — post-call flow, Quality Coach, FAQ |
| [TEAM_SETUP.md](./TEAM_SETUP.md) | Developers — local setup, tunnel sharing, onboarding |
| [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) | IT / admin — VPS deploy (`lionpath` + `lionpathapi` URLs) |

---

## Pre-call prep

**When to use:** Before a discovery or demo — you have a company name, prospect email, and optionally Roundhouse (RH) answers or other context.

**What the SE does:**

1. Sign in to the portal.
2. Open the **Pre-call prep** tab.
3. Enter **company name**, **prospect email**, and optional **additional context** (paste RH answers, meeting notes, or AE notes here).
4. Click **Generate prep brief** and wait ~15–45 seconds.

**What you get** (Gemini + web research, grounded on the Freshworks knowledge base):

| Output | Contents |
|--------|----------|
| **Research Snapshot** | What they do, size, support channels, inferred tech stack (with inline confidence), pain points, goals, discovery-gap questions |
| **Demo Plan** | Suggested flow, 3–4 ranked use cases (SE picks the Freshworks feature), close paragraph, competitor differentiators only for vendors detected in the stack |
| **Sources** | Collapsible list of cited URLs for prospect facts — gaps say "unknown" rather than being invented |

**How it works under the hood:** The web UI posts to `/api/generate-prep` on the worker. The worker derives the company domain from the prospect email, runs Gemini with `google_search` grounding (3–4 focused searches), merges Freshworks facts from `worker/src/kb.ts`, and returns structured JSON (`worker/src/prep.ts`, `worker/src/schema.ts`). The portal renders a printable one-pager (`web/app.js`).

**SE tips:**

- Put RH questionnaire answers in **additional context** — meeting-type / AE fields were removed from the UI on purpose.
- Expect **15–45s** with the default fast model (`gemini-3.1-flash-lite`); the UI disables double-submit while researching.
- Print / PDF or copy raw JSON from the toolbar when done.

---

## Post-call analysis

**When to use:** After a recorded customer demo or discovery call — you have a Zoom cloud recording link.

**What the SE does:**

1. Sign in and open **New analysis**.
2. Paste the **Zoom recording share link** (and passcode if not embedded in the URL).
3. Click **Analyze call** and wait ~10–25 seconds.
4. Review **call summary**, **next steps** (including follow-up email draft + CRM notes), and **Quality Coach** scorecard.
5. Open **My dashboard** for cumulative quality metrics, or **History** (sidebar) to reload any past analysis.

**What you get:**

| Output | Contents |
|--------|----------|
| **Call summary** | Headline, customer context, attendees, topics, pains confirmed, objections, competitive mentions, decisions, open questions |
| **Next steps** | Prioritized SE/AE actions, customer commitments, copy-ready follow-up email, CRM notes |
| **Quality Coach** | Six-dimension rubric (Discovery, Demo alignment, Objections, Value articulation, Next-step clarity, Talk balance) with scores, evidence, strengths, and improvements |
| **Dashboard & history** | Rolling averages, radar chart, score trend, recent calls table; sidebar history (up to 100 items) |

**Zoom requirements (no OAuth for MVP):** Cloud recording + audio transcript enabled; share link downloadable; embedding passcode in the link is best UX. See [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) for the full leadership walkthrough, scoring calibration, and FAQ.

**Latency:** Post-call skips web research — typically **8–20s** (Gemini Flash Lite) after a 2–5s transcript fetch.

---

## Architecture

```
Browser (web/)  ──HTTPS──►  Worker API (worker/)  ──►  Gemini (default) or Claude
       │                           │
  Firebase Auth (optional)     API keys (server secrets only)
  Firestore / localStorage     Zoom share API → VTT transcript
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal — pre-call form, post-call analysis UI, dashboard, history |
| **`worker/`** | Node/Cloudflare Worker — `/api/generate-prep`, `/api/analyze-call`, auth verification |
| **LLM** | Gemini (default) with web search for pre-call; structured JSON for post-call |

**Why a worker instead of browser-side AI?** API keys must stay server-side; Firebase Spark blocks outbound LLM calls from Cloud Functions; one pipeline keeps schema and scoring consistent for every SE.

### Production URLs (VPS)

| URL | Service |
|-----|---------|
| **https://lionpath.benjaminsquare.com** | Web UI |
| **https://lionpathapi.benjaminsquare.com** | Worker API |

Deploy: **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** — Docker Compose + Caddy on Netcup (or any Linux VPS). Alternative: Cloudflare Worker + Pages (see Deploy section below).

---

## Team quick start

### For SEs (daily use) — no install

Once deployed, **open the portal in a browser**. No `npm`, no API keys on SE laptops.

1. Go to **https://lionpath.benjaminsquare.com**
2. Log in (demo: `se@freshworks.com` / `se123` — production will use Google SSO)
3. **Before a call:** Pre-call prep → company + email + context → brief
4. **After a call:** New analysis → Zoom link → summary, next steps, Quality Coach

### For developers (local laptop)

**ELI5 — two terminals on your machine:**

1. **Install Node.js** — LTS from [nodejs.org](https://nodejs.org/)
2. **Clone:** `git clone https://github.com/skut264/lionpath.git` → `cd lionpath`
3. **API key:** `cd worker`, copy `.dev.vars.example` to `.dev.vars`, add **GEMINI_API_KEY** from [Google AI Studio](https://aistudio.google.com/apikey). Never commit `.dev.vars`.
4. **Terminal A (API):** `cd worker && npm install && npm run dev` → **http://localhost:8787**
5. **Terminal B (UI):** `cd web && npx wrangler pages dev .` → **http://localhost:8788**
6. **Open** **http://localhost:8788** — log in with `se@freshworks.com` / `se123`

Set `WORKER_BASE_URL` in `web/firebase-config.js` to `http://localhost:8787` for local dev.

Full onboarding (tunnel sharing, team handoff): **[TEAM_SETUP.md](./TEAM_SETUP.md)**

| Terminal | Command | URL |
|----------|---------|-----|
| 1 — Worker | `cd worker && npm install && npm run dev` | http://localhost:8787 |
| 2 — Web | `cd web && npx wrangler pages dev .` | http://localhost:8788 |

**8788** is the browser URL; **8787** is the API the UI calls in the background.

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

**Changing provider:** add `worker/src/providers/<name>.ts`, register in `providers/index.ts`, set `LLM_PROVIDER`. Web research is provider-specific (Anthropic `web_search`, Gemini `google_search`).

### Web — dummy login (no Firebase)

When `firebaseConfig.projectId` is empty, the portal uses dummy credentials and stores history in **localStorage**.

| Role | Email | Password |
|------|-------|----------|
| SE | `se@freshworks.com` | `se123` |
| SE (alt) | `se1@freshworks.com` / `se2@freshworks.com` | `se123` |
| Manager | `manager@freshworks.com` | `mgr123` |

**SE views after login:** My dashboard · New analysis · History · Pre-call prep

### Firebase (optional — sign-in + durable history)

1. Create Firebase project; enable **Authentication → Google**.
2. Enable **Firestore**; deploy `firestore.rules`.
3. Copy web config into `web/firebase-config.js`.
4. Set Worker `FIREBASE_PROJECT_ID` and add Pages/VPS origin to `ALLOWED_ORIGINS`.

---

## Deploy

### Option A — VPS (recommended for `lionpath.benjaminsquare.com`)

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

## Model strategy & notes

| Use case | Default model | Latency target |
|----------|---------------|----------------|
| Pre-call (research) | `gemini-3.1-flash-lite` + `google_search` | **15–45s** |
| Pre-call (max quality) | `gemini-3.5-flash` or Claude + web search | 30–90s |
| Post-call (transcript) | `gemini-3.1-flash-lite` | **8–20s** |

- **Output format:** Research Snapshot table + Demo Plan + collapsible Sources (`worker/src/schema.ts`, `web/app.js`).
- **Grounding:** Freshworks facts from `worker/src/kb.ts` only; prospect facts from web research with citations.
- **Post-call transcript:** Last ~6k words (~30–40 min of speech) for speed.
- **Zoom link flow:** `worker/src/zoomShare.ts` — share/play URL + passcode → public Zoom APIs → VTT → analysis. OAuth is optional later.
- **Cost:** Web search ~$10 / 1k searches plus tokens — negligible at SE volume.
