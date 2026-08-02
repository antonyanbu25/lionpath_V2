#!/usr/bin/env bash
# Start (or restart) the SE Singha Paathai VPS stack.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod 600 .env 2>/dev/null || true

REPO_ROOT="$(cd ../.. && pwd)"
PREP_ASSETS="$REPO_ROOT/worker/src/prep-assets.ts"
if ! grep -q 'DEMO_ASSET_LABELS' "$PREP_ASSETS" 2>/dev/null; then
  echo "ERROR: Worker source is stale (missing DEMO_ASSET_LABELS export)." >&2
  echo "       Your git pull likely failed. Run: bash repair.sh" >&2
  echo "       Or:  cd $REPO_ROOT && git fetch origin && git reset --hard origin/2.0.7.4" >&2
  exit 1
fi

# Warn when CORS still points at pre-migration lionpath hostnames.
if grep -qE 'ALLOWED_ORIGINS=.*lionpath' .env 2>/dev/null; then
  echo "WARNING: .env ALLOWED_ORIGINS still references lionpath.* — update to https://portal.benjaminsquare.com" >&2
  echo "         Browsers on portal.benjaminsquare.com will block API calls until you fix this." >&2
fi

docker compose pull --ignore-pull-failures 2>/dev/null || true
docker compose build --no-cache worker
docker compose up -d

echo ""
echo "Waiting for worker to become healthy (up to 90s)..."
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  if docker compose exec -T worker node -e \
    "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    echo "Worker is up."
    break
  fi
  sleep 3
done

echo ""
echo "Stack status:"
docker compose ps

if ! docker compose exec -T worker node -e \
  "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Worker still not healthy. Run: ./doctor.sh" >&2
  echo "       Common fixes: set GEMINI_API_KEY in .env, then ./start.sh again" >&2
  docker compose logs worker --tail 30 >&2
  exit 1
fi

echo ""
echo "Logs:  docker compose logs -f worker"
echo "Diag:  ./doctor.sh"
echo "Stop:  docker compose down"
