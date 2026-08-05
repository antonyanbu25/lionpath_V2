#!/usr/bin/env bash
# Create Cloud Build trigger: push to Antony-sagayaraj/SE-Labs branch 2.1.
# Prerequisite: connect repo in Cloud Console first (see README Git trigger section).
set -euo pipefail

PROJECT="${PROJECT:-se-singha-paathi}"
TRIGGER_NAME="${TRIGGER_NAME:-deploy-2-1}"
REPO_OWNER="${REPO_OWNER:-Antony-sagayaraj}"
REPO_NAME="${REPO_NAME:-SE-Labs}"
BRANCH_PATTERN="${BRANCH_PATTERN:-^2\\.1$}"

gcloud config set project "${PROJECT}"

if gcloud builds triggers describe "${TRIGGER_NAME}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Trigger ${TRIGGER_NAME} already exists — updating"
  gcloud builds triggers update github "${TRIGGER_NAME}" \
    --repo-owner="${REPO_OWNER}" \
    --repo-name="${REPO_NAME}" \
    --branch-pattern="${BRANCH_PATTERN}" \
    --build-config="deploy/cloudrun/cloudbuild.yaml" \
    --substitutions="_TAG=\$SHORT_SHA"
else
  echo "==> Creating trigger ${TRIGGER_NAME}"
  gcloud builds triggers create github \
    --name="${TRIGGER_NAME}" \
    --repo-owner="${REPO_OWNER}" \
    --repo-name="${REPO_NAME}" \
    --branch-pattern="${BRANCH_PATTERN}" \
    --build-config="deploy/cloudrun/cloudbuild.yaml" \
    --substitutions="_TAG=\$SHORT_SHA"
fi

echo "==> Done. Push to branch 2.1 on ${REPO_OWNER}/${REPO_NAME} to deploy."
