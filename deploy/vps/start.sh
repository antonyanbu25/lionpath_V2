#!/usr/bin/env bash
# Start (or restart) the SE Singha Paathai VPS stack.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and set GEMINI_API_KEY." >&2
  exit 1
fi

chmod 600 .env 2>/dev/null || true

docker compose pull --ignore-pull-failures 2>/dev/null || true
docker compose build --pull
docker compose up -d

echo ""
echo "Stack running. Check status:"
docker compose ps
echo ""
echo "Logs:  docker compose logs -f"
echo "Stop:  docker compose down"
