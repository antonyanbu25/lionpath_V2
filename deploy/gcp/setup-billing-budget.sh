#!/usr/bin/env bash
# Create a GCP Cloud Billing budget for project se-singha-paathi with alert thresholds.
#
# Budgets ALERT — they do not cap spend. Pair with Gemini API quotas (docs/COST_CONTROL.md)
# and the worker daily token budget circuit breaker.
#
# Prerequisites:
#   - gcloud CLI authenticated with Billing Account Administrator (or Budget Admin)
#   - Billing account linked to project se-singha-paathi
#
# Usage:
#   export BILLING_ACCOUNT_ID=XXXXXX-YYYYYY-ZZZZZZ   # from: gcloud billing accounts list
#   export MONTHLY_BUDGET_USD=1500                      # agreed monthly figure (placeholder)
#   export ALERT_EMAIL_USER=you@freshworks.com
#   export ALERT_EMAIL_DIRECTOR=director@freshworks.com
#   bash deploy/gcp/setup-billing-budget.sh
#
# Optional: reuse existing notification channels instead of creating new ones:
#   export NOTIFICATION_CHANNEL_USER=projects/se-singha-paathi/notificationChannels/123
#   export NOTIFICATION_CHANNEL_DIRECTOR=projects/se-singha-paathi/notificationChannels/456
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-se-singha-paathi}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
MONTHLY_BUDGET_USD="${MONTHLY_BUDGET_USD:-1500}"
ALERT_EMAIL_USER="${ALERT_EMAIL_USER:-}"
ALERT_EMAIL_DIRECTOR="${ALERT_EMAIL_DIRECTOR:-}"
DISPLAY_NAME="${DISPLAY_NAME:-SE Singha Paathi — monthly LLM + GCP}"

if [[ -z "${BILLING_ACCOUNT_ID}" ]]; then
  echo "ERROR: Set BILLING_ACCOUNT_ID (gcloud billing accounts list)" >&2
  exit 1
fi

if [[ -z "${ALERT_EMAIL_USER}" || -z "${ALERT_EMAIL_DIRECTOR}" ]]; then
  echo "ERROR: Set ALERT_EMAIL_USER and ALERT_EMAIL_DIRECTOR" >&2
  exit 1
fi

create_email_channel() {
  local email="$1"
  local display="$2"
  gcloud beta monitoring channels create \
    --project="${PROJECT_ID}" \
    --display-name="${display}" \
    --type=email \
    --channel-labels=email_address="${email}" \
    --format='value(name)'
}

if [[ -z "${NOTIFICATION_CHANNEL_USER:-}" ]]; then
  echo "Creating notification channel for ${ALERT_EMAIL_USER}..."
  NOTIFICATION_CHANNEL_USER="$(create_email_channel "${ALERT_EMAIL_USER}" "Cost alert — SE user")"
fi

if [[ -z "${NOTIFICATION_CHANNEL_DIRECTOR:-}" ]]; then
  echo "Creating notification channel for ${ALERT_EMAIL_DIRECTOR}..."
  NOTIFICATION_CHANNEL_DIRECTOR="$(create_email_channel "${ALERT_EMAIL_DIRECTOR}" "Cost alert — director")"
fi

CHANNELS="[${NOTIFICATION_CHANNEL_USER},${NOTIFICATION_CHANNEL_DIRECTOR}]"

echo "Creating billing budget: \$${MONTHLY_BUDGET_USD}/month on ${PROJECT_ID}..."

# Thresholds: 50%, 80%, 100%, 150% of budget (current-spend basis).
gcloud billing budgets create \
  --billing-account="${BILLING_ACCOUNT_ID}" \
  --display-name="${DISPLAY_NAME}" \
  --budget-amount="${MONTHLY_BUDGET_USD}USD" \
  --filter-projects="projects/${PROJECT_ID}" \
  --notifications-rule="monitoring-notification-channels=${CHANNELS},enabled=true" \
  --threshold-rule=percent=0.5,basis=current-spend \
  --threshold-rule=percent=0.8,basis=current-spend \
  --threshold-rule=percent=1.0,basis=current-spend \
  --threshold-rule=percent=1.5,basis=current-spend

echo ""
echo "Verify: https://console.cloud.google.com/billing/budgets?project=${PROJECT_ID}"
echo "Done."
