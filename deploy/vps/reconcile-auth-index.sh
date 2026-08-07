#!/usr/bin/env bash
# Point authIndex/{firebaseUid} at the canonical users/{id} for an email.
# Fixes seniorLeaderIds UUID vs session usr_dummy_* drift after seed/migrate.
#
# Usage:
#   bash reconcile-auth-index.sh --email antony.sagayaraj@freshworks.com
#   bash reconcile-auth-index.sh --email vipin.thomas@freshworks.com
#   bash reconcile-auth-index.sh --email user@freshworks.com --dry-run
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
SCRIPTS_DIR="$REPO_ROOT/worker/scripts"

if [[ ! -f .env ]]; then
  echo "MISSING deploy/vps/.env — copy .env.example and configure Firebase." >&2
  exit 1
fi

if [[ ! -f "$SCRIPTS_DIR/reconcile-auth-index.mjs" ]]; then
  echo "MISSING $SCRIPTS_DIR/reconcile-auth-index.mjs — pull latest 2.1 first." >&2
  exit 1
fi

EMAIL=""
EXTRA=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    EXTRA+=(--dry-run)
  elif [[ "$arg" == --email=* ]]; then
    EMAIL="${arg#--email=}"
  elif [[ "$arg" == "--email" ]]; then
    continue
  elif [[ -z "$EMAIL" && "$arg" != --* ]]; then
    EMAIL="$arg"
  else
    EXTRA+=("$arg")
  fi
done

# Support: reconcile-auth-index.sh --email user@freshworks.com
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--email" ]]; then
    EMAIL="$arg"
  fi
  prev="$arg"
done

if [[ -z "$EMAIL" ]]; then
  echo "Usage: bash reconcile-auth-index.sh --email user@freshworks.com [--dry-run]" >&2
  exit 1
fi

SA_FILE=""
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  SA_FILE="${GOOGLE_APPLICATION_CREDENTIALS}"
elif [[ -f firebase-sa.json ]]; then
  SA_FILE="$(pwd)/firebase-sa.json"
elif grep -q '^FIREBASE_SERVICE_ACCOUNT_JSON=' .env 2>/dev/null; then
  SA_FILE="/tmp/se-paathai-firebase-sa.json"
  grep '^FIREBASE_SERVICE_ACCOUNT_JSON=' .env | cut -d= -f2- | tr -d '\r' > "$SA_FILE"
  chmod 600 "$SA_FILE"
else
  echo "No Firebase Admin creds — set GOOGLE_APPLICATION_CREDENTIALS, deploy/vps/firebase-sa.json," >&2
  echo "or FIREBASE_SERVICE_ACCOUNT_JSON in .env" >&2
  exit 1
fi

echo "=== reconcile-auth-index ${EMAIL} ${EXTRA[*]:-} ==="
docker compose run --rm \
  -v "$SCRIPTS_DIR:/app/scripts:ro" \
  -v "${SA_FILE}:${SA_FILE}:ro" \
  -e "GOOGLE_APPLICATION_CREDENTIALS=${SA_FILE}" \
  worker node scripts/reconcile-auth-index.mjs --email "$EMAIL" "${EXTRA[@]}"

echo "=== Done ==="
echo "Have $EMAIL sign out/in once after reconcile."
