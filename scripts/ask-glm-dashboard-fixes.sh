#!/usr/bin/env bash
# Query GLM-5.2 for failproof fixes to the dashboard/calls/deal issues.
set -euo pipefail

ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-dashboard-fixes-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
analyzed five issues on the Lionpath SE portal dashboard + calls page + deal page. Give a
FAILPROOF, bug-free implementation plan for Codex (gpt-5.5). Be precise: exact file paths,
exact changes, verification. Do NOT write full code — exact steps.

Here is the analysis:

$ANALYSIS

Deliver:
1. A) Dashboard calls counter — exact fix for owner-id resolution in buildSubscribeRemoteCalls / buildSubscribeRemotePreps (app.js). What id should the query use, and how to resolve it consistently with the write path?
2. B) Recent activity not clickable — exact fix (wireCallLinks after outerHTML refresh in dashboard.js).
3. C) Briefs counter — same owner-id fix.
4. D) #calls slow — exact batching fix for enrichDealsAndAccounts.
5. E) Deal-page ARR tile late + dashboard KPI grid flicker — in-place patch, single ARR mount.
Ordering + verification for all.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
