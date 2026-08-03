#!/usr/bin/env bash
# Verify portal + worker are on the domain-cache speed release.
set -euo pipefail

API="${PORTAL_API:-https://portalapi.benjaminsquare.com/api/config}"
WEB="${PORTAL_WEB:-https://portal.benjaminsquare.com/}"

echo "=== API ==="
CONFIG="$(curl -sf "$API")"
echo "$CONFIG" | head -c 400
echo ""

SCHEMA_FIX="$(echo "$CONFIG" | grep -o '"geminiSchemaEnumFix":"[^"]*"' | cut -d'"' -f4 || true)"
echo "geminiSchemaEnumFix=${SCHEMA_FIX:-MISSING}"

echo ""
echo "=== Portal HTML ==="
HTML="$(curl -sf "$WEB")"
PORTAL_BUILD="$(echo "$HTML" | grep -o 'portal-build" content="[^"]*"' | cut -d'"' -f3 || true)"
echo "portal-build=${PORTAL_BUILD:-MISSING}"

FAIL=0
if [[ -z "$WORKER_BUILD" ]] || [[ "$WORKER_BUILD" != *2.0.8.1-merge* ]]; then
  echo "FAIL: worker missing 2.0.8.1-merge build — run: bash update.sh" >&2
  FAIL=1
fi
if [[ -z "$SCHEMA_FIX" ]]; then
  echo "FAIL: worker missing geminiSchemaEnumFix — postcall scorecard Gemini 400 not patched" >&2
  FAIL=1
fi
if [[ -z "$PORTAL_BUILD" ]] || [[ "$PORTAL_BUILD" != *2.0.8.1-merge* ]]; then
  echo "FAIL: portal missing 2.0.8.1-merge build — run: bash update.sh" >&2
  FAIL=1
fi
if ! echo "$HTML" | grep -q 'precall.css?v=2.0.8.1-merge'; then
  echo "FAIL: precall.css cache-bust missing — portal HTML is stale" >&2
  FAIL=1
fi
if ! echo "$HTML" | grep -q 'postcall.css?v=2.0.8.1-merge'; then
  echo "FAIL: postcall.css cache-bust missing — portal HTML is stale" >&2
  FAIL=1
fi
if ! echo "$HTML" | grep -q 'postcall-intake-card'; then
  echo "FAIL: postcall intake UI missing (postcall-intake-card) — old post-call form still deployed" >&2
  FAIL=1
fi
if ! echo "$HTML" | grep -q 'pc-account-deal-preview'; then
  echo "FAIL: postcall account-deal preview missing — old post-call form still deployed" >&2
  FAIL=1
fi
if echo "$HTML" | grep -q 'id="pc-company-name"'; then
  echo "FAIL: legacy pc-company-name field still present — old post-call form deployed" >&2
  FAIL=1
fi
if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: 2.0.8.1-merge release is live on portal and worker."
fi
exit "$FAIL"
