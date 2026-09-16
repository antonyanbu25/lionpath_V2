# Emergency: post-call UI still old on portal

Live portal check (from your PC):

```powershell
curl.exe -sf "https://portal.benjaminsquare.com/" | findstr /i "portal-build pc-company-name postcall-intake pc-account-deal-preview postcall.css"
```

**Old (broken):** `2.0.7.4`, `pc-company-name`, no `postcall-intake-card`  
**Fixed (2.1):** `portal-build=2.1.x`, `postcall-intake-card`, `pc-account-deal-preview`, `postcall.css?v=` matches `portal-build`, no `pc-company-name`

## Option A — Git upgrade on VPS (recommended)

SSH in, then:

```bash
cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh
```

If `upgrade-now.sh` is not on the VPS yet (still on 2.0.7.4), bootstrap manually:

```bash
cd /opt/se-singha-paathai
bash deploy/vps/git-fetch-origin.sh . 2.0.8.1-merge
git checkout -B 2.0.8.1-merge origin/2.0.8.1-merge
git reset --hard origin/2.0.8.1-merge
cd deploy/vps && bash update.sh
```

Verify:

```bash
bash verify-deploy.sh
```

## Option B — SCP web files from your PC (if git fetch fails)

Replace `VPS_USER` and `VPS_HOST` with your SSH login.

```powershell
scp -r "C:\Users\ArumburDevaSathishku\Downloads\se-singha-paathai\web\*" VPS_USER@VPS_HOST:/opt/se-singha-paathai/web/
ssh VPS_USER@VPS_HOST "cd /opt/se-singha-paathai/deploy/vps && docker compose up -d --force-recreate web && docker compose build --no-cache worker && docker compose up -d"
```

Then verify with the curl command above.

## Git auth failures

```bash
cd /opt/se-singha-paathai/deploy/vps && bash git-auth-diagnose.sh
```

Ensure origin is `git@github.com:antonyanbu25/lionpath_V2.git` with a deploy key.
