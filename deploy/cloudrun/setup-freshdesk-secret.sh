#!/usr/bin/env bash
# Upload Freshdesk API key to Secret Manager and (optionally) attach it to Cloud Run API.
#
# From repo root:
#   FRESHDESK_API_KEY='your-key' bash deploy/cloudrun/setup-freshdesk-secret.sh
# Or pipe the key:
#   printf '%s' 'your-key' | bash deploy/cloudrun/setup-freshdesk-secret.sh
#
# Then attach to an already-deployed API service (default):
#   ATTACH=1 bash deploy/cloudrun/setup-freshdesk-secret.sh
set -euo pipefail

PROJECT="${PROJECT:-se-singha-paathi}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-prep-portal-api}"
SECRET_NAME="${SECRET_NAME:-freshdesk-api-key}"
DOMAIN="${FRESHDESK_DOMAIN:-janus.freshdesk.com}"
ATTACH="${ATTACH:-1}"

TMP="$(mktemp)"
cleanup() { rm -f "${TMP}"; }
trap cleanup EXIT

if [[ -n "${FRESHDESK_API_KEY:-}" ]]; then
  printf '%s' "${FRESHDESK_API_KEY}" > "${TMP}"
elif [[ ! -t 0 ]]; then
  cat > "${TMP}"
else
  echo "Provide FRESHDESK_API_KEY env var, or pipe the key on stdin." >&2
  echo "Example: FRESHDESK_API_KEY='…' bash deploy/cloudrun/setup-freshdesk-secret.sh" >&2
  exit 1
fi

if [[ ! -s "${TMP}" ]]; then
  echo "Freshdesk API key is empty." >&2
  exit 1
fi

gcloud config set project "${PROJECT}"

if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "==> Updating secret ${SECRET_NAME}"
  gcloud secrets versions add "${SECRET_NAME}" --data-file="${TMP}"
else
  echo "==> Creating secret ${SECRET_NAME}"
  gcloud secrets create "${SECRET_NAME}" --data-file="${TMP}"
fi

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
# Cloud Run runtime SA (default compute) needs secretAccessor to mount the secret.
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "==> Grant Cloud Run runtime SA access to secret"
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet

if [[ "${ATTACH}" == "1" ]]; then
  echo "==> Attaching Freshdesk to Cloud Run service ${SERVICE}"
  gcloud run services update "${SERVICE}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --update-env-vars "FRESHDESK_DOMAIN=${DOMAIN}" \
    --update-secrets "FRESHDESK_API_KEY=${SECRET_NAME}:latest"
  echo "==> Smoke: GET /api/config should show freshdesk.configured=true"
  API_URL="$(gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.url)' 2>/dev/null || true)"
  if [[ -n "${API_URL}" ]]; then
    curl -s "${API_URL}/api/config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('freshdesk'))" || true
  fi
fi

echo "==> Done. Secret ${SECRET_NAME}; domain ${DOMAIN}"
