# VPS deployment — Netcup (or any Linux VPS)

Host **SE Singha Paathai** on your own server instead of running the worker on a developer laptop or Mac tunnel.

**Stack:** Docker Compose · Caddy (HTTPS) · nginx (static web) · Node worker (port 8787)

| Public URL | Service |
|------------|---------|
| https://portal.benjaminsquare.com | Web UI |
| https://portalapi.benjaminsquare.com | Worker API |

---

## Prerequisites

- A Linux VPS (e.g. Netcup) with root SSH access
- **Node is not required on the VPS** — everything runs in Docker
- A **Gemini API key** ([Google AI Studio](https://aistudio.google.com/apikey))
- DNS control for `benjaminsquare.com` (or your domain)

---

## 1. Secure the server first

**If you shared the VPS root password anywhere, change it immediately after first login:**

```bash
passwd
```

Read **[deploy/vps/SECURITY.md](../deploy/vps/SECURITY.md)** — SSH keys, `.env` handling, file permissions.

---

## 2. DNS records

Point both hostnames to your VPS public IP (e.g. `89.58.33.163`):

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `portal` | `YOUR_VPS_IP` | **DNS only** (grey cloud) |
| A | `portalapi` | `YOUR_VPS_IP` | **DNS only** (grey cloud) |

**Important:** Both records must be **DNS only** — not proxied through Cloudflare (orange cloud). Caddy on the VPS obtains Let's Encrypt certificates directly; proxied records route traffic to Cloudflare IPs and break HTTPS + CORS.

Verify after propagation:

```bash
nslookup portal.benjaminsquare.com
nslookup portalapi.benjaminsquare.com
```

Both should return your VPS IP (e.g. `89.58.33.163`), not Cloudflare proxy IPs (`104.21.x.x`).

Wait for DNS propagation (often 5–30 minutes). Caddy will obtain Let's Encrypt certificates on first start.

---

## 3. SSH in and run one-time setup

From your laptop (you type the password — nothing is stored in this repo):

```bash
ssh root@YOUR_VPS_IP
```

On the VPS:

```bash
git clone https://github.com/kuttas246/se-singha-paathai.git /opt/se-singha-paathai
cd /opt/se-singha-paathai/deploy/vps
chmod +x setup.sh start.sh
./setup.sh
```

`setup.sh` installs Docker (if needed), clones/updates the repo, creates `/var/lib/se-paathai/history` (mode 700), and copies `.env.example` → `.env`.

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

## 6. Verify

```bash
# API health / config
curl -s https://portalapi.benjaminsquare.com/api/config | head

# Web UI
curl -s -o /dev/null -w "%{http_code}\n" https://portal.benjaminsquare.com
```

In a browser:

1. Open **https://portal.benjaminsquare.com**
2. Log in with demo credentials (`se@freshworks.com` / `se123`)
3. Run a post-call analysis — Network tab should call `portalapi.benjaminsquare.com`
4. Reload and check **History** — entries persist via file storage on the VPS

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
cd /opt/se-singha-paathai
git pull
cd deploy/vps
./start.sh
```

After pulling domain changes, restart Caddy so it picks up the new `Caddyfile`:

```bash
docker compose restart caddy
```

---

## Architecture

```
Internet
   │
   ▼
Caddy :443 ──┬── portal.benjaminsquare.com ──► nginx :8788 (static web/)
             └── portalapi.benjaminsquare.com ──► worker :8787 (Node + Gemini)
                                                        │
                                                        ▼
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
| Certificate error on first start | DNS not propagated — wait and `docker compose restart caddy` |
| `nslookup` shows Cloudflare IPs for API | Set `portalapi` A record to **DNS only** (grey cloud), not proxied |
| `Failed to fetch` in browser | Worker down — `docker compose logs worker` |
| CORS error | `ALLOWED_ORIGINS` in `.env` must include `https://portal.benjaminsquare.com` |
| **"Cannot reach the API server at portalapi…"** banner after domain migration | API is up but CORS is wrong — see [Domain migration](#domain-migration-lionpath--portal) below |
| History empty after reload | Check `HISTORY_FILE_DIR` and volume mount; `ls -la /var/lib/se-paathai/history` |
| 502 from Caddy | `docker compose ps` — ensure worker and web are healthy |

---

## Domain migration (lionpath → portal)

After renaming `lionpath.benjaminsquare.com` / `lionpathapi.*` to `portal.*` / `portalapi.*`:

1. **DNS** — A records for `portal` and `portalapi` → VPS IP, **DNS only** (grey cloud).
2. **Caddyfile** — must list `portal.benjaminsquare.com` and `portalapi.benjaminsquare.com` (see `deploy/vps/Caddyfile`).
3. **`.env` on the VPS** — `setup.sh` does **not** overwrite an existing `.env`. Update CORS manually:

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

`curl` alone can return HTTP 200 even when browsers fail — always check the `Access-Control-Allow-Origin` header matches the web origin.

---

## Alternative: Cloudflare deploy

For serverless hosting without a VPS, see [README.md](../README.md#4-deploy) and [TEAM_SETUP.md](../TEAM_SETUP.md).

---

*Files live in `deploy/vps/` — `docker-compose.yml`, `Caddyfile`, `setup.sh`, `start.sh`, `.env.example`, `SECURITY.md`.*
