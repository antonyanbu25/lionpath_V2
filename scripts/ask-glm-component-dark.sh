#!/usr/bin/env bash
# Query GLM-5.2 for failproof component-CSS dark-mode plan.
set -euo pipefail

ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-component-dark-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
analyzed why dark mode is incomplete on the Lionpath SE portal: the per-view component CSS
files (precall.css, call-view.css, postcall.css) hardcode light hexes and have ZERO
[data-theme="dark"] overrides, so cards like "About the company" stay pure white in dark mode.

Give a FAILPROOF, bug-free implementation plan for Codex (gpt-5.5). Be precise: exact file
paths, exact selectors, exact variable replacements. Do NOT write full code.

Here is the analysis:

$ANALYSIS

Deliver:
1. The exact strategy: replace surface/background/border/text light hexes with the correct
   --dew-* theme variables (list the mapping table). Explain why this is superior to hardcoding
   dark hexes or installing a dark-mode package.
2. For EACH file (precall.css, call-view.css, postcall.css, then finish lifecycle.css and
   styles.css), enumerate the specific rules/selectors to fix: the card backgrounds, tile
   backgrounds, text colors, borders. Prioritize the "About the company" card and fact tiles.
3. The exact set of [data-theme="dark"] overrides (if any) needed where a light value is
   intentional for light mode only.
4. A checklist of every section to visually verify in dark mode: prep-brief (About the company,
   fact tiles, news, support stack, maturity chart, unknowns, call plan, attendees), call view
   (timeline, transcript, score strip, AI attach callout, video facts), postcall (result cards,
   ARR/traction tiles).
5. Anti-regression: light mode must be unchanged; no hardcoded dark hexes; build passes.
Ordering + verification.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
