#!/usr/bin/env bash
# One-command VPS update â€” discards local git drift on deploy scripts, pulls, rebuilds worker.
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"

# Fetch + reset first, then re-exec so post-reset guards read the freshly pulled update.sh
# (otherwise a running copy still checks old cache-bust strings from before git reset --hard).
if [[ "${UPDATE_POST_RESET:-}" != "1" ]]; then
  echo "=== Fetching origin/2.1 ==="
  bash "$DEPLOY_DIR/git-fetch-origin.sh" "$REPO_ROOT" "2.1"

  echo "=== Resetting to origin/2.1 (keeps .env â€” gitignored) ==="
  cd "$REPO_ROOT"
  git checkout 2.1 2>/dev/null || git checkout -B 2.1
  git reset --hard "origin/2.1"
  echo "=== Deployed commit: $(git log -1 --oneline) ==="

  export UPDATE_POST_RESET=1
  exec bash "$REPO_ROOT/deploy/vps/update.sh" "$@"
fi

cd "$DEPLOY_DIR"

if ! grep -q 'precall.css?v=2.1' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "ERROR: web/index.html missing 2.1 precall cache-bust after reset â€” git pull did not apply." >&2
  echo "       Run: bash $DEPLOY_DIR/git-auth-diagnose.sh" >&2
  grep -E 'portal-build|precall.css|app.js' "$REPO_ROOT/web/index.html" 2>/dev/null | head -5 >&2 || true
  exit 1
fi

if ! grep -qE 'portal-build" content="2\.1(\.[0-9]+)?(-[a-z0-9-]+)?"' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "ERROR: web/index.html portal-build is not a 2.1.x release after reset (expected 2.1, 2.1.N, or 2.1.N-suffix)." >&2
  grep 'portal-build' "$REPO_ROOT/web/index.html" 2>/dev/null | head -1 >&2 || true
  exit 1
fi

if ! grep -q 'postcall-intake-card' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "ERROR: web/index.html missing postcall-intake-card â€” git reset did not apply 2.1 postcall UI." >&2
  exit 1
fi

if ! grep -q 'pc-account-deal-preview' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "ERROR: web/index.html missing pc-account-deal-preview â€” git reset did not apply account/deal tile picker." >&2
  exit 1
fi

if ! grep -qF 'postcall.css?v=2.1' "$REPO_ROOT/web/index.html" 2>/dev/null; then
  echo "ERROR: web/index.html missing postcall.css?v=2.1 cache-bust after reset." >&2
  grep -E 'portal-build|postcall.css' "$REPO_ROOT/web/index.html" 2>/dev/null | head -3 >&2 || true
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env â€” copy .env.example and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod +x start.sh setup.sh doctor.sh update.sh verify-deploy.sh refresh-web.sh build-web-bundle.sh entrypoint-worker.sh git-fetch-origin.sh git-auth-diagnose.sh 2>/dev/null || true
sed -i 's/\r$//' start.sh setup.sh doctor.sh update.sh verify-deploy.sh refresh-web.sh build-web-bundle.sh entrypoint-worker.sh git-fetch-origin.sh git-auth-diagnose.sh 2>/dev/null || true

if ! grep -q 'DEMO_ASSET_LABELS' "$REPO_ROOT/worker/src/prep-assets.ts" 2>/dev/null; then
  echo "ERROR: worker/src/prep-assets.ts missing DEMO_ASSET_LABELS â€” git reset did not apply." >&2
  exit 1
fi

PORTAL_BUILD="$(grep -o 'portal-build" content="[^"]*"' "$REPO_ROOT/web/index.html" 2>/dev/null | head -1 || true)"
if [[ -z "$PORTAL_BUILD" ]]; then
  echo "WARN: web/index.html has no portal-build meta â€” web UI may be stale." >&2
else
  echo "=== Portal build: $PORTAL_BUILD ==="
fi

if [[ "${SKIP_TEST_GATE:-}" == "1" ]]; then
  echo "=== Test gate: SKIPPED (SKIP_TEST_GATE=1) ==="
else
  echo "=== Test gate: worker (fast/free tests only) ==="
  docker build -f "$DEPLOY_DIR/Dockerfile.worker-test" -t se-paathai-worker-test "$REPO_ROOT"
  docker run --rm se-paathai-worker-test

  echo "=== Test gate: web (fast/free tests only) ==="
  # Mount read-only, then copy to a writable path inside the container before
  # `npm ci` — mounting read-write would let Alpine-installed native binaries
  # (esbuild, playwright) leak back into the host's web/node_modules, which
  # would then mismatch the host's actual OS/libc on next local `npm install`.
  docker run --rm -v "$REPO_ROOT/web:/src:ro" node:20-alpine \
    sh -c "cp -r /src /app && cd /app && npm ci --no-audit --no-fund && npm run test:fast"

  echo "=== Test gate: PASSED ==="
fi

echo "=== Building portal bundle (web/dist) ==="
bash "$DEPLOY_DIR/build-web-bundle.sh"

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
