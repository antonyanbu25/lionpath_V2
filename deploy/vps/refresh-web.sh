#!/usr/bin/env bash
# Sync portal HTML/CSS/JS from git and restart nginx — no worker rebuild.
# Use when verify-deploy fails on stale portal HTML but worker API is already current.
#
#   cd /opt/se-singha-paathai/deploy/vps && bash refresh-web.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
BRANCH="2.1"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"
INDEX="$REPO_ROOT/web/index.html"

echo "=== Refresh portal web ($BRANCH) — worker untouched ==="

bash "$DEPLOY_DIR/git-fetch-origin.sh" "$REPO_ROOT" "$BRANCH"
cd "$REPO_ROOT"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
echo "=== Checked out: $(git log -1 --oneline) ==="

if ! grep -q 'precall.css?v=2.1' "$INDEX"; then
  echo "ERROR: $INDEX missing precall.css?v=2.1 after git reset." >&2
  grep -E 'portal-build|precall.css|postcall.css' "$INDEX" | head -5 >&2 || true
  exit 1
fi
if ! grep -qE 'postcall.css?v=2\.1' "$INDEX"; then
  echo "ERROR: $INDEX missing postcall.css?v=2.1 after git reset." >&2
  grep -E 'portal-build|precall.css|postcall.css' "$INDEX" | head -5 >&2 || true
  exit 1
fi

bash "$DEPLOY_DIR/build-web-bundle.sh"

cd "$DEPLOY_DIR"
docker compose up -d --force-recreate web

echo ""
echo "=== On-disk markers ==="
grep -E 'portal-build|precall.css|postcall.css' "$INDEX" | head -5

echo ""
bash "$DEPLOY_DIR/verify-deploy.sh"
