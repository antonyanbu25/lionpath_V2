#!/usr/bin/env bash
# Upload web/firebase-config.local.js to Secret Manager for Cloud Build SSO.
# Run from repo root after creating web/firebase-config.local.js:
#   bash deploy/cloudrun/setup-firebase-secret.sh
set -euo pipefail

PROJECT="${PROJECT:-se-singha-paathi}"
SECRET_NAME="${SECRET_NAME:-firebase-config-local}"
CONFIG_FILE="${CONFIG_FILE:-web/firebase-config.local.js}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing ${CONFIG_FILE}"
  echo "Copy web/firebase-config.local.example.js and fill Firebase web app values first."
  exit 1
fi

gcloud config set project "${PROJECT}"

if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "==> Updating secret ${SECRET_NAME}"
  gcloud secrets versions add "${SECRET_NAME}" --data-file="${CONFIG_FILE}"
else
  echo "==> Creating secret ${SECRET_NAME}"
  gcloud secrets create "${SECRET_NAME}" --data-file="${CONFIG_FILE}"
fi

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

echo "==> Grant Cloud Build access to secret"
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/secretmanager.secretAccessor"

echo "==> Done. Secret ${SECRET_NAME} ready for cloudbuild.yaml"
