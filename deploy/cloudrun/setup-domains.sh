#!/usr/bin/env bash
# Map custom domains to Cloud Run services (run after services are healthy on *.run.app).
set -euo pipefail

PROJECT="${PROJECT:-se-singha-paathi}"
REGION="${REGION:-us-central1}"

gcloud config set project "${PROJECT}"

echo "==> Domain mapping: portal.benjaminsquare.com -> prep-portal-web"
gcloud beta run domain-mappings create \
  --service prep-portal-web \
  --domain portal.benjaminsquare.com \
  --region "${REGION}" \
  --project "${PROJECT}" 2>/dev/null || \
  gcloud beta run domain-mappings describe \
    --domain portal.benjaminsquare.com \
    --region "${REGION}" \
    --project "${PROJECT}"

echo "==> Domain mapping: portalapi.benjaminsquare.com -> prep-portal-api"
gcloud beta run domain-mappings create \
  --service prep-portal-api \
  --domain portalapi.benjaminsquare.com \
  --region "${REGION}" \
  --project "${PROJECT}" 2>/dev/null || \
  gcloud beta run domain-mappings describe \
    --domain portalapi.benjaminsquare.com \
    --region "${REGION}" \
    --project "${PROJECT}"

echo ""
echo "==> Add the CNAME records above in your DNS provider (DNS only, not proxied)."
echo "==> Firebase Console: Authentication -> Authorized domains -> add portal.benjaminsquare.com"
echo ""
echo "Verify when DNS propagates:"
echo "  curl -sI https://portal.benjaminsquare.com | head -3"
echo "  curl -sI https://portalapi.benjaminsquare.com/api/health | head -3"
