#!/usr/bin/env bash
# First Cloud Run deploy with full API env vars, volumes, and sizing.
# Run AFTER: setup-gcp.sh, setup-firebase-secret.sh, and one successful build.
# For first build without git trigger:
#   gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml
# Or skip deploy steps in cloudbuild temporarily and use this script after build.
set -euo pipefail

PROJECT="${PROJECT:-se-singha-paathi}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-prep-portal}"
TAG="${TAG:-latest}"

API_IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/prep-portal-api:${TAG}"
WEB_IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/prep-portal-web:${TAG}"

gcloud config set project "${PROJECT}"

echo "==> Deploying prep-portal-api (first time — full config)"
gcloud run deploy prep-portal-api \
  --image "${API_IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
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
GOOGLE_CLOUD_PROJECT=${PROJECT},\
VERTEX_LOCATION=${REGION},\
ALLOWED_ORIGINS=https://portal.benjaminsquare.com,\
ALLOWED_EMAIL_DOMAIN=freshworks.com,\
FIREBASE_PROJECT_ID=${PROJECT},\
HISTORY_FILE_DIR=/data/history,\
FFMPEG_MAX_CONCURRENT=2" \
  --add-volume="name=history,type=cloud-storage,bucket=se-singha-paathi-prep-history" \
  --add-volume-mount="volume=history,mount-path=/data/history"

echo "==> Deploying prep-portal-web"
gcloud run deploy prep-portal-web \
  --image "${WEB_IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 5 \
  --concurrency 80

echo "==> Public invoker (required for browser access to *.run.app URLs)"
gcloud run services add-iam-policy-binding prep-portal-api \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --quiet

echo "==> Smoke test URLs"
API_URL="$(gcloud run services describe prep-portal-api --region="${REGION}" --format='value(status.url)')"
WEB_URL="$(gcloud run services describe prep-portal-web --region="${REGION}" --format='value(status.url)')"

echo "==> CORS: allow web origin on API"
ALLOWED_ORIGINS="https://portal.benjaminsquare.com,${WEB_URL}"
gcloud run services update prep-portal-api \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --update-env-vars "ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"

echo "API: ${API_URL}/api/health"
echo "Web: ${WEB_URL}/"
curl -sI "${API_URL}/api/health" | head -3 || true
curl -sI "${WEB_URL}/" | head -3 || true

echo "==> Done."
