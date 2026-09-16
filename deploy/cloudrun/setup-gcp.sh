#!/usr/bin/env bash
# One-time GCP setup for Cloud Run deploy (project se-singha-paathi).
# Run: bash deploy/cloudrun/setup-gcp.sh
set -euo pipefail

PROJECT="${PROJECT:-se-singha-paathi}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-prep-portal}"
BUCKET="${BUCKET:-se-singha-paathi-prep-history}"

echo "==> Setting project ${PROJECT}"
gcloud config set project "${PROJECT}"

echo "==> Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com

echo "==> Creating Artifact Registry repo (ignore if exists)"
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Prep portal API + web" 2>/dev/null || true

echo "==> Creating GCS history bucket (ignore if exists)"
gsutil mb -l "${REGION}" "gs://${BUCKET}" 2>/dev/null || true

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

echo "==> Grant compute SA GCS + Vertex access"
gsutil iam ch "serviceAccount:${COMPUTE_SA}:objectAdmin" "gs://${BUCKET}"
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/aiplatform.user" \
  --condition=None >/dev/null

echo "==> Grant Cloud Build SA deploy + secret access"
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/run.admin" \
  --condition=None >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None >/dev/null

echo "==> Done. Project number: ${PROJECT_NUMBER}"
echo "    Compute SA: ${COMPUTE_SA}"
echo "    Cloud Build SA: ${CLOUDBUILD_SA}"
