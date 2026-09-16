#!/usr/bin/env bash
# Hotfix: postcall scorecard Gemini 400 (integer enum → string enum).
# Run on VPS when /api/config lacks geminiSchemaEnumFix:
#   cd /opt/se-singha-paathai/deploy/vps && bash hotfix-gemini-schema.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
BRANCH="2.0.8.1-merge"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"
API="${PORTAL_API:-https://portalapi.benjaminsquare.com/api/config}"

echo "=== Before: live API ==="
BEFORE="$(curl -sf "$API" || echo '{}')"
echo "$BEFORE" | head -c 300
echo ""

if echo "$BEFORE" | grep -q '"geminiSchemaEnumFix"'; then
  echo "OK: geminiSchemaEnumFix already live — nothing to do."
  exit 0
fi

echo "=== Fetch $BRANCH (commit must include schema-fix) ==="
bash "$DEPLOY_DIR/git-fetch-origin.sh" "$REPO_ROOT" "$BRANCH"
cd "$REPO_ROOT"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
echo "=== Checked out: $(git log -1 --oneline) ==="

if ! grep -q 'GEMINI_SCHEMA_ENUM_FIX' "$REPO_ROOT/worker/src/build-id.ts" 2>/dev/null; then
  echo "ERROR: worker/src/build-id.ts missing GEMINI_SCHEMA_ENUM_FIX — fetch did not get commit 286b671+." >&2
  exit 1
fi

if ! grep -q 'coerceEnumForGemini' "$REPO_ROOT/worker/src/gemini-schema.ts" 2>/dev/null; then
  echo "ERROR: worker/src/gemini-schema.ts missing coerceEnumForGemini." >&2
  exit 1
fi

cd "$DEPLOY_DIR"
if [[ ! -f .env ]]; then
  echo "ERROR: Missing deploy/vps/.env" >&2
  exit 1
fi

echo "=== Rebuild worker (no cache) ==="
docker compose build --no-cache worker
docker compose up -d worker web

echo "=== Waiting 10s ==="
sleep 10

echo "=== After: live API ==="
AFTER="$(curl -sf "$API" || echo '{}')"
echo "$AFTER" | head -c 400
echo ""

if ! echo "$AFTER" | grep -q '"geminiSchemaEnumFix"'; then
  echo "FAIL: geminiSchemaEnumFix still missing after rebuild." >&2
  docker compose logs worker --tail 40
  exit 1
fi

echo "OK: Gemini schema fix is live."
bash "$DEPLOY_DIR/verify-deploy.sh"
