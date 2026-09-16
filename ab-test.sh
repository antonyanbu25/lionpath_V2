#!/usr/bin/env bash
# A/B test effort levels for the prep portal.
# Runs each prospect at every effort level against a RUNNING worker (start it first with
# `cd worker && npm run dev`), saves each brief to ab-out/, and prints timing + a use-case
# preview so you can compare speed AND quality side by side.
#
# Usage:
#   ./ab-test.sh                         # medium vs high, default prospect list
#   ./ab-test.sh "low medium high"       # custom effort levels
#   URL=http://localhost:8787/api/generate-prep ./ab-test.sh
#
# Note: this makes (prospects x efforts) real API calls with web search — a handful of dollars
# of tokens/searches at most. Trim the list below to go faster/cheaper.

set -euo pipefail

URL="${URL:-http://localhost:8787/api/generate-prep}"
EFFORTS="${1:-medium high}"
OUT="ab-out"
mkdir -p "$OUT"

# company|contact-email  (real APAC companies with public help centres = good tech-stack signal)
PROSPECTS=(
  "GetGo|farhan@getgo.sg"
  "Carousell|support@carousell.com"
  "Love, Bonito|hello@lovebonito.com"
  "Circles.Life|hello@circles.life"
  "ShopBack|support@shopback.com"
)

echo "Endpoint: $URL"
echo "Efforts:  $EFFORTS"
echo "Output:   $OUT/"
echo

SUMMARY=""
for entry in "${PROSPECTS[@]}"; do
  name="${entry%%|*}"
  email="${entry##*|}"
  slug=$(printf '%s' "$name" | tr ' ,.' '___' | tr -d "'")
  for eff in $EFFORTS; do
    file="$OUT/${slug}-${eff}.json"
    printf '→ %-14s [%s] ... ' "$name" "$eff"
    t0=$(date +%s)
    http=$(curl -s --max-time 180 -o "$file" -w '%{http_code}' "$URL" \
      -H 'content-type: application/json' \
      -d "{\"companyName\":\"$name\",\"prospectEmail\":\"$email\",\"effort\":\"$eff\"}") || http="ERR"
    t1=$(date +%s)
    secs=$((t1 - t0))
    printf 'HTTP %s, %ss → %s\n' "$http" "$secs" "$file"
    SUMMARY="${SUMMARY}${name}\t${eff}\t${http}\t${secs}s\n"
    if command -v jq >/dev/null 2>&1; then
      jq -r '.error // (.prep.seActions.topUseCase // "-") | "     use case: \(.)"' "$file" 2>/dev/null || true
    fi
  done
  echo
done

echo "==================== SUMMARY ===================="
printf 'Company\tEffort\tHTTP\tTime\n'
printf "$SUMMARY"
echo
echo "Compare a pair, e.g.:"
echo "  diff <(jq -S . $OUT/GetGo-medium.json) <(jq -S . $OUT/GetGo-high.json)"
echo "Or just open the .json files in $OUT/ side by side."
