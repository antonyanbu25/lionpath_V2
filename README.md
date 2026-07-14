# SE Singha Paathai — SE Dashboard

Internal portal for Freshworks Solution Engineers: **pre-call prep** and **post-call analysis**
in one dashboard.

```
web/ (Cloudflare Pages)  ──►  worker/ (Cloudflare Worker)  ──►  LLM (Claude / Gemini)
        │                              │
   Firebase Auth (Google)        API keys (secrets)
   Firestore (history)
```

**Tabs:**
- **Pre-call** — company + email (+ RH context) → researched demo prep brief
- **Post-call** — Zoom transcript → call summary, SE next steps, quality coach

**Why the split:** Firebase's free (Spark) plan blocks outbound network calls from Cloud
Functions, so LLM calls run on the Cloudflare Worker (free tier allows `fetch`), which
also keeps API keys off the client. Firebase is used only for Auth + Firestore.

**Team onboarding:** For detailed local setup, Cloudflare Tunnel sharing, and production
deploy pointers, see **[TEAM_SETUP.md](./TEAM_SETUP.md)**.

**VPS hosting (Netcup / self-hosted):** See **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** —
Docker Compose + Caddy on `lion.benjaminsquare.com` / `api.lion.benjaminsquare.com`.

**Post-call feature (demo / presentation):** See **[docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md)** —
elevator pitch, flow diagram, Quality Coach dimensions, scoring, Zoom requirements, and leadership FAQ.

---

## Team quick start (5 steps)

**ELI5 — run the app on your laptop (not production):**

