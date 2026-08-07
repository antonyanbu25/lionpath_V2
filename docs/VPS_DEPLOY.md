# VPS deployment â€” Netcup (or any Linux VPS)

Host **SE Singha Paathai** on your own server instead of running the worker on a developer laptop or Mac tunnel.

**Stack:** Docker Compose Â· Caddy (HTTPS) Â· nginx (static web) Â· Node worker (port 8787)

**Git remotes:** Production VPS clones **`antonyanbu25/lionpath_V2`** as remote **`origin`**. Developer laptops push to Tony's repo via remote **`antony`** (see README § Push workflow). Upstream **`skut264/lionpath`** is for PRs; its `2.1` branch may lag Tony's repo — do not point the VPS at `skut264/lionpath` for deploy.

| Public URL | Service |
|------------|---------|
| https://portal.benjaminsquare.com | Web UI |
| https://portalapi.benjaminsquare.com | Worker API |

---

## Prerequisites

- A Linux VPS (e.g. Netcup) with root SSH access
- **Node is not required on the VPS** â€” everything runs in Docker
- A **Gemini API key** ([Google AI Studio](https://aistudio.google.com/apikey))
- DNS control for `benjaminsquare.com` (or your domain)

---

## 1. Secure the server first

**If you shared the VPS root password anywhere, change it immediately after first login:**

```bash
passwd
```

Read **[deploy/vps/SECURITY.md](../deploy/vps/SECURITY.md)** â€” SSH keys, `.env` handling, file permissions.

---

## 2. DNS records

Point both hostnames to your VPS public IP (e.g. `89.58.33.163`):

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `portal` | `YOUR_VPS_IP` | **DNS only** (grey cloud) |
| A | `portalapi` | `YOUR_VPS_IP` | **DNS only** (grey cloud) |

**Important:** Both records must be **DNS only** â€” not proxied through Cloudflare (orange cloud). Caddy on the VPS obtains Let's Encrypt certificates directly; proxied records route traffic to Cloudflare IPs and break HTTPS + CORS.

Verify after propagation:

```bash
nslookup portal.benjaminsquare.com
nslookup portalapi.benjaminsquare.com
```

Both should return your VPS IP (e.g. `89.58.33.163`), not Cloudflare proxy IPs (`104.21.x.x`).

Wait for DNS propagation (often 5â€“30 minutes). Caddy will obtain Let's Encrypt certificates on first start.

---

## 3. SSH in and run one-time setup

From your laptop (you type the password â€” nothing is stored in this repo):

```bash
ssh root@YOUR_VPS_IP
```

On the VPS:

```bash
git clone git@github.com:antonyanbu25/lionpath_V2.git /opt/se-singha-paathai
cd /opt/se-singha-paathai/deploy/vps
chmod +x setup.sh start.sh
./setup.sh
```

(`setup.sh` defaults to the same Tony repo URL; remote name on the VPS is **`origin`**, not `antony`.)

The repo is **private** â€” you need a GitHub **deploy key** (read-only) on the VPS before `git clone` / `update.sh` will work. See [Git authentication (private repo)](#git-authentication-private-repo) below.

`setup.sh` installs Docker (if needed), clones/updates the repo, creates `/var/lib/se-paathai/history` (mode 700), and copies `.env.example` â†’ `.env`.

---

## 4. Configure secrets

```bash
nano /opt/se-singha-paathai/deploy/vps/.env
```

Set at minimum:

```
GEMINI_API_KEY=your-real-key-here
```

Save and lock permissions:

```bash
chmod 600 /opt/se-singha-paathai/deploy/vps/.env
```

Never commit `.env` to git.

---

## 5. Start the stack

```bash
cd /opt/se-singha-paathai/deploy/vps
./start.sh
```

Or manually:

```bash
docker compose up -d
```

Check containers:

```bash
docker compose ps
docker compose logs -f worker
```

---

## 5b. Background jobs (Gemini Batch)

Branch **`2.1`** routes background LLM work through the Gemini Batch API (~50% cheaper, up to 24h turnaround). Interactive prep and post-call passes are **not** affected.

Add to `deploy/vps/.env`:

```bash
# Generate once: openssl rand -hex 32
INTERNAL_CRON_SECRET=your-random-secret
GEMINI_API_KEY=your-gemini-api-key   # required for batch even if you use Vertex elsewhere
```

**Cost control (layers 3–4).** After deploy, enable the worker daily token budget and Pass 7 anomaly alerts — see **[docs/COST_CONTROL.md](./COST_CONTROL.md)**. Defaults in `deploy/vps/.env.example` (`DAILY_TOKEN_BUDGET_*`, `SUMMARISE_ANOMALY_*`); disable locally with `DAILY_TOKEN_BUDGET_ENABLED=0`.

**Fix `.env` line endings (CRLF → LF).** If sourcing `.env` prints `$'\r': command not found`, the file was edited on Windows:

```bash
cd /opt/se-singha-paathai/deploy/vps   # adjust if INSTALL_DIR differs
apt-get install -y dos2unix            # once, if missing
dos2unix .env
chmod 600 .env
```

**Expose worker on localhost only** so host cron can reach the API without public DNS (e.g. `lionpathapi.*` may still point at shared hosting / cPanel, not this VPS). Under the `worker` service in `docker-compose.yml`, add:

```yaml
    ports:
      - "127.0.0.1:8787:8787"
```

Then restart: `docker compose up -d worker`.

**Install cron** (uses `deploy/vps/cron-batch.sh` → `http://127.0.0.1:8787`, **not** a public URL):

```bash
cd /opt/se-singha-paathai/deploy/vps
bash install-crontab.sh
```

Schedules installed:

| Subcommand | Schedule | Endpoint |
|------------|----------|----------|
| `poll` | `*/10 * * * *` | `/api/internal/batch/poll` |
| `fallback` | `0 * * * *` | `/api/internal/batch/fallback` |
| `embedding` | `0 2 * * *` | `/api/internal/batch/enqueue?workload=embedding-backfill` |
| `read-models` | `0 3 * * *` | `/api/internal/read-models/nightly-rebuild` |

Logs: `/var/log/se-paathai-cron.log`.

**Smoke test after deploy:**

```bash
cd /opt/se-singha-paathai/deploy/vps
./cron-batch.sh poll
# or manually:
curl -sf -X POST -H "X-Cron-Secret: $(grep '^INTERNAL_CRON_SECRET=' .env | cut -d= -f2- | tr -d '\r')" \
  http://127.0.0.1:8787/api/internal/batch/poll
```

User-facing enqueue (authenticated, no cron secret): `POST /api/batch/summaries/enqueue`, `POST /api/batch/cluster-labels/enqueue`.

Cloud Run equivalent (dormant until migration): **[deploy/cloudrun/cloud-scheduler.example.sh](../deploy/cloudrun/cloud-scheduler.example.sh)** and **[deploy/cloudrun/README.md](../deploy/cloudrun/README.md)**.

---

## 6. Verify

```bash
# API health / config
curl -s https://portalapi.benjaminsquare.com/api/health
curl -s https://portalapi.benjaminsquare.com/api/health/live
curl -s https://portalapi.benjaminsquare.com/api/config | head

# Web UI
curl -s -o /dev/null -w "%{http_code}\n" https://portal.benjaminsquare.com
```

In a browser:

1. Open **https://portal.benjaminsquare.com**
2. Log in with demo credentials (`se@freshworks.com` / `se123`)
3. Run a post-call analysis â€” Network tab should call `portalapi.benjaminsquare.com`
4. Reload and check **History** â€” entries persist via file storage on the VPS

---

## 7. Always-on (systemd, optional)

```bash
cp /opt/se-singha-paathai/deploy/vps/se-paathai.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now se-paathai
```

---

## 8. Updates

```bash
cd /opt/se-singha-paathai/deploy/vps
bash update.sh
```

`update.sh` fetches **`origin/2.1`** from `antonyanbu25/lionpath_V2` via SSH (bypassing HTTPS rewrites), resets the repo, runs **`build-web-bundle.sh`** (`cd web && npm ci && npm run build` → `web/dist/`, gitignored), rebuilds the worker, recreates the web container, and runs `verify-deploy.sh`. Production hostnames load `./dist/boot.js`; without this step the portal boots unbundled modules and misses the esbuild graph.

Manual pull (if you are not using `update.sh`):

```bash
cd /opt/se-singha-paathai
git fetch origin
git checkout 2.1
git pull origin 2.1
```

After pulling domain changes, restart Caddy so it picks up the new `Caddyfile`:

```bash
docker compose restart caddy
```

**Read-model backfill (after releases that change `teamMetrics` / `orgMetrics` / `accountRollup`):** from a machine with Firebase Admin credentials and `FIREBASE_PROJECT_ID` set, run once from the repo:

```bash
cd worker && npm run migrate:account-se-team && npm run backfill:read-models
```

Optional single account: `npm run backfill:read-models -- --account=acct_xxx`.

**Org hierarchy (senior managers / sidebar):** if a senior manager still has an empty sidebar after deploy, ensure `org.seniorLeaderIds` includes their user id. On the VPS (no host `npm` required):

```bash
cd /opt/se-singha-paathai/deploy/vps
bash migrate-org-hierarchy.sh --dry-run   # preview
bash migrate-org-hierarchy.sh             # apply
```

Requires Firebase Admin in `.env` (`FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`). The script only backfills `seniorLeaderIds` when that array is empty; otherwise patch Firestore manually. It also replaces `org.directorId` when it still points at `usr_dummy_*` (needed for org director full sidebar).

**authIndex drift (sidebar still empty after deploy):** if `authIndex/{firebaseUid}.userId` points at `usr_dummy_*` but `org.seniorLeaderIds` or `org.directorId` lists a UUID, reconcile the mapping:

```bash
cd /opt/se-singha-paathai/deploy/vps
bash update.sh   # need 2.1.32+ (1287fbb) for canonical user lookup + pre-nav enrich
bash reconcile-auth-index.sh --email antony.sagayaraj@freshworks.com --dry-run
bash reconcile-auth-index.sh --email antony.sagayaraj@freshworks.com
```

**Org director (Vipin — full sidebar + org scope):** `isActualDirector` and org-wide `getVisibleScope` require `org.directorId ===` Vipin's canonical UUID (not `usr_dummy_vipin_thomas_freshworks_com`). Run reconcile first, then migrate so `directorId` is upgraded:

```bash
cd /opt/se-singha-paathai/deploy/vps
bash update.sh
bash reconcile-auth-index.sh --email vipin.thomas@freshworks.com --dry-run
bash reconcile-auth-index.sh --email vipin.thomas@freshworks.com
bash migrate-org-hierarchy.sh --dry-run   # confirm directorId is UUID, not usr_dummy_*
bash migrate-org-hierarchy.sh
```

After deploy + reconcile + migrate, affected users sign out/in once (no DevTools required).

---

## Git authentication (private repo)

Production VPS repository: **git@github.com:antonyanbu25/lionpath_V2.git** (private; git remote **`origin`** on the server).

### Symptom â€” SSH remote but HTTPS password prompt

```text
origin  git@github.com:antonyanbu25/lionpath_V2.git (fetch)
Username for 'https://github.com': ...
Password for 'https://...@github.com':
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/antonyanbu25/lionpath_V2.git/'
```

**Root cause:** Git is rewriting `git@github.com:` â†’ `https://github.com/` (global `url.*.insteadOf`), so `git fetch origin` uses HTTPS even though `origin` is SSH. GitHub no longer accepts account passwords â€” you need SSH keys or a Personal Access Token.

**Diagnose on VPS:**

```bash
cd /opt/se-singha-paathai/deploy/vps
bash git-auth-diagnose.sh
# or full stack + git:  bash doctor.sh
```

Check for rewrites:

```bash
git config --global --get-regexp '^url\.'
```

If you see `url.https://github.com/.insteadof git@github.com:`, remove it:

```bash
git config --global --unset-all url.https://github.com/.insteadOf
```

### Fix â€” SSH deploy key (recommended)

On the **VPS** (as root):

```bash
ssh-keygen -t ed25519 -C "vps-lionpath-deploy" -f /root/.ssh/lionpath_deploy -N ""
cat /root/.ssh/lionpath_deploy.pub
```

1. Copy the public key output.
2. GitHub â†’ **antonyanbu25/lionpath_V2** â†’ **Settings** â†’ **Deploy keys** â†’ **Add deploy key** (title: `vps-portal`, **read-only**).
3. Configure SSH:

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
cat >> /root/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/lionpath_deploy
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config
```

4. Test:

```bash
ssh -T git@github.com
# Expected: Hi antonyanbu25/lionpath_V2! You've successfully authenticated...
git ls-remote git@github.com:antonyanbu25/lionpath_V2.git refs/heads/2.1
```

5. Deploy:

```bash
git remote set-url origin git@github.com:antonyanbu25/lionpath_V2.git
cd /opt/se-singha-paathai/deploy/vps
bash update.sh
```

`update.sh` uses `git-fetch-origin.sh`, which fetches **directly** via `git@github.com:antonyanbu25/lionpath_V2.git` so `insteadOf` rewrites on `origin` no longer matter.

### Alternative â€” HTTPS + Personal Access Token

Only if you prefer HTTPS:

```bash
git remote set-url origin https://github.com/antonyanbu25/lionpath_V2.git
git fetch origin 2.1
# Username: GitHub account with repo access
# Password: <GitHub PAT with repo scope â€” NOT your account password>
```

---

## Architecture

```
Internet
   â”‚
   â–¼
Caddy :443 â”€â”€â”¬â”€â”€ portal.benjaminsquare.com â”€â”€â–º nginx :8788 (static web/)
             â””â”€â”€ portalapi.benjaminsquare.com â”€â”€â–º worker :8787 (Node + Gemini)
                                                        â”‚
                                                        â–¼
                                              /var/lib/se-paathai/history/
                                              (JSON per SE email, mode 600)
```

**History without Cloudflare KV:** the worker uses file-based storage when `HISTORY_FILE_DIR=/data/history` (mapped to `/var/lib/se-paathai/history` on the host).

---

## Firewall

`setup.sh` configures **ufw** to allow SSH, 80, and 443. Confirm:

```bash
ufw status
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Certificate error on first start | DNS not propagated â€” wait and `docker compose restart caddy` |
| `nslookup` shows Cloudflare IPs for API | Set `portalapi` A record to **DNS only** (grey cloud), not proxied |
| `Failed to fetch` in browser | Worker down â€” `docker compose logs worker` |
| CORS error | `ALLOWED_ORIGINS` in `.env` must include `https://portal.benjaminsquare.com` |
| **"Cannot reach the API server at portalapiâ€¦"** banner after domain migration | API is up but CORS is wrong â€” see [Domain migration](#domain-migration-lionpath--portal) below |
| History empty after reload | Check `HISTORY_FILE_DIR` and volume mount; `ls -la /var/lib/se-paathai/history` |
| 502 from Caddy | `docker compose ps` â€” ensure worker and web are healthy |
| **`git fetch` asks for HTTPS password** (SSH remote) | Global `insteadOf` rewrite â€” see [Git authentication](#git-authentication-private-repo); run `bash git-auth-diagnose.sh` |
| **`Invalid username or token`** on fetch | Set up SSH deploy key or GitHub PAT â€” passwords are not supported |

---

## Domain migration (lionpath â†’ portal)

After renaming `lionpath.benjaminsquare.com` / `lionpathapi.*` to `portal.*` / `portalapi.*`:

1. **DNS** â€” A records for `portal` and `portalapi` â†’ VPS IP, **DNS only** (grey cloud).
2. **Caddyfile** â€” must list `portal.benjaminsquare.com` and `portalapi.benjaminsquare.com` (see `deploy/vps/Caddyfile`).
3. **`.env` on the VPS** â€” `setup.sh` does **not** overwrite an existing `.env`. Update CORS manually:

```bash
cd /opt/se-singha-paathai/deploy/vps
grep ALLOWED_ORIGINS .env
# Must be: ALLOWED_ORIGINS=https://portal.benjaminsquare.com
nano .env   # fix if it still says lionpath.benjaminsquare.com
docker compose up -d --force-recreate worker
```

Verify CORS from your laptop (should echo `portal`, not `lionpath`):

```bash
curl -sI -H "Origin: https://portal.benjaminsquare.com" \
  https://portalapi.benjaminsquare.com/api/config | grep -i access-control-allow-origin
```

Expected: `access-control-allow-origin: https://portal.benjaminsquare.com`

`curl` alone can return HTTP 200 even when browsers fail â€” always check the `Access-Control-Allow-Origin` header matches the web origin.

---

## Alternative: Cloudflare deploy

For serverless hosting without a VPS, see [README.md](../README.md#4-deploy) and [TEAM_SETUP.md](../TEAM_SETUP.md).

---

*Files live in `deploy/vps/` â€” `docker-compose.yml`, `Caddyfile`, `setup.sh`, `start.sh`, `.env.example`, `SECURITY.md`.*
