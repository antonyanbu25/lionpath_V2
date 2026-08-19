#!/usr/bin/env bash
# Emergency VPS repair — delegates to update.sh (2.0.8.1-merge release).
#   cd /opt/se-singha-paathai/deploy/vps && bash repair.sh
# Or full update:
#   cd /opt/se-singha-paathai/deploy/vps && bash update.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"

echo "=== SE Paathai VPS repair → update.sh (2.0.8.1-merge) ==="
exec bash "$DEPLOY_DIR/update.sh" "$@"