1. **Install Node.js** — Download the LTS installer from [nodejs.org](https://nodejs.org/) and click through it. Node is the engine that runs our code on your computer.
2. **Get the code** — In a terminal: `git clone https://github.com/kuttas246/se-singha-paathai.git`, then `cd se-singha-paathai`.
3. **Copy the API key file** — `cd worker`, copy `.dev.vars.example` to `.dev.vars`, and put your **Gemini API key** inside (from [Google AI Studio](https://aistudio.google.com/apikey)). Never commit `.dev.vars` — it stays only on your machine.
4. **Open two terminal windows** — **Window A (behind the scenes):** `cd worker`, `npm install`, `npm run dev` → listens on **http://localhost:8787**. **Window B (the website):** `cd web`, `npx wrangler pages dev .` → listens on **http://localhost:8788**.
5. **Open the app** — In your browser go to **http://localhost:8788**. Log in with **se@freshworks.com** / **se123** (dummy credentials for local testing only).

**8788 vs 8787:** **8788** is what you open in the browser (the app). **8787** is the worker API running in the background; the web UI calls it. Local dev: set `WORKER_BASE_URL` in `web/firebase-config.js` to `http://localhost:8787`.

**Note:** These five steps are only for developers trying the portal on a laptop. Production SEs use the deployed Cloudflare Pages URL — no `npm run dev`, no API keys on their machines.

### For SEs (daily use) — no `npm run dev`

Once the app is deployed to Cloudflare, **all 680 SEs just open the Pages URL** in a browser.
No local setup, no terminals, no API keys on their machines.

### For developers (building / testing changes)

After `git clone`, you need **two terminals** while developing locally:

| Terminal | Command | URL |
|----------|---------|-----|
| 1 — Worker | `cd worker && npm install && npm run dev` | http://localhost:8787 |
| 2 — Web | `cd web && npx wrangler pages dev .` | http://localhost:8788 |

Each teammate who runs the worker locally needs a **Gemini API key** in `worker/.dev.vars` (gitignored):

```bash
cd worker
cp .dev.vars.example .dev.vars   # if present, or create manually
# Add: GEMINI_API_KEY = "your-key-from-google-ai-studio"
```

Set `WORKER_BASE_URL` in `web/firebase-config.js` to `http://localhost:8787` for local dev.

**Deploy once** (`wrangler deploy` + Pages deploy) — production SEs never run `npm run dev`.

---

## Prerequisites

- Node 18+ and `npx`
- An Anthropic API key
- (For sign-in + history) a Firebase project — optional; the portal runs without it in a no-auth
  preview mode.

## 1. Worker — local dev

```bash
cd worker
npm install
# Gemini (default provider) — for local dev, wrangler reads .dev.vars (gitignored):
echo 'GEMINI_API_KEY = "your-key"' > .dev.vars
# Or Anthropic: npx wrangler secret put ANTHROPIC_API_KEY
npm run dev                                  # serves http://localhost:8787
```

Smoke test:

```bash
curl -s http://localhost:8787/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | jq .prep.companySnapshot

# Post-call smoke test (paste a short transcript)
curl -s http://localhost:8787/api/analyze-call \
  -H 'content-type: application/json' \
  -d '{"transcript":"SE: Thanks for joining. What support tools do you use?\nCustomer: We use Zendesk.\nSE: Great, let me show Freddy AI deflection.","companyName":"GetGo"}' | jq .analysis.callSummary.headline
```

Config lives in `worker/wrangler.toml` (`[vars]`):
- `LLM_PROVIDER` — `anthropic` (default). See "Changing model or provider" below.
- `MODEL` — `claude-sonnet-5` (default: fast + strong) or `claude-opus-4-8` for max quality.
- `EFFORT` — `low | medium | high | xhigh | max`. Default `medium` (balances speed and the
  reasoning-heavy synthesis). Bump to `high` if briefs read generic; drop to `low` for max speed.
- `POSTCALL_EFFORT` — effort for post-call analysis (default `low`; no web research).
- `ALLOWED_ORIGINS` — comma-separated Pages origins for CORS (add your Pages URL for prod).
- `ALLOWED_EMAIL_DOMAIN` — restrict sign-in (default `freshworks.com`).
- `FIREBASE_PROJECT_ID` — **leave empty to disable auth**; set it to enforce Firebase ID-token
  verification on every request.

### Changing model or provider

- **Different Claude model:** set `MODEL` (and `EFFORT`) in `wrangler.toml`, redeploy.
- **Different provider** (Gemini, Ollama, …): add `worker/src/providers/<name>.ts` exporting a
  function that returns an `LlmProvider` (implement `generate()`), register it in
  `worker/src/providers/index.ts`, set `LLM_PROVIDER=<name>` and provider credentials. Nothing else
  in the app changes. Note: web research is provider-specific — Anthropic uses server-side
  `web_search`; Gemini would map to `google_search` grounding; Ollama has no built-in search
  (wire a separate search step or run without research). The stubs in `providers/index.ts` say
  exactly where to plug in.

## 2. Web — local dev

```bash
cd web
npx wrangler pages dev .        # serves http://localhost:8788
```

### Dummy login (default — no Firebase)

When `firebaseConfig.projectId` is empty, the portal uses **dummy credentials** and stores
post-call history in **localStorage** (per SE email). Firebase SSO can replace this later.

| Role | Email | Password |
|------|-------|----------|
| SE | `se@freshworks.com` | `se123` |
| SE (alt) | `se1@freshworks.com` / `se2@freshworks.com` | `se123` |
| Manager | `manager@freshworks.com` | `mgr123` |

**SE flow after login:**
- **My dashboard** — cumulative call quality metrics across all analyzed recordings
- **New analysis** — paste Zoom link → summary, next steps, quality coach
- **History** (sidebar) — click any past recording to reload its analysis
- **Pre-call prep** — unchanged research brief flow

Manager login shows a placeholder team view (coming soon).

Smoke test (dashboard aggregation, no browser):

```bash
node web/scripts/test-dashboard.mjs
```

Edit `web/firebase-config.js`:
- Leave `firebaseConfig.projectId` empty → no-auth preview (forms work, no sign-in/history).
- Set `WORKER_BASE_URL` to your Worker URL (`http://localhost:8787` locally).

## 3. Firebase (optional — enables sign-in + history)

1. Create a Firebase project; enable **Authentication → Google** sign-in.
2. Enable **Firestore** (production mode).
3. Deploy the rules in `firestore.rules` (Firebase console → Firestore → Rules, or
   `firebase deploy --only firestore:rules`).
4. Copy the web app config into `web/firebase-config.js` (`apiKey`, `authDomain`, `projectId`,
   `appId`).
5. Set the Worker's `FIREBASE_PROJECT_ID` var (in `wrangler.toml`) to the same project id so the
   Worker verifies ID tokens. Add your Pages origin to `ALLOWED_ORIGINS`.
6. In Firebase Auth settings, add your Pages domain to **Authorized domains**.

The Worker verifies the Google-signed ID token (signature via Firebase's public JWKs, plus
audience/issuer/expiry) and the `@freshworks.com` email domain before calling Claude.

## 4. Deploy

### Option A — VPS (Netcup / self-hosted) — recommended for `lion.benjaminsquare.com`

See **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)**. One-command stack: Caddy HTTPS, nginx web,
Node worker with file-based history at `/var/lib/se-paathai/history`.

```bash
# On the VPS (after SSH login)
cd /opt/se-singha-paathai/deploy/vps
./setup.sh    # once
nano .env     # set GEMINI_API_KEY
./start.sh
```

### Option B — Cloudflare Worker + Pages

```bash
# Worker
cd worker && npx wrangler deploy

# Web → Cloudflare Pages (connect the repo in the dashboard, or:)
cd web && npx wrangler pages deploy .
```

After deploy, set `WORKER_BASE_URL` in `web/firebase-config.js` to the production Worker URL and add
the Pages origin to the Worker's `ALLOWED_ORIGINS`.

---

## Post-call (new)

**MVP flow:** SE pastes or uploads a Zoom VTT transcript → Worker parses speakers/duration
deterministically → LLM produces:

1. **Call summary** — attendees, topics, pains confirmed, objections, competitive mentions
2. **Next steps** — prioritized SE actions, AE actions, follow-up email draft, CRM notes
3. **Quality coach** — 6-dimension rubric with scores, evidence, strengths, improvements

**Latency:** post-call skips web research; target **8–20s** with `gemini-3.1-flash-lite`, or
**20–40s** with Claude Sonnet at `low` effort.

### Zoom transcript (no OAuth app required)

| Method | What SE does | Status |
|--------|----------------|--------|
| **Recording link + passcode** | Paste `zoom.us/rec/share/…` or `…/rec/play/…` + passcode | **Done** |
| Paste / upload VTT | Manual fallback | Done |
| Zoom OAuth (phase 2) | Connect Zoom account | Optional later |

**Recording link flow** (`worker/src/zoomShare.ts`):
1. SE copies the **share link** from Zoom (Cloud Recordings → Share).
2. If the link includes `?pwd=…` (admin setting: *Embed passcode in shareable link*), one click works.
3. Otherwise paste the **plain passcode** from the “recording is ready” email.
4. Worker calls Zoom’s public share APIs → downloads VTT → Gemini analyzes.

**Zoom admin settings that help:**
- Cloud recording + **Audio transcript** enabled
- **Allow anyone with link to download** (for transcript file access)
- **Embed passcode in shareable link** (best UX — no separate passcode field)

**Limitations:** Links that require Zoom login (not just passcode), expired recordings, or on-demand registration pages are not supported without OAuth.

### Model strategy (speed vs quality)

| Use case | Default model | Why | Latency target |
|----------|---------------|-----|----------------|
| Pre-call (research) | **gemini-3.1-flash-lite** + `google_search` | Fastest model available on new API keys; thinking disabled | **15–45s** |
| Pre-call (max quality) | `gemini-3.5-flash` or Claude Sonnet + web_search | Richer synthesis | 30–90s |
| Post-call (transcript) | **gemini-3.1-flash-lite** | Structured JSON, no search; tail-trimmed transcript | **8–20s** |
| Testing (no GCP yet) | Claude Sonnet `low` effort | Already wired | 20–40s |

**Speed optimizations in `wrangler.toml`:**
- `EFFORT=low` and `thinkingBudget=0` on Gemini (no extended thinking)
- Pre-call: 2–3 web searches (not 4+); JSON schema enforced via API (not duplicated in prompt)
- Post-call: last ~6k words of transcript (~30–40 min of speech) sent to the model

Older Gemini models (`2.0-flash`, `2.5-flash`) are **not available on new API keys** — use `3.1-flash-lite` or `3.5-flash`.

To switch post-call to Gemini when GCP access lands:
```toml
LLM_PROVIDER = "gemini"
MODEL = "gemini-3.1-flash-lite"
POSTCALL_MODEL = "gemini-3.1-flash-lite"
POSTCALL_EFFORT = "low"
EFFORT = "low"
```
```bash
wrangler secret put GEMINI_API_KEY
```

---

## Notes

- **Output format:** a tight one-pager — a Research Snapshot table (tech stack carries inline
  confidence) + a Demo Plan (use-case table, close, and a differentiator table that appears only
  for vendors named in the stack), plus a collapsible Sources list. Defined by
  `worker/src/schema.ts` and rendered by `web/app.js`.
- **Latency:** with `gemini-3.1-flash-lite` + `low` effort + capped searches, pre-call is ~**15–45s**;
  post-call ~**8–20s**. The UI shows expected wait times and disables double-submit during generation.
- **Speed vs. determinism (phase 2):** for faster, more consistent attendee/firmographic/stack
  data, wire enrichment connectors (Apollo/ZoomInfo/Clay) + a tech-stack API and run them in
  parallel, then one short synthesis call. Requires authorizing those paid connectors — deferred
  until the web-search path proves insufficient.
- **Grounding:** Freshworks facts come only from `worker/src/kb.ts` (ported from
  `../rfp-automation/knowledge/offerings.md` — keep them in sync). Prospect facts come only from
  web research and are cited in the brief's Sources section; gaps say "unknown" rather than being
  invented.
- **Cost:** `web_search` bills ~$10 / 1,000 searches plus normal tokens — negligible at SE volume.
- **Pre-call input:** company name, prospect email, and optional **additional context** (RH answers).
  Meeting type / AE fields removed from UI — paste that into additional context instead.
- **Post-call** is live in the Post-call tab; Zoom OAuth activates when credentials are configured.
