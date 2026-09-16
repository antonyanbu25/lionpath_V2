#!/usr/bin/env bash
# Backfill org.seniorLeaderIds (Tony + other senior managers) on Firestore.
# Run from deploy/vps on the VPS — host npm is not required.
#
# Usage:
#   bash migrate-org-hierarchy.sh           # apply
#   bash migrate-org-hierarchy.sh --dry-run # preview only
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
SCRIPTS_DIR="$REPO_ROOT/worker/scripts"
DRY_RUN=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=(--dry-run)
  fi
done

if [[ ! -f .env ]]; then
  echo "MISSING deploy/vps/.env — copy .env.example and configure Firebase." >&2
  exit 1
fi

if [[ ! -f "$SCRIPTS_DIR/migrate-org-hierarchy.mjs" ]]; then
  echo "MISSING $SCRIPTS_DIR/migrate-org-hierarchy.mjs — pull latest 2.1 first." >&2
  exit 1
fi

# Migrate script uses GOOGLE_APPLICATION_CREDENTIALS (file path), not inline JSON.
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

echo "=== migrate-org-hierarchy ${DRY_RUN[*]:-(apply)} ==="
docker compose run --rm \
  -v "$SCRIPTS_DIR:/app/scripts:ro" \
  -v "${SA_FILE}:${SA_FILE}:ro" \
  -e "GOOGLE_APPLICATION_CREDENTIALS=${SA_FILE}" \
  worker node scripts/migrate-org-hierarchy.mjs "${DRY_RUN[@]}"

echo "=== Done ==="
if [[ ${#DRY_RUN[@]} -eq 0 ]]; then
  echo "Have affected users sign out/in once so session picks up org leader flags."
fi
