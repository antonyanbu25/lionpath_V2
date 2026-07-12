# SE Prep Portal

Internal portal that turns a **company name + prospect email** into a researched, pre-filled
pre-demo prep brief (Freshworks CX / Solution Engineering). An SE fills two fields; a Cloudflare
Worker calls Claude with the built-in web-search tool, grounds the demo plan and competitor
positioning in the Freshworks knowledge base, and returns a structured brief that renders into
the standard "SE Pre-Demo Prep" sections.

```
web/ (Cloudflare Pages)  ──►  worker/ (Cloudflare Worker)  ──►  Claude (web_search)
        │                              │
   Firebase Auth (Google)        ANTHROPIC_API_KEY (secret)
   Firestore (prep history)
```

**Why the split:** Firebase's free (Spark) plan blocks outbound network calls from Cloud
Functions, so the Claude call runs on the Cloudflare Worker (free tier allows `fetch`), which
also keeps the API key off the client. Firebase is used only for Auth + Firestore.

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
npx wrangler secret put ANTHROPIC_API_KEY   # paste your key when prompted
# for local dev, wrangler reads .dev.vars — create it (gitignored):
echo 'ANTHROPIC_API_KEY = "sk-ant-..."' > .dev.vars
npm run dev                                  # serves http://localhost:8787
```

Smoke test:

```bash
curl -s http://localhost:8787/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | jq .prep.companySnapshot
```

Config lives in `worker/wrangler.toml` (`[vars]`):
- `LLM_PROVIDER` — `anthropic` (default). See "Changing model or provider" below.
- `MODEL` — `claude-sonnet-5` (default: fast + strong) or `claude-opus-4-8` for max quality.
- `EFFORT` — `low | medium | high | xhigh | max`. Default `medium` (balances speed and the
  reasoning-heavy synthesis). Bump to `high` if briefs read generic; drop to `low` for max speed.
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

Edit `web/firebase-config.js`:
- Leave `firebaseConfig.projectId` empty → no-auth preview (form works, no sign-in/history).
- Set `WORKER_URL` to your Worker URL (`http://localhost:8787/api/generate-prep` locally).

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

```bash
# Worker
cd worker && npx wrangler deploy

# Web → Cloudflare Pages (connect the repo in the dashboard, or:)
cd web && npx wrangler pages deploy .
```

After deploy, set `WORKER_URL` in `web/firebase-config.js` to the production Worker URL and add
the Pages origin to the Worker's `ALLOWED_ORIGINS`.

---

## Notes

- **Output format:** a tight one-pager — a Research Snapshot table (tech stack carries inline
  confidence) + a Demo Plan (use-case table, close, and a differentiator table that appears only
  for vendors named in the stack), plus a collapsible Sources list. Defined by
  `worker/src/schema.ts` and rendered by `web/app.js`.
- **Latency:** with Sonnet 5 + `medium` effort + capped searches, generation is ~20–40s; the UI
  shows a "researching…" state. If it ever exceeds limits, switch the Worker→browser leg to
  streaming (SSE).
- **Speed vs. determinism (phase 2):** for faster, more consistent attendee/firmographic/stack
  data, wire enrichment connectors (Apollo/ZoomInfo/Clay) + a tech-stack API and run them in
  parallel, then one short synthesis call. Requires authorizing those paid connectors — deferred
  until the web-search path proves insufficient.
- **Grounding:** Freshworks facts come only from `worker/src/kb.ts` (ported from
  `../rfp-automation/knowledge/offerings.md` — keep them in sync). Prospect facts come only from
  web research and are cited in the brief's Sources section; gaps say "unknown" rather than being
  invented.
- **Cost:** `web_search` bills ~$10 / 1,000 searches plus normal tokens — negligible at SE volume.
- Scope is **pre-call** prep only; post-call automation is a later phase.
