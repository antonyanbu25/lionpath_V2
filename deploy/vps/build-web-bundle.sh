#!/usr/bin/env bash
# Build web/dist for production portal hosts (index.html loads ./dist/boot.js).
# Output is gitignored; nginx bind-mount serves ../../web including dist/.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
WEB="$REPO_ROOT/web"
INDEX="$WEB/index.html"

if [[ ! -f "$WEB/scripts/build.mjs" ]]; then
  echo "=== Skipping web/dist build (no web/scripts/build.mjs) ==="
  exit 0
fi
if ! grep -q 'dist/boot.js' "$INDEX" 2>/dev/null; then
  echo "=== Skipping web/dist build (index.html does not boot from dist/) ==="
  exit 0
fi

echo "=== Building web/dist (esbuild) ==="
if command -v npm >/dev/null 2>&1; then
  (cd "$WEB" && npm ci && npm run build)
else
  echo "npm not on PATH — using node:22-alpine container"
  docker run --rm -v "$WEB:/web" -w /web node:22-alpine sh -c "npm ci && npm run build"
fi

if [[ ! -f "$WEB/dist/boot.js" ]]; then
  echo "ERROR: $WEB/dist/boot.js missing after build." >&2
  exit 1
fi