#!/usr/bin/env bash
# DORMANT — Cloud Scheduler template for after GCP migration.
# Do NOT run on the VPS. VPS cron uses deploy/vps/cron-batch.sh instead.
#
# Prerequisites (one-time):
#   gcloud config set project se-singha-paathi
#   gcloud services enable cloudscheduler.googleapis.com
#   Store INTERNAL_CRON_SECRET in Secret Manager and on prep-portal-api Cloud Run service.
#
# Uncomment and adjust REGION / API_URL / CRON_SECRET before use.

set -euo pipefail

# REGION="${REGION:-us-central1}"
# API_URL="${API_URL:-https://portalapi.benjaminsquare.com}"
# CRON_SECRET="${CRON_SECRET:-REPLACE_WITH_SECRET_MANAGER_VALUE}"
# PROJECT="${PROJECT:-se-singha-paathi}"

# create_job() {
#   local name="$1"
#   local schedule="$2"
#   local path="$3"
#   gcloud scheduler jobs create http "${name}" \
#     --project="${PROJECT}" \
#     --location="${REGION}" \
#     --schedule="${schedule}" \
#     --uri="${API_URL}${path}" \
#     --http-method=POST \
#     --headers="X-Cron-Secret=${CRON_SECRET}" \
#     --attempt-deadline=300s \
#     --time-zone="UTC"
# }

# create_job batch-poll           '*/10 * * * *' '/api/internal/batch/poll'
# create_job batch-fallback       '0 * * * *'    '/api/internal/batch/fallback'
# create_job embedding-backfill   '0 2 * * *'    '/api/internal/batch/enqueue?workload=embedding-backfill'
# create_job read-models-nightly  '0 3 * * *'    '/api/internal/read-models/nightly-rebuild'

echo "DORMANT template — uncomment jobs above after Cloud Run migration."
echo "See deploy/cloudrun/README.md (Cloud Scheduler section)."
