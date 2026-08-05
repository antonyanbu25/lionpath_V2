# Cloud Run deploy — SE Singha Paathai (everything on GCP)

| Service | Cloud Run name | Public domain |
|---------|----------------|---------------|
| API (Node worker) | **prep-portal-api** | `portalapi.benjaminsquare.com` |
| Web (nginx static) | **prep-portal-web** | `portal.benjaminsquare.com` |

**Project:** `se-singha-paathi` · **Region:** `us-central1`

**Firestore location:** Firebase default for this project is **`us-central1`** (same multi-region bucket as Cloud Run and Vertex). Chennai-based SEs incur cross-region latency (~150–200 ms RTT) — Firestore location is **permanent** after project creation; only a new project + migration would colocate in `asia-south1`.

### Cloud Run sizing (API)

| Flag | Value | Rationale |
|------|-------|-----------|
| `--min-instances` | **1** | Avoid cold-start on first SE login |
| `--concurrency` | **15** | Pairs with `FFMPEG_MAX_CONCURRENT=2` — limits in-flight ffmpeg while accepting parallel LLM passes |
| `--timeout` | **300s** | Covers Phase 4 Gemini budgets (90s synthesize + retries) + ffmpeg queue wait (120s) |
| `FFMPEG_MAX_CONCURRENT` | **2** | Process-wide ffmpeg slot limit (`worker/src/video/ffmpeg-semaphore.ts`) |

**Health probes:** liveness `GET /api/health/live` · readiness `GET /api/health` (or `/api/health/ready`)

---

## Deploy without project Owner

If Tony (project Owner) cannot grant Cloud Build `run.admin`, use this split: **Cloud Build builds and pushes images**; **you deploy with your own `gcloud` login** (Editor often includes Cloud Run Admin).

From **repo root**, after `web/firebase-config.local.js` exists (see §1 below):

```bash
gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project se-singha-paathi
```

```powershell
powershell -ExecutionPolicy Bypass -File deploy/cloudrun/first-deploy.ps1
```

`first-deploy.ps1` rolls out `prep-portal-api` and `prep-portal-web` from the images Cloud Build pushed. Re-run it after later builds to pick up new `:latest` tags.

**If the build fails on push:** the Cloud Build service account needs **Artifact Registry Writer** on project `se-singha-paathi`. If you have **Editor**, try [IAM → Grant access](https://console.cloud.google.com/iam-admin/iam?project=se-singha-paathi) → principal `{PROJECT_NUMBER}@cloudbuild.gserviceaccount.com` → role **Artifact Registry Writer**. Owner-only bindings still require Tony.

---

## Fast path (boss checklist — ~15 min)

Run these in order from a machine with `gcloud` and repo cloned.

### 0. One-time GCP setup

```bash
gcloud auth login
gcloud config set project se-singha-paathi

gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com aiplatform.googleapis.com

gcloud artifacts repositories create prep-portal \
  --repository-format=docker --location=us-central1 \
  --description="Prep portal API + web" 2>/dev/null || true

gsutil mb -l us-central1 gs://se-singha-paathi-prep-history 2>/dev/null || true
```

Grant Cloud Run access to GCS history bucket (replace `PROJECT_NUMBER`):

```bash
PROJECT_NUMBER=$(gcloud projects describe se-singha-paathi --format='value(projectNumber)')

gsutil iam ch \
  serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com:objectAdmin \
  gs://se-singha-paathi-prep-history

# Vertex AI — Cloud Run service account needs aiplatform.user (no API key secret).
gcloud projects add-iam-policy-binding se-singha-paathi \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

**LLM auth:** Cloud Run uses **Vertex AI** via the Cloud Run service account (Application Default Credentials). No `GEMINI_API_KEY` secret is required.

For local / VPS dev, keep using `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey).

### 1. Firebase config (before web build)

`web/firebase-config.local.js` is **gitignored**. Create it locally so Cloud Build bakes Google SSO into the image:

```bash
cp web/firebase-config.local.example.js web/firebase-config.local.js
# Edit — values from Firebase Console → Project settings → Your apps → Web app
```

The web Dockerfile copies the entire `web/` folder (`COPY web/ …`), so this file is included automatically when present. Without it, the portal runs in demo/no-auth mode.

### 2. Build both images (Cloud Build)

From **repo root**:

```bash
gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project se-singha-paathi
```

Builds and pushes:

- `us-central1-docker.pkg.dev/se-singha-paathi/prep-portal/prep-portal-api:latest`
- `us-central1-docker.pkg.dev/se-singha-paathi/prep-portal/prep-portal-web:latest`

### 3. Deploy API — `prep-portal-api`

Cloud Run sets `PORT=8080` automatically; the Node server reads `process.env.PORT`.

