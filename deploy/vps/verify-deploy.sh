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
if [[ -z "$WORKER_BUILD" ]] || [[ "$WORKER_BUILD" != *2.0.7.4-domain-cache* ]]; then
  echo "FAIL: worker missing 2.0.7.4-domain-cache build — run: bash update.sh" >&2
  FAIL=1
fi
if [[ -z "$PORTAL_BUILD" ]] || [[ "$PORTAL_BUILD" != *2.0.7.4-precall-align4* ]]; then
  echo "FAIL: portal missing 2.0.7.4-precall-align4 build — run: bash update.sh" >&2
  FAIL=1
fi
if ! echo "$HTML" | grep -q 'precall.css?v=2.0.7.4-precall-align4'; then
  echo "FAIL: precall.css cache-bust missing — portal HTML is stale" >&2
  FAIL=1
fi
if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: 2.0.7.4 release is live on portal and worker."
fi
exit "$FAIL"
