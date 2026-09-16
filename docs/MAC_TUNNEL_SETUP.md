# Mac + Cloudflare Tunnel Setup — `lion.benjaminsquare.com`

Complete guide for hosting **SE Singha Paathai** on a Mac and sharing it with the team via Cloudflare Tunnel.

| URL | Purpose | Local target |
|-----|---------|--------------|
| **https://lion.benjaminsquare.com** | Web UI (portal) | `http://localhost:8788` |
| **https://api.lion.benjaminsquare.com** | Worker API | `http://localhost:8787` |

**Who does what:**

| Role | Action |
|------|--------|
| **Mac host** (you) | Run this guide once, then keep `start-all.sh` running |
| **Teammates** | Open https://lion.benjaminsquare.com — no install, no API key |

---

## Part 1 — Mac prerequisites

### 1.1 Install Homebrew (if missing)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions to add Homebrew to your `PATH` (Apple Silicon Macs often need the `eval "$(/opt/homebrew/bin/brew shellenv)"` line in `~/.zprofile`).

### 1.2 Install Node.js 18+

```bash
brew install node@20
brew link node@20
node --version   # should print v20.x or v18+
npm --version
```

Alternatively, download the LTS installer from [nodejs.org](https://nodejs.org/).

### 1.3 Install Git

```bash
brew install git
git --version
```

### 1.4 Install cloudflared

```bash
brew install cloudflared
cloudflared --version
```

### 1.5 Install tmux (recommended for the start script)

```bash
brew install tmux
```

---

## Part 2 — Clone repo and API key

### 2.1 Clone the repository

```bash
cd ~
git clone https://github.com/kuttas246/se-singha-paathai.git
cd se-singha-paathai
```

### 2.2 Create `worker/.dev.vars` (never commit)

```bash
cd worker
cp .dev.vars.example .dev.vars
```

Open `worker/.dev.vars` in your editor and set your Gemini key:

```ini
GEMINI_API_KEY = "your-key-from-google-ai-studio"
```

Get a key at [Google AI Studio](https://aistudio.google.com/apikey).

> **Security:** `.dev.vars` is gitignored. Never commit it, paste it in Slack, or add it to a PR.

### 2.3 Install dependencies

```bash
cd ~/se-singha-paathai/worker
npm install

cd ~/se-singha-paathai/web
# web has no package.json — wrangler is invoked via npx
```

---

## Part 3 — Cloudflare Zero Trust tunnel (from scratch)

**Prerequisites:**

- A **Cloudflare account** (free tier works)
- Domain **benjaminsquare.com** added to Cloudflare with DNS managed by Cloudflare

### 3.1 Open Zero Trust

1. Go to [https://one.dash.cloudflare.com/](https://one.dash.cloudflare.com/)
2. Sign in with the Cloudflare account that owns **benjaminsquare.com**
3. If prompted, complete the Zero Trust onboarding (pick a team name — e.g. `benjaminsquare` — free plan is fine)

### 3.2 Create a new tunnel

1. In the left sidebar, click **Networks** → **Tunnels**
2. Click the blue **Create a tunnel** button
3. Select connector type **Cloudflared** → click **Next**
4. **Tunnel name:** `lion-se-paathai` (or any memorable name) → click **Save tunnel**

### 3.3 Copy the tunnel token

On the **Install connector** page you will see a command like:

```bash
cloudflared tunnel run --token eyJhIjoi...
```

1. Click **Copy** next to the token (or copy the full command)
2. Save the token locally — you will need it in Part 7:

```bash
cd ~/se-singha-paathai
mkdir -p scripts/mac
echo 'eyJhIjoi...' > scripts/mac/.tunnel-token
chmod 600 scripts/mac/.tunnel-token
```

> **Security:** `scripts/mac/.tunnel-token` is gitignored. If you ever paste the token in chat, email, or a PR, **rotate it** immediately (see [Security](#security) below).

3. Click **Next** (you do **not** need to run the install command on this page yet — the start script handles it)

### 3.4 Add public hostname — Web UI

You should now be on **Public Hostname** (or click **Public Hostname** tab on your tunnel).

1. Click **Add a public hostname**
2. Fill in:

   | Field | Value |
   |-------|-------|
   | **Subdomain** | `lion` |
   | **Domain** | `benjaminsquare.com` |
   | **Path** | *(leave empty)* |
   | **Type** | `HTTP` |
   | **URL** | `localhost:8788` |

3. Click **Save hostname**

Cloudflare automatically creates the DNS record for `lion.benjaminsquare.com`.

### 3.5 Add public hostname — Worker API

1. Click **Add a public hostname** again
2. Fill in:

   | Field | Value |
   |-------|-------|
   | **Subdomain** | `api.lion` |
   | **Domain** | `benjaminsquare.com` |
   | **Path** | *(leave empty)* |
   | **Type** | `HTTP` |
   | **URL** | `localhost:8787` |

3. Click **Save hostname**

This creates `api.lion.benjaminsquare.com` → `http://localhost:8787`.

### 3.6 Verify tunnel status

1. Stay on **Networks** → **Tunnels** → click your tunnel name
2. Status should show **Healthy** once `cloudflared` is running (Part 6)
3. Under **Public Hostname**, confirm both routes:

   | Public hostname | Service |
   |-----------------|---------|
   | `lion.benjaminsquare.com` | `http://localhost:8788` |
   | `api.lion.benjaminsquare.com` | `http://localhost:8787` |

---

## Part 4 — App config (already in repo)

The repo is pre-configured for the `lion` domain. After `git pull`, verify:

### `web/firebase-config.js`

When the browser loads `lion.benjaminsquare.com`, the worker URL resolves to `https://api.lion.benjaminsquare.com`:

```js
// lion.benjaminsquare.com → https://api.lion.benjaminsquare.com
// localhost:8788        → http://localhost:8787
export const WORKER_BASE_URL = workerBaseUrl();
```

No manual edit needed unless you use a different domain.

### `worker/wrangler.toml`

CORS allows the tunnel web origin:

```toml
ALLOWED_ORIGINS = "http://localhost:8788,http://127.0.0.1:8788,https://lion.benjaminsquare.com"
```

Restart the worker after any change to this file.

---

## Part 5 — Test locally (before tunnel)

Open **three** terminals (or use the start script in Part 7).

**Terminal A — Worker:**

```bash
cd ~/se-singha-paathai/worker
npm run dev
```

Wait for: `Ready on http://localhost:8787`

**Terminal B — Web:**

```bash
cd ~/se-singha-paathai/web
npx wrangler pages dev . --port 8788
```

Wait for: `Ready on http://localhost:8788`

**Terminal C — Smoke test:**

```bash
# Worker API
curl -s http://localhost:8787/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | head -c 200

# Web UI (should return HTML)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788
```

**Browser test:**

1. Open **http://localhost:8788**
2. Log in: `se@freshworks.com` / `se123`
3. Run a quick prep — confirm no CORS errors in DevTools → Network

---

## Part 6 — Test via tunnel

**Terminal D — cloudflared:**

```bash
cloudflared tunnel run --token "$(cat ~/se-singha-paathai/scripts/mac/.tunnel-token)"
```

Or paste the token directly:

```bash
cloudflared tunnel run --token eyJhIjoi...
```

Keep Terminals A, B, and D running.

**Remote tests (from any machine, including your phone off Wi‑Fi):**

```bash
# Web UI
curl -s -o /dev/null -w "%{http_code}\n" https://lion.benjaminsquare.com

# Worker API
curl -s https://api.lion.benjaminsquare.com/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | head -c 200
```

**Browser test:**

1. Open **https://lion.benjaminsquare.com**
2. Log in: `se@freshworks.com` / `se123`
3. Generate a prep brief — confirm the Network tab shows requests to `api.lion.benjaminsquare.com` (not `localhost`)

---

## Part 7 — Run forever (`start-all.sh`)

The repo includes a script that starts worker, web, and cloudflared together.

### 7.1 One-time: save your tunnel token

```bash
cd ~/se-singha-paathai
cp scripts/mac/.tunnel-token.example scripts/mac/.tunnel-token
```

Edit `scripts/mac/.tunnel-token` — paste **only** the token string (no `cloudflared tunnel run --token` prefix).

```bash
chmod 600 scripts/mac/.tunnel-token
```

### 7.2 Make the script executable

```bash
chmod +x scripts/mac/start-all.sh
```

### 7.3 Start everything (tmux — recommended)

```bash
cd ~/se-singha-paathai
./scripts/mac/start-all.sh
```

This opens a **tmux** session `se-paathai` with three panes:

| Pane | Service | Port |
|------|---------|------|
| 0 | Worker | 8787 |
| 1 | Web | 8788 |
| 2 | cloudflared | tunnel |

**tmux cheatsheet:**

| Keys | Action |
|------|--------|
| `Ctrl+b` then `0`/`1`/`2` | Switch pane |
| `Ctrl+b` then `d` | Detach (services keep running) |
| `tmux attach -t se-paathai` | Re-attach |
| `tmux kill-session -t se-paathai` | Stop everything |

### 7.4 Start in background (no tmux)

```bash
./scripts/mac/start-all.sh --background
```

Logs go to `~/se-singha-paathai/logs/`. Stop with:

```bash
./scripts/mac/start-all.sh --stop
```

### 7.5 Keep the Mac awake

Tunnel traffic stops if the Mac sleeps. Either:

- **System Settings** → **Battery** → prevent sleep when plugged in, or
- Run: `caffeinate -dims` in a spare terminal while hosting

---

## Part 8 — Optional: auto-start on boot (launchd)

Create a LaunchAgent so the stack starts when you log in.

### 8.1 Create the plist

```bash
cat > ~/Library/LaunchAgents/com.benjaminsquare.se-paathai.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.benjaminsquare.se-paathai</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $HOME/se-singha-paathai && ./scripts/mac/start-all.sh --background</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$HOME/se-singha-paathai/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/se-singha-paathai/logs/launchd.err.log</string>
</dict>
</plist>
EOF
```

> Adjust `$HOME/se-singha-paathai` if you cloned elsewhere.

### 8.2 Load the agent

```bash
launchctl load ~/Library/LaunchAgents/com.benjaminsquare.se-paathai.plist
```

### 8.3 Unload (disable auto-start)

```bash
launchctl unload ~/Library/LaunchAgents/com.benjaminsquare.se-paathai.plist
```

---

## Part 9 — Team instructions

Share this with SEs and managers — **no setup on their side**.

1. Open **https://lion.benjaminsquare.com** in Chrome or Edge
2. Log in with:

   | Email | Password |
   |-------|----------|
   | `se@freshworks.com` | `se123` |

   Alt SE accounts: `se1@freshworks.com`, `se2@freshworks.com` (same password `se123`)

3. Use the portal normally — prep, post-call analysis, history (stored in browser localStorage)

**Note:** The Mac host must keep `start-all.sh` running and the Mac awake. If the site is down, ping the host before debugging on your end.

---

## Security

| Risk | Mitigation |
|------|------------|
| Tunnel token leaked | Zero Trust → **Networks** → **Tunnels** → your tunnel → **Configure** → **Refresh token**. Update `scripts/mac/.tunnel-token` and restart cloudflared. |
| Gemini API key leaked | Rotate in [Google AI Studio](https://aistudio.google.com/apikey); update `worker/.dev.vars`; restart worker. |
| Anyone on the internet can use the portal | Optional **Cloudflare Access** (below). |
| Local dev exposed | Tunnel points at your laptop — use only for team testing, not indefinite production. |

### Optional — Cloudflare Access (email gate)

Restrict who can open the web URL:

1. Zero Trust → **Access** → **Applications** → **Add an application**
2. **Self-hosted**
3. **Application name:** `SE Singha Paathai`
4. **Session duration:** e.g. 24 hours
5. **Application domain:**
   - **Subdomain:** `lion`
   - **Domain:** `benjaminsquare.com`
6. **Add policy** → **Allow** → **Include** → **Emails ending in** → `@freshworks.com`
7. Save

Repeat for `api.lion.benjaminsquare.com` if you want the API gated too (otherwise the web UI may load but API calls could fail for unauthenticated users — gating both is safest).

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| `502 Bad Gateway` on tunnel URL | Worker or web not running locally | Run `./scripts/mac/start-all.sh`; check `curl http://localhost:8788` and `curl http://localhost:8787` |
| Tunnel shows **Inactive** / **Down** | `cloudflared` not running or bad token | Restart cloudflared; verify `scripts/mac/.tunnel-token`; refresh token in dashboard if needed |
| Browser CORS error | `ALLOWED_ORIGINS` missing tunnel URL | Confirm `https://lion.benjaminsquare.com` in `worker/wrangler.toml`; restart worker |
| API calls go to `localhost:8787` from tunnel | Stale `firebase-config.js` | `git pull`; hard-refresh browser (Cmd+Shift+R) |
| `401` / `403` from API | Wrong email domain | Use `@freshworks.com` login |
| Prep hangs or immediate error | Missing/invalid `GEMINI_API_KEY` | Check `worker/.dev.vars`; restart worker |
| `npm run dev` port in use | Old process still bound | `./scripts/mac/start-all.sh --stop` or `lsof -i :8787` / `lsof -i :8788` and kill |
| DNS resolves but SSL fails | Hostname not saved in tunnel | Re-check Part 3.4–3.5 in Zero Trust dashboard |
| Site works on Mac but not for teammates | Mac asleep or firewall | Keep Mac awake; allow `cloudflared` in firewall |
| tmux session already exists | Previous run still active | `tmux attach -t se-paathai` or `tmux kill-session -t se-paathai` then restart |

---

## Quick reference

| What | Value |
|------|-------|
| Web (team URL) | https://lion.benjaminsquare.com |
| API | https://api.lion.benjaminsquare.com |
| Local web | http://localhost:8788 |
| Local API | http://localhost:8787 |
| Start command | `./scripts/mac/start-all.sh` |
| Tunnel token file | `scripts/mac/.tunnel-token` (gitignored) |
| API key file | `worker/.dev.vars` (gitignored) |
| Team login | `se@freshworks.com` / `se123` |

---

## Related docs

- [TEAM_SETUP.md](../TEAM_SETUP.md) — general local dev and tunnel overview
- [README.md](../README.md) — production deploy path
