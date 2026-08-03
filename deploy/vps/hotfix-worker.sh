#!/usr/bin/env bash
# Hotfix worker 502 WITHOUT git pull — patches missing DEMO_ASSET_LABELS and rebuilds.
# Use when git pull is blocked but you have SSH access.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
PREP="$REPO_ROOT/worker/src/prep-assets.ts"

if [[ ! -f "$PREP" ]]; then
  echo "ERROR: $PREP not found" >&2
  exit 1
fi

echo "=== Checking worker source ==="
python3 - <<PY
import pathlib
p = pathlib.Path("$PREP")
t = p.read_text()
needle = "};\n\nfunction inferExt"
insert = "};\n\n/** Labels passed to demo-guidance so leadAsset references stay in the asset catalog. */\nexport const DEMO_ASSET_LABELS: string[] = Object.values(DEMO_CATALOG).map((e) => e.label);\n\nfunction inferExt"
if "DEMO_ASSET_LABELS" in t:
    print("DEMO_ASSET_LABELS already present — skip patch")
elif needle in t:
    p.write_text(t.replace(needle, insert, 1))
    print("Patched DEMO_ASSET_LABELS into prep-assets.ts")
else:
    raise SystemExit("Cannot patch prep-assets.ts — file layout changed; run git reset --hard origin/2.0.7.2")
PY

cd "$REPO_ROOT/deploy/vps"
if [[ ! -f .env ]]; then
  echo "ERROR: Missing deploy/vps/.env" >&2
  exit 1
fi

echo "WARN: This script does NOT update web/index.html — portal HTML may stay stale." >&2
echo "      After worker hotfix, run: bash $REPO_ROOT/deploy/vps/refresh-web.sh" >&2

echo "=== Rebuilding worker (no cache) ==="
docker compose build --no-cache worker
docker compose up -d

echo "=== Waiting 8s for worker boot ==="
sleep 8
docker compose logs worker --tail 25

if docker compose exec -T worker node -e \
  "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; then
  echo ""
  echo "Worker healthy locally."
  curl -sI https://portalapi.benjaminsquare.com/api/config | head -1 || true
else
  echo ""
  echo "ERROR: Worker still unhealthy. Run: docker compose logs worker --tail 50" >&2
  exit 1
fi
