#!/usr/bin/env bash
# Install VPS cron jobs for Gemini Batch poll/fallback/enqueue + nightly read-models.
# Calls cron-batch.sh on http://127.0.0.1:8787 (localhost worker — not public DNS).
#
# Run from deploy/vps on the VPS:  bash install-crontab.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BATCH="${SCRIPT_DIR}/cron-batch.sh"
LOG_FILE="${CRON_LOG:-/var/log/se-paathai-cron.log}"
MARKER="se-paathai-gemini-batch-cron"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (or: sudo bash install-crontab.sh)." >&2
  exit 1
fi

if [[ ! -x "${BATCH}" ]]; then
  chmod +x "${BATCH}"
fi

if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
  echo "Missing ${SCRIPT_DIR}/.env — copy .env.example, set INTERNAL_CRON_SECRET, then re-run." >&2
  exit 1
fi

touch "${LOG_FILE}"
chmod 640 "${LOG_FILE}"

TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

# Drop previous se-paathai cron lines, keep everything else.
crontab -l 2>/dev/null | grep -v "${MARKER}" | grep -v "${BATCH}" | sed '/^[[:space:]]*$/d' > "${TMP}" || true

{
  cat "${TMP}"
  echo ""
  echo "# ${MARKER}"
  echo "*/10 * * * * ${BATCH} poll >> ${LOG_FILE} 2>&1 # ${MARKER}"
  echo "0 * * * * ${BATCH} fallback >> ${LOG_FILE} 2>&1 # ${MARKER}"
  echo "0 2 * * * ${BATCH} embedding >> ${LOG_FILE} 2>&1 # ${MARKER}"
  echo "0 3 * * * ${BATCH} read-models >> ${LOG_FILE} 2>&1 # ${MARKER}"
} | crontab -

echo "Installed crontab entries (log: ${LOG_FILE}):"
crontab -l | grep "${MARKER}" || true
echo ""
echo "Smoke test: ${BATCH} poll"
echo "Ensure worker is reachable on 127.0.0.1:8787 (see docs/VPS_DEPLOY.md §5b)."
