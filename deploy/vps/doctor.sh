#!/usr/bin/env bash
# Diagnose VPS stack — run from deploy/vps on the server.
set -euo pipefail

cd "$(dirname "$0")"

echo "=== docker compose ps ==="
docker compose ps -a

echo ""
echo "=== .env checks ==="
if [[ ! -f .env ]]; then
  echo "MISSING .env — copy .env.example and set GEMINI_API_KEY"
else
  grep -E '^(GEMINI_API_KEY|ALLOWED_ORIGINS|FRESHDESK_DOMAIN|FRESHDESK_API_KEY)=' .env \
    | sed 's/GEMINI_API_KEY=.*/GEMINI_API_KEY=***redacted***/' \
    | sed 's/FRESHDESK_API_KEY=.*/FRESHDESK_API_KEY=***redacted***/'
  if grep -qE 'ALLOWED_ORIGINS=.*lionpath' .env 2>/dev/null; then
    echo "WARN: ALLOWED_ORIGINS still references lionpath — update to https://portal.benjaminsquare.com"
  fi
  if grep -qE 'GEMINI_API_KEY=(your-gemini-api-key-here)?$' .env 2>/dev/null || ! grep -q '^GEMINI_API_KEY=.\+' .env; then
    echo "WARN: GEMINI_API_KEY missing or placeholder — worker will not start"
  fi
  if ! grep -qE '^FRESHDESK_API_KEY=.+' .env 2>/dev/null \
    || grep -qE '^FRESHDESK_API_KEY=(your-freshdesk-api-key)?$' .env 2>/dev/null; then
    echo "WARN: FRESHDESK_API_KEY missing or placeholder — Dispute/Feedback tickets will 503"
  fi
  if ! grep -qE '^FRESHDESK_DOMAIN=.+' .env 2>/dev/null; then
    echo "WARN: FRESHDESK_DOMAIN missing — default is janus-assist.freshdesk.com if unset in code"
  fi
fi

echo ""
echo "=== worker logs (last 40 lines) ==="
docker compose logs worker --tail 40 2>/dev/null || echo "(no worker logs)"

echo ""
echo "=== internal worker probe ==="
docker compose exec -T worker node -e \
  "fetch('http://127.0.0.1:8787/api/config').then(async r=>{console.log('status',r.status); process.exit(r.ok?0:1)}).catch(e=>{console.error(e); process.exit(1)})" \
  2>/dev/null && echo "Worker responds internally" || echo "Worker NOT responding on :8787"

echo ""
echo "=== git / GitHub auth (deploy) ==="
REPO_ROOT="$(cd ../.. && pwd)"
if [[ -x "$REPO_ROOT/deploy/vps/git-auth-diagnose.sh" ]]; then
  bash "$REPO_ROOT/deploy/vps/git-auth-diagnose.sh" "$REPO_ROOT"
else
  echo "(git-auth-diagnose.sh not found — pull latest repo or copy script manually)"
fi

echo ""
echo "=== public API probe ==="
if command -v curl >/dev/null 2>&1; then
  curl -sI https://portalapi.benjaminsquare.com/api/config | head -5
  echo ""
  curl -sI -H "Origin: https://portal.benjaminsquare.com" \
    https://portalapi.benjaminsquare.com/api/config | grep -i access-control || true
else
  echo "(curl not installed — skip public probe)"
fi
