#!/usr/bin/env bash
# One-command VPS update — discards local git drift on deploy scripts, pulls, rebuilds worker.
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"

echo "=== Fetching origin/2.0.7.2 ==="
cd "$REPO_ROOT"
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || echo "missing")"
echo "=== Git origin: $ORIGIN_URL ==="
if [[ "$ORIGIN_URL" != *"skut264/lionpath"* && "$ORIGIN_URL" != *"se-singha-paathai"* ]]; then
  echo "WARN: origin may be wrong. Expected github.com/skut264/lionpath.git" >&2
  echo "      Fix: git remote set-url origin https://github.com/skut264/lionpath.git" >&2
fi
if ! git fetch origin 2.0.7.2; then
  echo "ERROR: git fetch failed — check VPS deploy key / GitHub credentials for private repo." >&2
  exit 1
fi

echo "=== Resetting to origin/2.0.7.2 (keeps .env — gitignored) ==="
git checkout 2.0.7.2 2>/dev/null || git checkout -B 2.0.7.2
git reset --hard origin/2.0.7.2
echo "=== Deployed commit: $(git log -1 --oneline) ==="

if ! grep -q 'precall.css?v=2.0.8-precall-align2' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "ERROR: web/index.html missing precall-align2 after reset — git pull did not apply." >&2
  echo "       Run: git remote -v && git fetch origin && git log -1 origin/2.0.7.2 --oneline" >&2
  exit 1
fi

cd "$REPO_ROOT/deploy/vps"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod +x start.sh setup.sh doctor.sh update.sh verify-deploy.sh entrypoint-worker.sh 2>/dev/null || true
sed -i 's/\r$//' start.sh setup.sh doctor.sh update.sh verify-deploy.sh entrypoint-worker.sh 2>/dev/null || true

if ! grep -q 'DEMO_ASSET_LABELS' "$REPO_ROOT/worker/src/prep-assets.ts" 2>/dev/null; then
  echo "ERROR: worker/src/prep-assets.ts missing DEMO_ASSET_LABELS — git reset did not apply." >&2
  echo "Run: cd $REPO_ROOT && git fetch origin && git reset --hard origin/2.0.7.2" >&2
  exit 1
fi

PORTAL_BUILD="$(grep -o 'portal-build" content="[^"]*"' "$REPO_ROOT/web/index.html" 2>/dev/null | head -1 || true)"
if [[ -z "$PORTAL_BUILD" ]]; then
  echo "WARN: web/index.html has no portal-build meta — web UI may be stale." >&2
else
  echo "=== Portal build: $PORTAL_BUILD ==="
fi
if ! grep -q 'New pre-call brief' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "WARN: web/index.html still has old pre-call form — git reset may not have applied." >&2
fi
if ! grep -q 'domain-cache' "$REPO_ROOT/worker/src/build-id.ts" 2>/dev/null; then
  echo "WARN: worker build-id.ts missing domain-cache stamp — worker speed fixes may be stale." >&2
fi

echo "=== Rebuilding worker (no cache) ==="
docker compose build --no-cache worker
docker compose up -d --force-recreate web
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
echo "=== verify-deploy.sh ==="
bash verify-deploy.sh
