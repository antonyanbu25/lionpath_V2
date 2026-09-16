#!/usr/bin/env bash
# ============================================================================
# Janus Cloud SQL provisioning (dev / staging)
# Creates: Cloud SQL Postgres 15 instance, janus database, janus_app role
# password rotation, Secret Manager DATABASE_URL, and optional PgBouncer
# sidecar notes. Idempotent-ish: safe to re-run; existing resources are
# skipped or updated in place.
#
# Prereqs: gcloud auth'd, project set, billing enabled.
#   export PROJECT_ID=se-singha-paathi
#   export REGION=us-central1
#   ./provision.sh dev|staging
# ============================================================================
set -euo pipefail

ENV_NAME="${1:?usage: provision.sh dev|staging}"
PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
INSTANCE="janus-pg-${ENV_NAME}"
DB_NAME="janus"
DB_TIER="db-custom-2-7680"   # 2 vCPU / 7.5GB — adjust per env

echo "==> Enabling APIs"
gcloud services enable sqladmin.googleapis.com secretmanager.googleapis.com \
  vpcaccess.googleapis.com servicenetworking.googleapis.com \
  --project "$PROJECT_ID"

echo "==> Creating Cloud SQL instance $INSTANCE (skipped if exists)"
if ! gcloud sql instances describe "$INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud sql instances create "$INSTANCE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --database-version POSTGRES_15 \
    --tier "$DB_TIER" \
    --storage-size 20GB \
    --storage-auto-increase \
    --backup-start-time 03:00 \
    --maintenance-window-day SUN --maintenance-window-hour 4 \
    --deletion-protection \
    --assign-ip  # public IP; tighten to --network + private IP once VPC connector exists
else
  echo "    instance exists"
fi

echo "==> Creating database $DB_NAME"
gcloud sql databases create "$DB_NAME" --instance "$INSTANCE" --project "$PROJECT_ID" 2>/dev/null || echo "    database exists"

echo "==> Rotating janus_app password (generated, stored in Secret Manager)"
JANUS_APP_PASSWORD="$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 40)"
# janus_app role is created by janus/schema/00_phase0_infra_and_org.sql with a
# placeholder password; this rotates it. If the role doesn't exist yet the
# create-user path below is a no-op until DDL runs.
if gcloud sql users list --instance "$INSTANCE" --project "$PROJECT_ID" --format='value(name)' | grep -qx janus_app; then
  gcloud sql users set-password janus_app --instance "$INSTANCE" --project "$PROJECT_ID" --password "$JANUS_APP_PASSWORD"
else
  echo "    janus_app role not present yet — run init_all.sql first, then re-run this script"
fi

INSTANCE_CONN="$(gcloud sql instances describe "$INSTANCE" --project "$PROJECT_ID" --format='value(connectionName)')"
DB_URL="postgresql://janus_app:${JANUS_APP_PASSWORD}@localhost:5432/${DB_NAME}?sslmode=require"

echo "==> Storing DATABASE_URL in Secret Manager (janus-database-url-${ENV_NAME})"
SECRET="janus-database-url-${ENV_NAME}"
if ! gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --project "$PROJECT_ID" --replication-policy automatic
fi
printf '%s' "$DB_URL" | gcloud secrets versions add "$SECRET" --project "$PROJECT_ID" --data-file=-

cat <<EOF

Done.
  Instance connection name: $INSTANCE_CONN
  Secret:                   $SECRET  (janus_app DATABASE_URL via Cloud SQL Auth Proxy)

Next steps:
  1. Run DDL as postgres superuser:
       gcloud sql connect $INSTANCE --user=postgres --project $PROJECT_ID
       \i janus/schema/init_all.sql
  2. Re-run this script to rotate janus_app's real password.
  3. Attach the secret to Cloud Run:
       --set-secrets DATABASE_URL=$SECRET:latest
       --add-cloudsql-instances $INSTANCE_CONN
  4. PgBouncer: see pgbouncer.ini in this directory (transaction mode REQUIRED —
     SET LOCAL session vars only survive inside an explicit transaction).
EOF
