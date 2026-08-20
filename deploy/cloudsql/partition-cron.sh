#!/usr/bin/env bash
# Weekly partition management for Janus Cloud SQL (Blocker 3).
#
# Runs janus/scripts/manage-partitions.mjs as a Cloud Run job on a schedule so
# audit_log (monthly) and webhook_event (weekly) partitions are always created
# ahead of writes, and *_default overflow is alerted on.
#
# One-time setup:
#   gcloud services enable cloudscheduler.googleapis.com run.googleapis.com
#   Store the postgres (migration-role) connection string in Secret Manager as
#   janus-database-url-migrations — partition DDL needs owner privileges, so
#   this job must NOT use the janus_app DATABASE_URL.
#
# Usage: PROJECT=se-singha-paathi REGION=us-central1 ./partition-cron.sh dev

set -euo pipefail

ENV_NAME="${1:?usage: partition-cron.sh dev|staging}"
PROJECT="${PROJECT:-se-singha-paathi}"
REGION="${REGION:-us-central1}"
JOB="janus-partition-manager-${ENV_NAME}"
SCHEDULE="0 5 * * 1"   # Mondays 05:00 UTC

# Container image: reuse the worker image; the script is plain node + pg.
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT}/janus/worker:latest}"

echo "==> Creating Cloud Run job ${JOB}"
gcloud run jobs create "${JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --command=node \
  --args=janus/scripts/manage-partitions.mjs,--ahead=3 \
  --set-secrets "DATABASE_URL=janus-database-url-migrations:latest" \
  --add-cloudsql-instances "${PROJECT}:${REGION}:janus-pg-${ENV_NAME}" \
  --max-retries 1 \
  --task-timeout 300s 2>/dev/null || gcloud run jobs update "${JOB}" \
  --project="${PROJECT}" --region="${REGION}" --image="${IMAGE}"

echo "==> Creating weekly scheduler trigger"
gcloud scheduler jobs create http "${JOB}-trigger" \
  --project="${PROJECT}" \
  --location="${REGION}" \
  --schedule="${SCHEDULE}" \
  --time-zone=UTC \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="${PROJECT}@appspot.gserviceaccount.com" \
  2>/dev/null || echo "    trigger exists"

echo "Done. Dry-run anytime: gcloud run jobs execute ${JOB} --region ${REGION}"
