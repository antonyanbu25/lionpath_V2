#!/usr/bin/env bash
# Query GLM-5.2 for a failproof fix plan for the 4 UI regressions.
set -euo pipefail

KEY=$(grep '^HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY=' ~/.hermes/.env | head -1 | cut -d= -f2-)
ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-four-UI-regressions-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
root-caused four UI regressions on the Lionpath SE portal (branch 2.1). Give a FAILPROOF,
bug-free implementation plan for Codex (gpt-5.5) to implement. Be precise: exact file paths,
exact edits, verification. Do NOT write full code — exact steps and exact code snippets for the
tricky parts.

HERE IS THE ANALYSIS:

$ANALYSIS

Deliver a plan covering, in order:
1. FIX A (calls-list-view.js): wireCallListClicks must run after the INITIAL innerHTML render,
   not only inside paint(). Give the exact change.
2. FIX B (dashboard.js recent activity): the coalesced in-place row diff (scheduleRecentActivityRender /
   updateRecentActivitySection) replaces/inserts .dash-call-link nodes that are never re-wired, and the
   delegated handler reads container._recentActivityOpts. Give the exact fix so newly inserted call rows
   are clickable. Prefer re-calling wireCallLinks on newly inserted rows, OR ensure the delegated
   listener + _recentActivityOpts are always current.
3. FIX C (dashboard KPI consistency): single source of truth. One reconcile function computes
   taskMetrics/callMetrics/prepsCount from reconciled local+remote and is the ONLY writer of the
   kpi snapshot. Skip snapshot write while remote pending. On render, prefer freshest reconciled source
   over stale cache. Give exact structure so the dashboard shows consistent numbers every load.
4. FIX D (precall scroll/truncation): make the brief result content region bounded with overflow:auto
   and reachable after the generation reveal (precall.css #prep-result-view / #prep-tabs / #view-precall).
   Give the exact CSS and any precall.js scroll reset.
5. Anti-regression + verification checklist (build, grep, manual toggles).

Also: commit strategy (one commit per file), and push to origin/2.1 at the end.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
