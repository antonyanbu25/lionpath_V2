#!/usr/bin/env bash
# Start (or restart) the SE Singha Paathai VPS stack.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod 600 .env 2>/dev/null || true

# Warn when CORS still points at pre-migration lionpath hostnames.
if grep -qE 'ALLOWED_ORIGINS=.*lionpath' .env 2>/dev/null; then
  echo "WARNING: .env ALLOWED_ORIGINS still references lionpath.* — update to https://portal.benjaminsquare.com" >&2
  echo "         Browsers on portal.benjaminsquare.com will block API calls until you fix this." >&2
fi

docker compose pull --ignore-pull-failures 2>/dev/null || true
docker compose build --pull
docker compose up -d

echo ""
echo "Stack running. Check status:"
docker compose ps
echo ""
echo "Logs:  docker compose logs -f"
echo "Stop:  docker compose down"
