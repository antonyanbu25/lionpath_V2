#!/usr/bin/env bash
# Upload Janus DATABASE_URL secrets to Secret Manager and attach to Cloud Run API.
#
# Reads connection strings from worker/.dev.vars (gitignored) by default.
# Override with env vars or stdin for CI.
#
# From repo root:
#   bash deploy/cloudrun/setup-sql-secrets.sh
#   ATTACH=1 ENV_NAME=dev bash deploy/cloudrun/setup-sql-secrets.sh
#
# Requires: gcloud auth, Secret Manager API, roles/secretmanager.admin
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEV_VARS="${DEV_VARS:-${ROOT}/worker/.dev.vars}"
PROJECT="${PROJECT:-se-singha-paathi}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-prep-portal-api}"
ENV_NAME="${ENV_NAME:-dev}"
SECRET_APP="${SECRET_APP:-janus-database-url-${ENV_NAME}}"
SECRET_MIGRATIONS="${SECRET_MIGRATIONS:-janus-database-url-migrations}"
ATTACH="${ATTACH:-1}"

parse_dev_var() {
  local key="$1"
  [[ -f "${DEV_VARS}" ]] || return 1
  node -e "
    const fs = require('fs');
    const key = process.argv[1];
    for (const line of fs.readFileSync(process.argv[2], 'utf8').split(/\\r?\\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('\"') && v.endsWith('\"')) || (v.startsWith(\"'\") && v.endsWith(\"'\"))) v = v.slice(1, -1);
      if (k === key) { process.stdout.write(v); process.exit(0); }
    }
    process.exit(1);
  " "${key}" "${DEV_VARS}"
}

APP_URL="${DATABASE_URL:-}"
MIGRATIONS_URL="${DATABASE_URL_MIGRATIONS:-}"

if [[ -z "${APP_URL}" ]]; then
  APP_URL="$(parse_dev_var DATABASE_URL)" || true
fi
if [[ -z "${MIGRATIONS_URL}" ]]; then
  MIGRATIONS_URL="$(parse_dev_var DATABASE_URL_MIGRATIONS)" || true
fi

if [[ -z "${APP_URL}" ]]; then
  echo "Set DATABASE_URL in worker/.dev.vars or export DATABASE_URL." >&2
  exit 1
fi

if [[ "${APP_URL}" == *"postgres://"* ]] || [[ "${APP_URL}" == *"postgresql://postgres:"* ]]; then
  echo "DATABASE_URL must use janus_app, not postgres superuser." >&2
  exit 1
fi

gcloud config set project "${PROJECT}"

upsert_secret() {
  local name="$1"
  local file="$2"
  if gcloud secrets describe "${name}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "==> Updating secret ${name}"
    gcloud secrets versions add "${name}" --data-file="${file}"
  else
    echo "==> Creating secret ${name}"
    gcloud secrets create "${name}" --data-file="${file}"
  fi
}

TMP_APP="$(mktemp)"
TMP_MIG="$(mktemp)"
cleanup() { rm -f "${TMP_APP}" "${TMP_MIG}"; }
trap cleanup EXIT

printf '%s' "${APP_URL}" > "${TMP_APP}"
upsert_secret "${SECRET_APP}" "${TMP_APP}"

if [[ -n "${MIGRATIONS_URL}" ]]; then
  printf '%s' "${MIGRATIONS_URL}" > "${TMP_MIG}"
  upsert_secret "${SECRET_MIGRATIONS}" "${TMP_MIG}"
else
  echo "==> Skipping ${SECRET_MIGRATIONS} (DATABASE_URL_MIGRATIONS not set)"
fi

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

for SEC in "${SECRET_APP}" ${MIGRATIONS_URL:+${SECRET_MIGRATIONS}}; do
  echo "==> Grant secretAccessor on ${SEC}"
  gcloud secrets add-iam-policy-binding "${SEC}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

if [[ "${ATTACH}" == "1" ]]; then
  echo "==> Attaching SQL secrets + PERSISTENCE_MODE=dual to ${SERVICE}"
  gcloud run services update "${SERVICE}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --update-secrets "DATABASE_URL=${SECRET_APP}:latest" \
    --update-env-vars "PERSISTENCE_MODE=dual"
  echo "==> Done. Verify: curl \$(gcloud run services describe ${SERVICE} --region=${REGION} --format='value(status.url)')/api/health"
else
  echo "==> Secrets stored. Re-run with ATTACH=1 to mount on Cloud Run."
fi
