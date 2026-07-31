#!/usr/bin/env bash
# One-command VPS update — discards local git drift on deploy scripts, pulls, rebuilds worker.
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"

echo "=== Fetching origin/2.0.7.2 ==="
cd "$REPO_ROOT"
git fetch origin 2.0.7.2

echo "=== Resetting to origin/2.0.7.2 (keeps .env — gitignored) ==="
git checkout 2.0.7.2 2>/dev/null || git checkout -B 2.0.7.2
git reset --hard origin/2.0.7.2

cd "$REPO_ROOT/deploy/vps"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod +x start.sh setup.sh doctor.sh update.sh entrypoint-worker.sh 2>/dev/null || true
sed -i 's/\r$//' start.sh setup.sh doctor.sh update.sh entrypoint-worker.sh 2>/dev/null || true

if ! grep -q 'DEMO_ASSET_LABELS' "$REPO_ROOT/worker/src/prep-assets.ts" 2>/dev/null; then
  echo "ERROR: worker/src/prep-assets.ts missing DEMO_ASSET_LABELS — git reset did not apply." >&2
  echo "Run: cd $REPO_ROOT && git fetch origin && git reset --hard origin/2.0.7.2" >&2
  exit 1
fi

echo "=== Rebuilding worker (no cache) ==="
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
docker compose logs worker --tail 15

if ! docker compose exec -T worker node -e \
  "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Worker still not healthy. Full logs: docker compose logs worker" >&2
  exit 1
fi

echo ""
echo "Done. Test: curl -sI https://portalapi.benjaminsquare.com/api/config"
