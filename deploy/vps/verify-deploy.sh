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
WORKER_BUILD="$(echo "$CONFIG" | grep -o '"workerBuild":"[^"]*"' | cut -d'"' -f4 || true)"
echo "workerBuild=${WORKER_BUILD:-MISSING}"
echo "geminiSchemaEnumFix=${SCHEMA_FIX:-MISSING}"

echo ""
echo "=== Portal HTML ==="
HTML="$(curl -sf "$WEB")"
PORTAL_BUILD="$(echo "$HTML" | grep -o 'portal-build" content="[^"]*"' | cut -d'"' -f3 || true)"
echo "portal-build=${PORTAL_BUILD:-MISSING}"

FAIL=0
if [[ -z "$WORKER_BUILD" ]] || [[ "$WORKER_BUILD" != *2.1* ]]; then
  echo "FAIL: workerBuild must include 2.1 (got: ${WORKER_BUILD:-MISSING}) — run: bash upgrade-now.sh" >&2
  FAIL=1
fi
if [[ -z "$SCHEMA_FIX" ]]; then
  echo "FAIL: worker missing geminiSchemaEnumFix — postcall scorecard Gemini 400 not patched" >&2
  FAIL=1
fi
if [[ -z "$PORTAL_BUILD" ]] || [[ ! "$PORTAL_BUILD" =~ ^2\.1(\.[0-9]+)?(-[a-z0-9-]+)?$ ]]; then
  echo "FAIL: portal-build must be 2.1.x (got: ${PORTAL_BUILD:-MISSING}) — run: bash refresh-web.sh" >&2
  FAIL=1
fi
PRECALL_HREF="$(echo "$HTML" | grep -o 'href="[^"]*precall\.css[^"]*"' | head -1 || true)"
POSTCALL_HREF="$(echo "$HTML" | grep -o 'href="[^"]*postcall\.css[^"]*"' | head -1 || true)"
APP_JS="$(echo "$HTML" | grep -o 'app\.js?v=[^"`]*' | head -1 || true)"
MODULE_BOOT="$(echo "$HTML" | grep -q 'app\.js?v=\${MODULE_BUILD}' && echo dynamic || echo static)"
echo "precall-link=${PRECALL_HREF:-MISSING}"
echo "postcall-link=${POSTCALL_HREF:-MISSING}"
echo "app-js=${APP_JS:-MISSING} (${MODULE_BOOT} cache bust)"

if [[ -z "$PRECALL_HREF" ]] || [[ ! "$PRECALL_HREF" =~ precall\.css\?v=2\.1(\.[0-9]+)? ]]; then
  echo "FAIL: precall.css?v=2.1 missing — portal HTML is stale (git checkout 2.1 or refresh-web.sh)" >&2
  FAIL=1
fi
if [[ -z "$POSTCALL_HREF" ]] || [[ ! "$POSTCALL_HREF" =~ postcall\.css\?v=2\.1(\.[0-9]+)? ]]; then
  echo "FAIL: postcall.css?v=2.1 missing — portal HTML is stale (git checkout 2.1 or refresh-web.sh)" >&2
  FAIL=1
fi
PRECALL_VER="$(echo "$PRECALL_HREF" | grep -oE 'v=2\.1(\.[0-9]+)?(-[a-z0-9-]+)?' | head -1 | sed 's/^v=//' || true)"
POSTCALL_VER="$(echo "$POSTCALL_HREF" | grep -oE 'v=2\.1(\.[0-9]+)?(-[a-z0-9-]+)?' | head -1 | sed 's/^v=//' || true)"
if [[ -n "$PORTAL_BUILD" && -n "$POSTCALL_VER" && "$POSTCALL_VER" != "$PORTAL_BUILD" ]]; then
  echo "FAIL: postcall.css?v=${POSTCALL_VER} != portal-build=${PORTAL_BUILD} — stale postcall cache bust (run refresh-web.sh)" >&2
  FAIL=1
fi
if [[ -n "$PORTAL_BUILD" && -n "$PRECALL_VER" && "$PRECALL_VER" != "$PORTAL_BUILD" ]]; then
  echo "FAIL: precall.css?v=${PRECALL_VER} != portal-build=${PORTAL_BUILD} — stale precall cache bust (run refresh-web.sh)" >&2
  FAIL=1
fi

APP_BUILD=""
if echo "$HTML" | grep -qE 'app\.js\?v=2\.1\.([7-9]|[1-9][0-9]+)'; then
  APP_BUILD="$(echo "$HTML" | grep -oE 'app\.js\?v=2\.1\.[0-9]+' | head -1 | sed 's/.*=//')"
elif echo "$HTML" | grep -q 'app\.js?v=\${MODULE_BUILD}'; then
  WEB_BASE="${WEB%/}"
  FB_CONFIG="$(curl -sf "${WEB_BASE}/firebase-config.js" || true)"
  APP_BUILD="$(echo "$FB_CONFIG" | grep -oE 'AUTH_BUILD_ID = "[^"]+"' | head -1 | cut -d'"' -f2 || true)"
  if [[ -z "$APP_BUILD" ]]; then
    APP_BUILD="$(echo "$FB_CONFIG" | grep -oE 'MODULE_BUILD = "[^"]+"' | head -1 | cut -d'"' -f2 || true)"
  fi
  echo "module-build=${APP_BUILD:-MISSING} (from firebase-config.js)"
fi
if [[ -z "$APP_BUILD" ]] || [[ ! "$APP_BUILD" =~ ^2\.1\.([7-9]|[1-9][0-9]+) ]]; then
  echo "FAIL: app.js must be v2.1.7+ for news detail fix (got: ${APP_BUILD:-${APP_JS:-MISSING}}) — run: bash upgrade-now.sh" >&2
  FAIL=1
fi
if ! echo "$HTML" | grep -q 'postcall.css?v=2.0.8.1-merge'; then
  echo "WARN: postcall.css?v=2.0.8.1-merge not found (may be OK on 2.1 branch)" >&2
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
  echo "OK: 2.1 release is live on portal and worker."
fi
exit "$FAIL"
