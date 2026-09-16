#!/usr/bin/env bash
# Secrets drift check — compares env var KEYS across all deploy targets (values are NOT printed).
# Run manually before deploying: bash deploy/scripts/check-secrets-drift.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Secrets drift check (KEYS only, values redacted) ==="
echo ""

# 1. VPS .env.example keys
VPS_KEYS=$(grep -oE '^[A-Z_]+=' "$REPO_ROOT/deploy/vps/.env.example" | sed 's/=//' | sort -u)
echo "--- VPS .env.example keys ---"
echo "$VPS_KEYS"
echo ""

# 2. Cloud Run first-deploy.sh env var keys (extract from --set-env-vars string)
CR_KEYS=$(grep -oE '[A-Z_]+=' "$REPO_ROOT/deploy/cloudrun/first-deploy.sh" | sed 's/=//' | sort -u)
echo "--- Cloud Run first-deploy.sh keys ---"
echo "$CR_KEYS"
echo ""

# 3. wrangler.toml [vars] keys
CF_KEYS=$(grep -oE '^[A-Z_]+ = ' "$REPO_ROOT/worker/wrangler.toml" | sed 's/ = //' | sort -u)
echo "--- Cloudflare wrangler.toml [vars] keys ---"
echo "$CF_KEYS"
echo ""

# 4. Drift report
echo "=== DRIFT REPORT ==="
echo ""
echo "Keys in VPS .env.example but NOT in Cloud Run first-deploy.sh:"
comm -23 <(echo "$VPS_KEYS") <(echo "$CR_KEYS") || true
echo ""
echo "Keys in Cloud Run first-deploy.sh but NOT in VPS .env.example:"
comm -13 <(echo "$VPS_KEYS") <(echo "$CR_KEYS") || true
echo ""
echo "Keys in wrangler.toml but NOT in VPS .env.example:"
comm -13 <(echo "$CF_KEYS") <(echo "$VPS_KEYS") || true
echo ""
echo "Keys in wrangler.toml but NOT in Cloud Run first-deploy.sh:"
comm -13 <(echo "$CF_KEYS") <(echo "$CR_KEYS") || true
echo ""
echo "=== End drift report ==="
echo "Review any unexpected keys above. Secrets should be consistent across targets"
echo "(except where a target genuinely doesn't need a secret, e.g. VPS doesn't need"
echo "GOOGLE_CLOUD_PROJECT since it uses GEMINI_API_KEY instead of Vertex AI)."
