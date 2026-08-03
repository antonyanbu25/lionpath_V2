#!/usr/bin/env bash
# One-time bootstrap from an older VPS checkout (e.g. 2.0.7.4) onto 2.0.8.1-merge.
# Safe to run when `update.sh` still fetches 2.0.7.4 — passes branch explicitly to git-fetch.
#
#   cd /opt/se-singha-paathai/deploy/vps && bash bootstrap-2.0.8.1-merge.sh
#
# If this file is not on the VPS yet, run manually:
#   cd /opt/se-singha-paathai
#   bash deploy/vps/git-fetch-origin.sh . 2.0.8.1-merge
#   git checkout -B 2.0.8.1-merge origin/2.0.8.1-merge
#   cd deploy/vps && bash update.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
BRANCH="2.0.8.1-merge"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"

echo "=== Bootstrap $BRANCH (postcall QIP + precall merge) ==="
bash "$DEPLOY_DIR/git-fetch-origin.sh" "$REPO_ROOT" "$BRANCH"
cd "$REPO_ROOT"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
echo "=== Checked out: $(git log -1 --oneline) ==="
exec bash "$DEPLOY_DIR/update.sh" "$@"
