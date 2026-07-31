# Security — VPS deployment

## Immediate action required

If your **VPS root password was shared in chat, email, or Slack**, change it **now**:

```bash
passwd
```

Then prefer **SSH key authentication** and disable password login when keys work:

```bash
# On your laptop — generate a key if you don't have one
ssh-keygen -t ed25519 -C "se-paathai-admin"

# Copy public key to VPS (run from laptop, replace USER and HOST)
ssh-copy-id root@YOUR_VPS_IP

# On VPS — after confirming key login works:
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd
```

## GitHub deploy key (VPS → private repo)

The production repo is **private** (`skut264/lionpath`). The VPS needs its own **read-only deploy key** to run `update.sh`.

```bash
# On VPS
ssh-keygen -t ed25519 -C "vps-lionpath-deploy" -f /root/.ssh/lionpath_deploy -N ""
cat /root/.ssh/lionpath_deploy.pub   # add to GitHub → repo → Deploy keys
```

See **docs/VPS_DEPLOY.md** § Git authentication for full steps and the `insteadOf` HTTPS rewrite fix.

## Secrets — never in git

| Secret | Where it lives | Never commit |
|--------|----------------|--------------|
| `GEMINI_API_KEY` | `deploy/vps/.env` on VPS only | Yes |
| VPS root password | Your password manager only | Yes |
| SSH private keys | `~/.ssh/` on your machine | Yes |
| Firebase service keys | `.env` if used later | Yes |

- `deploy/vps/.env` is **gitignored**
- File permissions: `chmod 600 deploy/vps/.env`
- Copy from `.env.example` — the example has **placeholder values only**

## Data at rest

| Data | Location | Permissions |
|------|----------|-------------|
| Post-call history (per SE email) | Docker volume `se-paathai-history` → `/data/history` in worker | JSON files mode **600**, directory **700** |
| TLS certificates | Caddy volume `caddy-data` | Managed by Caddy |
| API keys | `.env` injected into worker container | Not written to disk inside repo |

History files are named from hashed keys (e.g. `history_se_freshworks_com.json`). They contain analysis metadata — treat as **internal confidential** data.

## Network

- Only **80** and **443** are exposed publicly (Caddy)
- Worker (**8787**) and web (**8788**) are on an internal Docker network
- Use **HTTPS only** in production (`https://lion.benjaminsquare.com`)

## Optional hardening

1. **HTTP basic auth** — uncomment the block in `Caddyfile` and set a hashed password (`caddy hash-password`)
2. **Firewall** — `setup.sh` enables ufw for SSH + 80 + 443 only
3. **Fail2ban** — recommended for SSH brute-force protection
4. **Firebase Auth** — set `FIREBASE_PROJECT_ID` in `.env` to replace demo credentials for production
5. **Rotate API keys** if they were ever pasted in chat

## What is NOT stored server-side

- Zoom recording files (fetched in memory, not persisted)
- Raw transcripts after analysis (unless saved in history JSON by the client flow)

## Reporting issues

If a secret was committed to git by mistake: rotate the key immediately, remove from history (`git filter-repo` or GitHub secret scanning), and force-no-push of old commits with secrets.
