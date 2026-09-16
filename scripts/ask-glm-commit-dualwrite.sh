#!/usr/bin/env bash
# Query GLM-5.2 (neuralwatt) for the fix decision on the two post-call bugs.
set -euo pipefail

ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-commit-and-dualwrite-bugs.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
analyzed two production bugs in the Lionpath SE portal (branch 2.1). Your job: DECIDE the
fix approach for each bug — pick ONE option per bug, justify briefly, and give Codex
(gpt-5.5) a precise, bite-sized implementation plan with exact file paths and steps.
Do NOT write the full code — just the decision + plan. Be decisive.

Here is the analysis:

$ANALYSIS

Deliver:
1. BUG 1 decision (commit 500 / malformed JSON): which option, and the exact implementation steps for Codex.
2. BUG 2 decision (dual-write permission / deal owner mismatch): which option, and the exact implementation steps for Codex.
3. Any ordering (do bug 1 or bug 2 first) and verification steps.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