```bash
gcloud run deploy prep-portal-api \
  --image us-central1-docker.pkg.dev/se-singha-paathi/prep-portal/prep-portal-api:latest \
  --region us-central1 \
  --project se-singha-paathi \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --concurrency 15 \
  --timeout 300 \
  --set-env-vars "\
LLM_PROVIDER=gemini,\
MODEL=gemini-3.1-flash-lite,\
EFFORT=medium,\
POSTCALL_LLM_PROVIDER=gemini,\
POSTCALL_MODEL=gemini-3.1-flash-lite,\
POSTCALL_EFFORT=low,\
GOOGLE_CLOUD_PROJECT=se-singha-paathi,\
VERTEX_LOCATION=us-central1,\
ALLOWED_ORIGINS=https://portal.benjaminsquare.com,\
ALLOWED_EMAIL_DOMAIN=freshworks.com,\
FIREBASE_PROJECT_ID=se-singha-paathi,\
HISTORY_FILE_DIR=/data/history,\
FFMPEG_MAX_CONCURRENT=2" \
  --add-volume name=history,type=cloud-storage,bucket=se-singha-paathi-prep-history \
  --add-volume-mount volume=history,mount-path=/data/history
```

When `GOOGLE_CLOUD_PROJECT` is set and `GEMINI_API_KEY` is **not**, the worker calls Gemini via **Vertex AI** using the Cloud Run service account.

Optional env vars (add to `--set-env-vars` or Secret Manager):

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google AI Studio fallback (not needed on Cloud Run if using Vertex). **Required for Gemini Batch API** (cluster labels, summary rollups, embedding backfill) — batch uses AI Studio REST even when interactive calls use Vertex. |
| `INTERNAL_CRON_SECRET` | Shared secret for `X-Cron-Secret` on `/api/internal/batch/*` and nightly read-model rebuild |
| `ANTHROPIC_API_KEY` | Anthropic fallback |
| `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` / `ZOOM_REDIRECT_URI` | Zoom OAuth (phase 2) |
| `ZOOMINFO_API_KEY` | ZoomInfo research |

### 4. Deploy web — `prep-portal-web`

```bash
gcloud run deploy prep-portal-web \
  --image us-central1-docker.pkg.dev/se-singha-paathi/prep-portal/prep-portal-web:latest \
  --region us-central1 \
  --project se-singha-paathi \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 5 \
  --concurrency 80
```

### 5. Custom domains

```bash
gcloud beta run domain-mappings create \
  --service prep-portal-web \
  --domain portal.benjaminsquare.com \
  --region us-central1 \
  --project se-singha-paathi

gcloud beta run domain-mappings create \
  --service prep-portal-api \
  --domain portalapi.benjaminsquare.com \
  --region us-central1 \
  --project se-singha-paathi
```

Each command prints DNS records. In your DNS provider (Cloudflare etc.), add the **CNAME** records Cloud Run shows. Use **DNS only** (grey cloud) — not proxied — for Let's Encrypt / Google-managed certs.

Verify:

```bash
curl -sI https://portal.benjaminsquare.com | head -3
curl -sI https://portalapi.benjaminsquare.com/api/health | head -3
```

(`web/firebase-config.js` already routes `portal.benjaminsquare.com` → `https://portalapi.benjaminsquare.com` — no code change needed.)

### 6. Firebase authorized domains

