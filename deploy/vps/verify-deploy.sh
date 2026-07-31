#!/usr/bin/env bash
# Verify portal + worker are on the domain-cache speed release.
set -euo pipefail

API="${PORTAL_API:-https://portalapi.benjaminsquare.com/api/config}"
WEB="${PORTAL_WEB:-https://portal.benjaminsquare.com/}"

echo "=== API ==="
CONFIG="$(curl -sf "$API")"
echo "$CONFIG" | head -c 400
echo ""

WORKER_BUILD="$(echo "$CONFIG" | grep -o '"workerBuild":"[^"]*"' | cut -d'"' -f4 || true)"
echo "workerBuild=${WORKER_BUILD:-MISSING}"

echo ""
echo "=== Portal HTML ==="
HTML="$(curl -sf "$WEB")"
PORTAL_BUILD="$(echo "$HTML" | grep -o 'portal-build" content="[^"]*"' | cut -d'"' -f3 || true)"
echo "portal-build=${PORTAL_BUILD:-MISSING}"

FAIL=0
if [[ -z "$WORKER_BUILD" ]] || [[ "$WORKER_BUILD" != *domain-cache* ]]; then
  echo "FAIL: worker missing domain-cache build — run: bash update.sh" >&2
  FAIL=1
fi
if [[ -z "$PORTAL_BUILD" ]] || [[ "$PORTAL_BUILD" != *domain-cache* ]]; then
  echo "FAIL: portal missing domain-cache build — run: bash update.sh" >&2
  FAIL=1
fi
if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: domain-cache release is live on portal and worker."
fi
exit "$FAIL"
