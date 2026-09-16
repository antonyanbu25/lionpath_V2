#!/usr/bin/env bash
# Local dev only — worker (8787) + web UI (8788). No Cloudflare tunnel required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

for port in 8787 8788; do
  if lsof -ti :"$port" >/dev/null 2>&1; then
    echo "Port $port is already in use."
    echo "Stop existing dev servers first, or open:"
    echo "  Web:    http://localhost:8788"
    echo "  Worker: http://localhost:8787"
    exit 0
  fi
done

echo "Starting worker → http://localhost:8787"
echo "Starting web   → http://localhost:8788"
echo "Press Ctrl+C to stop both."
echo ""

trap 'kill 0 2>/dev/null || true' EXIT INT TERM

(cd "$ROOT/worker" && npm run dev) &
(cd "$ROOT/web" && npm run dev) &
wait
