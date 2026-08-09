#!/usr/bin/env bash
# Query GLM-5.2 (neuralwatt) for the realtime architecture decision.
set -euo pipefail

ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-realtime-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
analyzed why the Lionpath SE portal dashboard/deal/call views are not near-realtime and
proposed options. Your job: DECIDE the approach, justify briefly, and give Codex (gpt-5.5)
a precise, bite-sized implementation plan with exact file paths and steps. Do NOT write the
full code — just the decision + plan. Be decisive.

Here is the analysis:

$ANALYSIS

Deliver:
1. DECISION: which option (A: Firestore realtime listeners for reads; B: SSE/WebSocket push;
   C: BigQuery/RAG). Pick ONE primary approach. Confirm or reject the recommendation.
2. If Option A: the exact implementation steps for Codex — how to make production reads
   realtime via onSnapshot while keeping the API store for admin writes. Address the
   firestore.rules read-access verification. Address the two UI bugs (timeline not loaded,
   slow ARR bar) as part of the plan.
3. Ordering and verification steps.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
