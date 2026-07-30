# Team Setup Guide — SE Singha Paathai

This guide is for **developers and internal testers** who need to run or share the portal before (or alongside) a full production deploy.

| Audience | What to read |
|----------|--------------|
| Developer on their laptop | **Part A** |
| Share the app with teammates without everyone running `npm run dev` | **Part B** |
| Ship to all 680 SEs | **Part C** (production deploy) |

Replace every `yourdomain.com` placeholder below with your real Cloudflare-managed domain (examples use `se-paathai.yourdomain.com` and `api-se-paathai.yourdomain.com`).

---

## Part A — Local development (your laptop)

**ELI5:** You run two small servers on your machine — one serves the website, one serves the AI API. Your browser talks to the website; the website talks to the API behind the scenes.

### Prerequisites

- **Node.js 18+** — install the LTS build from [nodejs.org](https://nodejs.org/)
- **Git** — to clone the repo
- **A Gemini API key** — see [Shared GEMINI_API_KEY](#shared-gemini_api_key) below

### Step 1 — Clone the repo

```bash
git clone https://github.com/kuttas246/se-singha-paathai.git
cd se-singha-paathai
```

### Step 2 — Add your API key (never commit this file)

```bash
cd worker
cp .dev.vars.example .dev.vars
```

Open `worker/.dev.vars` and set your key:

```ini
GEMINI_API_KEY = "your-key-from-google-ai-studio"
```

Get a key at [Google AI Studio](https://aistudio.google.com/apikey).

> **Important:** `.dev.vars` is gitignored. Never commit it, paste it in Slack, or add it to a PR.

### Step 3 — Open two terminals

You need **both** servers running at the same time.

| Terminal | Folder | Commands | URL |
|----------|--------|----------|-----|
| **A — Worker (API)** | `worker/` | `npm install` then `npm run dev` | http://localhost:8787 |
| **B — Web (UI)** | `web/` | `npx wrangler pages dev .` | http://localhost:8788 |

**8788 vs 8787:** Open **8788** in your browser (the app). **8787** is the worker API; the web UI calls it automatically. You do not browse to 8787 directly.

### Step 4 — Open the app and log in

1. Go to **http://localhost:8788** in Chrome or Edge.
For real Google SSO (production), follow **[docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md)**. Dummy credentials below remain for local dev without Firebase.

### Dummy credentials (local / no Firebase)

| Role | Email | Password |
|------|-------|----------|
| SE | `se@freshworks.com` | `se123` |
| SE (alt) | `se1@freshworks.com` or `se2@freshworks.com` | `se123` |
| Manager | `manager@freshworks.com` | `mgr123` |

When `firebaseConfig.projectId` is empty in `web/firebase-config.js`, the portal uses these dummy logins and stores history in **localStorage** on your machine.

### Local config (already set for you)

For local dev, `web/firebase-config.js` points the worker at the same hostname on port **8787**:

```js
// Default behavior — works for localhost:8788 → localhost:8787
export const WORKER_BASE_URL = workerBaseUrl();
```

`worker/wrangler.toml` already allows local origins:

```toml
ALLOWED_ORIGINS = "http://localhost:8788,http://127.0.0.1:8788"
```

No edits needed for a standard laptop setup.

### Quick smoke tests

**Worker (Terminal A):**

```bash
curl -s http://localhost:8787/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | jq .prep.companySnapshot
```

**Web dashboard script (any terminal):**

```bash
node web/scripts/test-dashboard.mjs
```

### Troubleshooting (local)

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| Browser shows "Failed to fetch" or CORS error | Worker not running, or wrong origin | Start Terminal A (`npm run dev` in `worker/`). Use **localhost** consistently (not mixing `127.0.0.1` and `localhost`). |
| `401` / `403` from API | Email domain restriction | Sign in with `@freshworks.com` dummy email, or check `ALLOWED_EMAIL_DOMAIN` in `wrangler.toml`. |
| Prep/analysis hangs or errors immediately | Missing or invalid API key | Check `worker/.dev.vars` has a valid `GEMINI_API_KEY`. Restart the worker after editing. |
| Port already in use | Another process on 8787/8788 | Stop the other process, or change the port in the wrangler dev command. |
| Login page does nothing | Opened wrong URL | Use **http://localhost:8788**, not 8787. |
| Changes to config not picked up | Dev server cached | Stop both terminals (Ctrl+C) and restart. |

---

## Part B — Share via Cloudflare Tunnel

**ELI5:** Instead of every teammate installing Node and an API key, **one person** runs the app (or points at production) and Cloudflare gives the team a normal HTTPS URL like `https://se-paathai.yourdomain.com`.

> **Mac host for `lion.benjaminsquare.com`:** See **[docs/MAC_TUNNEL_SETUP.md](./docs/MAC_TUNNEL_SETUP.md)** for the full copy-paste guide (prerequisites, Zero Trust tunnel, `start-all.sh`, launchd, team login).

### Prerequisites

- A **Cloudflare account** with **Zero Trust** (free tier is enough for tunnels)
- A **domain on Cloudflare** (DNS managed by Cloudflare)
- **cloudflared** installed on the machine that will host the tunnel — [Install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- For Option 1 only: Node.js + `worker/.dev.vars` on the developer's machine

### Which option should we use?

| Option | Best for | Pros | Cons |
|--------|----------|------|------|
| **Option 1 — Tunnel to local dev** | Quick demos, testing a branch, 2–5 testers | Fast to set up; no deploy needed | Exposes **your laptop**; must stay online; API key on your machine |
| **Option 2 — Production deploy + custom domain** ✅ **Recommended for the team** | Ongoing internal rollout, many SEs | Stable URL; no local setup for users; secrets stay in Cloudflare | One-time deploy + DNS setup |

**Recommendation:** Use **Option 2** for anything beyond a short demo. Deploy the worker to `workers.dev` (or a custom subdomain) and the web app to Cloudflare Pages, then optionally put a Cloudflare Tunnel or DNS CNAME in front for a branded hostname. Use **Option 1** only for same-day testing while a feature is still on a dev branch.

---

### Option 1 — Tunnel to local dev (developer shares their running app)

Use this when a developer wants teammates to try **uncommitted or branch work** without deploying.

#### 1. Start local servers (same as Part A)

Terminal A:

```bash
cd worker && npm install && npm run dev
```

Terminal B:

```bash
cd web && npx wrangler pages dev .
```

#### 2. Create a tunnel in Cloudflare Zero Trust

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels**.
2. Click **Create a tunnel** → choose **Cloudflared**.
3. Name it (e.g. `se-paathai-dev`).
4. Copy the **tunnel token** or note the **tunnel UUID** for the install step.

#### 3. Install and authenticate cloudflared

**Windows (PowerShell):**

```powershell
winget install --id Cloudflare.cloudflared
```

**macOS:**

```bash
brew install cloudflared
```

**Linux:**

```bash
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

Run the install command shown in the Zero Trust dashboard (it embeds your tunnel token), e.g.:

```bash
cloudflared tunnel run --token <YOUR_TUNNEL_TOKEN>
```

#### 4. Configure public hostnames

In the tunnel's **Public Hostname** tab (or via a config file), add **two** routes:

| Public hostname | Service | Local target |
|-----------------|---------|--------------|
| `se-paathai.yourdomain.com` | HTTP | `http://localhost:8788` |
| `api-se-paathai.yourdomain.com` | HTTP | `http://localhost:8787` |

Cloudflare creates the DNS records automatically when the hostname is saved.

**Alternative — single hostname with path routing** (advanced): You can route `/api/*` to 8787 and everything else to 8788 on one hostname, but the app today expects the API on a separate origin. The **two-subdomain** setup above is simpler and matches CORS config.

#### 5. Example `config.yml` (if using a file instead of the dashboard)

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /path/to/<TUNNEL_UUID>.json

ingress:
  - hostname: se-paathai.yourdomain.com
    service: http://localhost:8788
  - hostname: api-se-paathai.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

Run with:

```bash
cloudflared tunnel --config config.yml run
```

#### 6. Update app config for tunnel URLs

**`web/firebase-config.js`** — point the browser at the tunnel API host (not localhost):

```js
// Replace dynamic localhost logic while sharing via tunnel:
export const WORKER_BASE_URL = "https://api-se-paathai.yourdomain.com";
export const WORKER_URL = `${WORKER_BASE_URL}/api/generate-prep`;
```

Revert to `workerBaseUrl()` when you go back to pure local dev.

**`worker/wrangler.toml`** — allow the tunnel web origin for CORS:

```toml
ALLOWED_ORIGINS = "http://localhost:8788,http://127.0.0.1:8788,https://se-paathai.yourdomain.com"
```

Restart the worker after editing `wrangler.toml`.

#### 7. Share the link

Teammates open **https://se-paathai.yourdomain.com** — no Node, no API key, no `npm run dev` on their machines.

**Keep your laptop awake** and all three processes running: worker, web, and `cloudflared`.

---

### Option 2 — Production deploy + custom domain (recommended)

For a **stable team URL**, deploy once to Cloudflare and point DNS at it. Teammates only need the link.

High-level steps (details in [README.md](./README.md#4-deploy)):

1. **Deploy the worker**

   ```bash
   cd worker
   npx wrangler secret put GEMINI_API_KEY   # production secret — not .dev.vars
   npx wrangler deploy
   ```

   Note the worker URL (e.g. `https://prep-portal.<account>.workers.dev`).

2. **Deploy the web app to Cloudflare Pages**

   ```bash
   cd web
   npx wrangler pages deploy .
   ```

   Or connect the GitHub repo in the Cloudflare dashboard for automatic deploys.

3. **Update production config**

   - `web/firebase-config.js` → set `WORKER_BASE_URL` to your production worker URL (or `https://api-se-paathai.yourdomain.com` if you CNAME it).
   - `worker/wrangler.toml` → add your Pages URL and tunnel/custom domain to `ALLOWED_ORIGINS`:

     ```toml
     ALLOWED_ORIGINS = "https://se-paathai.yourdomain.com,https://<your-pages>.pages.dev"
     ```

   Redeploy worker and Pages after changes.

4. **Optional — branded hostnames via tunnel or DNS**

   - **DNS CNAME (simplest):** Point `se-paathai.yourdomain.com` → Pages custom domain; point `api-se-paathai.yourdomain.com` → worker custom domain or `workers.dev` URL.
   - **Cloudflare Tunnel as reverse proxy:** Create a tunnel with ingress to your **already-deployed** Pages and Worker URLs instead of localhost — useful if you want Zero Trust Access in front of production.

   Example tunnel ingress to production:

   ```yaml
   ingress:
     - hostname: se-paathai.yourdomain.com
       service: https://<your-pages>.pages.dev
     - hostname: api-se-paathai.yourdomain.com
       service: https://prep-portal.<account>.workers.dev
     - service: http_status:404
   ```

Teammates use **https://se-paathai.yourdomain.com** permanently — no local setup.

---

### Security notes (tunnels)

- **Option 1 exposes your local dev environment** to anyone with the URL. Use only for short-lived team testing.
- **Do not commit** `.dev.vars`, tunnel tokens, or `credentials-file` JSON.
- **Optional — Cloudflare Access:** In Zero Trust → **Access** → **Applications**, protect `se-paathai.yourdomain.com` with an email-domain policy (e.g. `@freshworks.com`) so random internet users cannot hit your tunnel.
- Rotate the Gemini API key if it was ever shared in plain text.
- For production, prefer **wrangler secrets** (`wrangler secret put GEMINI_API_KEY`) over `.dev.vars`.

---

## Part C — Full production deploy

For the full 680-SE rollout (Workers + Pages + optional Firebase auth), follow **[README.md](./README.md)**:

- [Prerequisites](./README.md#prerequisites)
- [Worker deploy](./README.md#1-worker--local-dev) and `wrangler deploy`
- [Web / Pages deploy](./README.md#2-web--local-dev)
- [Firebase Google SSO](./docs/FIREBASE_SETUP.md) (optional — enables real login + Firestore)
- [Deploy section](./README.md#4-deploy)

Production SEs only need the Pages URL in a browser — no tunnels, no local dev, no API keys on their machines.

---

## Shared GEMINI_API_KEY

Every machine that runs `npm run dev` in `worker/` needs a Gemini key in `worker/.dev.vars`.

**For a small dev team (recommended):**

1. One person creates a key in [Google AI Studio](https://aistudio.google.com/apikey) (Google Cloud project with Gemini API enabled).
2. Share the key through your company's **secret manager** (1Password, Vault, etc.) — **not** email, Slack, or git.
3. Each developer copies it into their own local `worker/.dev.vars`:

   ```ini
   GEMINI_API_KEY = "AIza..."
   ```

**For production:** use `npx wrangler secret put GEMINI_API_KEY` — never put production keys in `.dev.vars` on a shared server.

**Quota tip:** Gemini free tier has rate limits. If many developers hit the same key simultaneously, consider separate keys per developer or a shared GCP project with billing alerts.

---

## Quick reference

| What | Local dev | Tunnel (Option 1) | Production (Option 2) |
|------|-----------|-------------------|------------------------|
| Web URL | http://localhost:8788 | https://se-paathai.yourdomain.com | https://se-paathai.yourdomain.com |
| API URL | http://localhost:8787 | https://api-se-paathai.yourdomain.com | Worker URL or api subdomain |
| API key location | `worker/.dev.vars` | Developer's `.dev.vars` | `wrangler secret` |
| Who runs servers | Each developer | One developer's laptop | Cloudflare (always on) |
| Teammate setup | Clone + 2 terminals | Browser only | Browser only |

---

## Need help?

1. Check [Troubleshooting (local)](#troubleshooting-local) above.
2. Confirm `ALLOWED_ORIGINS` includes your exact browser origin (scheme + host, no trailing slash).
3. Confirm `WORKER_BASE_URL` in `web/firebase-config.js` matches how teammates reach the API.
4. Ask in your team channel with: OS, terminal output from worker/web, and the browser Network tab error for the failing request.
