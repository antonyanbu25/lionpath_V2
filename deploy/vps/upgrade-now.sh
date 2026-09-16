#!/usr/bin/env bash
# Upgrade VPS to 2.1 (pre-call Know tab UI + postcall intake from 2.0.8.1-merge base).
# Run on the VPS as root or deploy user:
#   cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
BRANCH="2.1"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"

echo "=============================================="
echo " UPGRADE → $BRANCH (pre-call Know tab UI)"
echo " Repo: $REPO_ROOT"
echo "=============================================="

if [[ ! -d "$REPO_ROOT/.git" ]]; then
  echo "ERROR: $REPO_ROOT is not a git repo." >&2
  exit 1
fi

echo "=== Before ==="
git -C "$REPO_ROOT" log -1 --oneline || true
git -C "$REPO_ROOT" remote get-url origin || true

echo "=== Fetch $BRANCH ==="
bash "$DEPLOY_DIR/git-fetch-origin.sh" "$REPO_ROOT" "$BRANCH"

echo "=== Checkout $BRANCH ==="
cd "$REPO_ROOT"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
echo "=== After checkout: $(git log -1 --oneline) ==="

if ! grep -q 'postcall-intake-card' "$REPO_ROOT/web/index.html"; then
  echo "ERROR: web/index.html missing postcall-intake-card after checkout." >&2
  exit 1
fi

echo "=== Deploy (rebuild worker + restart web) ==="
exec bash "$DEPLOY_DIR/update.sh" "$@"