In [Firebase Console](https://console.firebase.google.com/) → **se-singha-paathi** → Authentication → Settings → **Authorized domains**, ensure:

- `portal.benjaminsquare.com` (production web)
- `localhost` (local dev)

Cloud Run default URLs (`*.run.app`) are only needed if you test SSO on the raw Cloud Run URL before custom domain is live.

---

## Git trigger setup (Antony-sagayaraj/SE-Labs branch `2.1`)

Auto-deploy on every push to **`2.1`** on [Antony-sagayaraj/SE-Labs](https://github.com/Antony-sagayaraj/SE-Labs).

### One-time (run in order)

```bash
# 0. gcloud auth login && gcloud config set project se-singha-paathi

# 1. GCP APIs, Artifact Registry, GCS bucket, IAM
bash deploy/cloudrun/setup-gcp.sh

# 2. Connect GitHub repo (Console — cannot be scripted)
#    https://console.cloud.google.com/cloud-build/repositories?project=se-singha-paathi
#    Connect repository → GitHub → Antony-sagayaraj/SE-Labs

# 3. Firebase SSO secret for automated web builds
cp web/firebase-config.local.example.js web/firebase-config.local.js
# edit with Firebase Console web app values
bash deploy/cloudrun/setup-firebase-secret.sh

# 4. Build images, then deploy with your credentials
gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project se-singha-paathi
bash deploy/cloudrun/first-deploy.sh   # or first-deploy.ps1 on Windows

# 5. Cloud Build trigger on branch 2.1
bash deploy/cloudrun/setup-trigger.sh

# 6. Custom domains (when *.run.app URLs work)
bash deploy/cloudrun/setup-domains.sh
# Firebase Console → Authentication → Authorized domains → portal.benjaminsquare.com
```

### Day-to-day

```bash
git checkout 2.1
git commit -am "your change"
git push origin 2.1
```

Cloud Build builds both images and injects `firebase-config-local` from Secret Manager. Deploy with `first-deploy.ps1` / `first-deploy.sh` (or re-run after each build).

Watch builds: [Cloud Build history](https://console.cloud.google.com/cloud-build/builds?project=se-singha-paathi)

---

## Redeploy after code changes

With the git trigger (above), push to `2.1` — no manual steps.

Manual fallback:

```bash
gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project se-singha-paathi
powershell -ExecutionPolicy Bypass -File deploy/cloudrun/first-deploy.ps1
```

(`cloudbuild.yaml` builds and pushes only; `first-deploy.ps1` rolls out both services.)

---

## Files in this folder

| File | Purpose |
|------|---------|
| `Dockerfile.api` | Node worker (`worker/`) — same stack as VPS `Dockerfile.worker`, listens on Cloud Run `PORT` |
| `Dockerfile.web` | nginx 1.27 serving `web/` on port 8080 |
| `nginx-cloudrun.conf` | nginx config (from `deploy/vps/nginx.conf`, port 8788 → 8080) |
| `cloudbuild.yaml` | Build and push both images (Firebase secret injection; no Cloud Run deploy) |
| `first-deploy.ps1` | Deploy API + web from pushed images (Windows; uses your gcloud login) |
| `setup-gcp.sh` | One-time APIs, Artifact Registry, GCS, IAM |
| `setup-firebase-secret.sh` | Upload `web/firebase-config.local.js` to Secret Manager |
| `setup-trigger.sh` | Create/update Cloud Build trigger on branch `2.1` |
| `first-deploy.sh` | First API deploy with full env vars and GCS volume |
| `setup-domains.sh` | Map `portal.*` / `portalapi.*` custom domains |

---

## Migrating off VPS

1. Deploy Cloud Run (steps above) and confirm both domains work.
2. Point DNS `portal` and `portalapi` A records → Cloud Run CNAME targets (remove VPS A records).
3. Copy history from VPS if needed: `rsync` `/var/lib/se-paathai/history/` → `gs://se-singha-paathi-prep-history/`.
4. Decommission VPS stack when satisfied.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **"Cannot reach the API server"** on `*.run.app` web URL | Usually **IAM 403** (API not public) and/or **CORS**. Run the two commands below — no rebuild. |
| CORS errors | `ALLOWED_ORIGINS` must include the exact web origin (`https://portal.benjaminsquare.com` or your `prep-portal-web-*.run.app` URL) on API |
| 401 on API | Set `FIREBASE_PROJECT_ID=se-singha-paathi`; ensure user token is valid |
| No Google sign-in button | Rebuild web with `web/firebase-config.local.js` present |
| History not persisting | Check GCS volume mount and bucket IAM on compute SA |
| Domain mapping stuck | Verify domain ownership in GCP; DNS CNAME propagated |
| Gemini 403 on Cloud Run | Grant `roles/aiplatform.user` to the Cloud Run service account; enable `aiplatform.googleapis.com` |
| Gemini works locally but not on Cloud Run | Local uses `GEMINI_API_KEY`; Cloud Run needs `GOOGLE_CLOUD_PROJECT` + Vertex IAM |

**Fix `*.run.app` web → API without rebuild** (replace web URL if yours differs):

```bash
# 1. Allow browser access to the API (403 from Google Frontend = missing invoker)
gcloud run services add-iam-policy-binding prep-portal-api \
  --region=us-central1 \
  --project=se-singha-paathi \
  --member="allUsers" \
  --role="roles/run.invoker"

# 2. CORS — include the Cloud Run web origin
gcloud run services update prep-portal-api \
  --region=us-central1 \
  --project=se-singha-paathi \
  --update-env-vars "ALLOWED_ORIGINS=https://portal.benjaminsquare.com,https://prep-portal-web-781846715448.us-central1.run.app"

# Verify (expect HTTP 200, Access-Control-Allow-Origin matching web URL)
curl -sI "https://prep-portal-api-781846715448.us-central1.run.app/api/config" \
  -H "Origin: https://prep-portal-web-781846715448.us-central1.run.app"
```

See also: [`docs/FIREBASE_SETUP.md`](../../docs/FIREBASE_SETUP.md), [`docs/VPS_DEPLOY.md`](../../docs/VPS_DEPLOY.md).

---

## Cloud Scheduler (Gemini Batch + nightly rebuild)

Enable `cloudscheduler.googleapis.com`. Store `INTERNAL_CRON_SECRET` in Secret Manager and add to the API service env.

| Job | Schedule | Target |
|-----|----------|--------|
| `batch-poll` | `*/10 * * * *` | `POST https://portalapi.benjaminsquare.com/api/internal/batch/poll` |
| `batch-fallback` | `0 * * * *` | `POST .../api/internal/batch/fallback` |
| `embedding-backfill` | `0 2 * * *` | `POST .../api/internal/batch/enqueue?workload=embedding-backfill` |
| `read-models-nightly` | `0 3 * * *` | `POST .../api/internal/read-models/nightly-rebuild` |

Each job sends header `X-Cron-Secret: <INTERNAL_CRON_SECRET>`.

User-facing post-call flows enqueue batch work via authenticated routes (`/api/batch/summaries/enqueue`, `/api/batch/cluster-labels/enqueue`). Poll/fallback cron applies results and runs inline fallback for stuck jobs.

