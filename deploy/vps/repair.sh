#!/usr/bin/env bash
# Emergency VPS repair — run on the VPS after SSH (repo is private; do not curl from GitHub raw).
#   cd /opt/se-singha-paathai && git fetch origin 2.0.7.4 && git reset --hard origin/2.0.7.4 && cd deploy/vps && bash repair.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/se-singha-paathai}"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"

echo "=== SE Paathai VPS repair ==="
echo "Repo: $REPO_ROOT"

cd "$REPO_ROOT"
bash "$DEPLOY_DIR/git-fetch-origin.sh" "$REPO_ROOT" "2.0.7.4"
git checkout 2.0.7.4 2>/dev/null || git checkout -B 2.0.7.4
git reset --hard origin/2.0.7.4

PREP="$REPO_ROOT/worker/src/prep-assets.ts"
if ! grep -q 'DEMO_ASSET_LABELS' "$PREP" 2>/dev/null; then
  echo "=== Applying emergency DEMO_ASSET_LABELS patch ==="
  python3 - <<PY
import pathlib
p = pathlib.Path("$PREP")
t = p.read_text()
needle = "};\n\nfunction inferExt"
insert = "};\n\n/** Labels passed to demo-guidance so leadAsset references stay in the asset catalog. */\nexport const DEMO_ASSET_LABELS: string[] = Object.values(DEMO_CATALOG).map((e) => e.label);\n\nfunction inferExt"
if "DEMO_ASSET_LABELS" in t:
    print("Already patched")
elif needle in t:
    p.write_text(t.replace(needle, insert, 1))
    print("Patched DEMO_ASSET_LABELS")
else:
    raise SystemExit("Cannot patch prep-assets.ts — check repo path")
PY
fi

cd "$REPO_ROOT/deploy/vps"

if [[ ! -f .env ]]; then
  echo "ERROR: Missing deploy/vps/.env — copy .env.example and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod +x start.sh setup.sh doctor.sh update.sh repair.sh entrypoint-worker.sh git-fetch-origin.sh git-auth-diagnose.sh 2>/dev/null || true
sed -i 's/\r$//' start.sh setup.sh doctor.sh update.sh repair.sh entrypoint-worker.sh git-fetch-origin.sh git-auth-diagnose.sh 2>/dev/null || true

echo "=== Rebuilding worker (no cache — fixes stale COPY src layers) ==="
docker compose build --no-cache worker
docker compose up -d

echo "=== Waiting for worker (up to 90s) ==="
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  if docker compose exec -T worker node -e \
    "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    echo "Worker OK"
    break
  fi
  sleep 3
done

echo ""
docker compose ps
echo ""
docker compose logs worker --tail 20

if ! docker compose exec -T worker node -e \
  "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Worker still unhealthy. Paste: docker compose logs worker --tail 50" >&2
  exit 1
fi

echo ""
echo "Repair complete. Test: curl -sI https://portalapi.benjaminsquare.com/api/config"
