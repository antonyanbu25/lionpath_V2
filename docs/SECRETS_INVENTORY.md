# Secrets Inventory — SE Singha Paathai

**Last updated:** 2026-08-08
**Owner:** Security architect

## Current state

Secrets are spread across THREE unsynced locations. No centralized secret manager
is in use (except for firebase-config-local on Cloud Run builds).

## Inventory table

| Secret | VPS (.env) | Cloud Run (--set-env-vars) | Cloudflare (wrangler.toml / wrangler secret) | Notes |
|--------|-----------|---------------------------|----------------------------------------------|-------|
| GEMINI_API_KEY | .env (plaintext) | NOT set (uses Vertex AI via service account ADC) | wrangler secret put | Cloud Run uses Vertex (no key needed). Batch API still needs AI Studio key. |
| FIREBASE_PROJECT_ID | .env (plaintext) | --set-env-vars | wrangler.toml [vars] | SET on all targets (se-singha-paathi). |
| FIREBASE_SERVICE_ACCOUNT_JSON | .env (optional) | NOT set | wrangler secret (optional) | For Firestore admin reads on VPS. Cloud Run uses ADC. |
| ALLOWED_EMAIL_DOMAIN | .env | --set-env-vars | wrangler.toml [vars] | Non-secret config (freshworks.com). |
| ALLOWED_ORIGINS | .env | --set-env-vars | wrangler.toml [vars] | Non-secret config. |
| INTERNAL_CRON_SECRET | .env (commented out in example) | Secret Manager (documented, dormant) | N/A | Cloud Scheduler cron auth. Currently dormant. |
| FRESHDESK_API_KEY | .env (plaintext, committed in .env.example!) | NOT set | N/A | HARDCODED in .env.example — should be removed from the example file. |
| FRESHDESK_DOMAIN | .env | NOT set | N/A | Non-secret (janus.freshdesk.com). |
| ANTHROPIC_API_KEY | .env (optional) | optional (Secret Manager) | wrangler secret (optional) | Optional fallback provider. |
| ZOOM_CLIENT_ID | .env (optional) | optional | wrangler.toml [vars] (optional) | Zoom OAuth phase 2. |
| ZOOM_CLIENT_SECRET | .env (optional) | Secret Manager (optional) | wrangler secret put | Zoom OAuth phase 2. |
| ZOOM_REDIRECT_URI | .env (optional) | optional | wrangler.toml [vars] | Non-secret. |
| APOLLO_API_KEY | N/A | N/A | wrangler secret (optional) | Optional enrichment. |
| firebase-config-local | N/A | Secret Manager secret "firebase-config-local" | N/A | Web SSO config. Only secret using Secret Manager today. |
| GOOGLE_CLOUD_PROJECT | N/A | --set-env-vars | N/A | Non-secret (se-singha-paathi). |
| VERTEX_LOCATION | N/A | --set-env-vars | N/A | Non-secret (us-central1). |
| DATABASE_URL | N/A | Secret Manager "janus-database-url-{env}" | N/A | Cloud SQL `janus_app` role (NOT postgres superuser). Created by deploy/cloudsql/provision.sh. |
| PERSISTENCE_MODE | N/A | --set-env-vars | N/A | Non-secret flag: firestore \| dual \| sql. |

## Known issues

1. **FRESHDESK_API_KEY is committed in deploy/vps/.env.example** (line 79:
   `FRESHDESK_API_KEY=<REDACTED>`). This is a real API key committed to the
   repo. ACTION: rotate this key in Freshdesk, replace the .env.example line with a
   placeholder, and update the real VPS .env with the new key. This is a separate
   remediation task — flag it to the team immediately.

2. **No secret rotation policy** — keys have no documented expiry or rotation schedule.

3. **VPS .env is plaintext on disk** at /opt/se-singha-paathai/deploy/vps/.env (chmod 600
   per .env.example). No encryption at rest beyond filesystem permissions.

4. **Cloud Run uses --set-env-vars (plaintext in the gcloud command/revision spec)** for
   most values. Only firebase-config-local uses Secret Manager.

## Recommendations (phased, NOT this session)

### Phase 1 (this session): inventory + drift check
- This document.
- deploy/scripts/check-secrets-drift.sh: compares .env.example keys against Cloud Run
  env vars and wrangler.toml vars to detect drift.

### Phase 2 (ops task, requires gcloud access): Secret Manager migration for Cloud Run
- Move GEMINI_API_KEY, INTERNAL_CRON_SECRET, ANTHROPIC_API_KEY, ZOOM_CLIENT_SECRET to
  Secret Manager.
- Update first-deploy.sh to use --set-secrets instead of --set-env-vars for those keys.
- Grant Cloud Run service account roles/secretmanager.secretAccessor on each secret.
- Test: redeploy, verify /api/config still returns correct provider status.

### Phase 3 (ops task): VPS secret management
- VPS has no Secret Manager equivalent. Options:
  a. Accept .env files with chmod 600 + audit access (current state, documented).
  b. Docker secrets (docker-compose secrets with files mounted at /run/secrets/).
  c. Migrate VPS off Docker Compose to Cloud Run (per FULLSTACK_REVIEW_BRIEF §6 Option C).

### Phase 4 (ops task): rotation policy
- Document rotation cadence for each secret.
- Automate rotation where possible (gcloud secrets rotate).
