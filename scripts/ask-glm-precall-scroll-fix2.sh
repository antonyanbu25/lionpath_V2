#!/usr/bin/env bash
# Query GLM-5.2 to DECIDE the fix for the pre-call brief scroll (still broken after FIX D).
set -euo pipefail

KEY=$(grep '^HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY=' ~/.hermes/.env | head -1 | cut -d= -f2-)
ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-precall-scroll-fix2-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (investigator) root-caused why the
Lionpath SE portal pre-call brief STILL cannot scroll below "How big is this fish?" even after two
prior "bounded flex chain" fixes shipped today. The root cause is the Crayons fw-tabs shadow DOM:
fw-tabs.scss sets .tabs { height: var(--fw-tabs-height, inherit) }, --fw-tabs-height is never set, and
the host #prep-tabs computed height is auto, so the shadow .tabs container is unbounded; the inner
.prep-tab-panel-wrap overflow-y:auto never activates, while the outer :has chain forces 100vh +
overflow:hidden, clipping the content.

HERE IS GIDEON'S ANALYSIS (with two candidate approaches):

$ANALYSIS

DECIDE and produce a FAILPROOF, bug-free implementation plan for Codex (gpt-5.5). Requirements:
1. Choose Approach 1 (add height:100% to #prep-tabs so the shadow .tabs inherits a definite height)
   OR Approach 2 (remove the 100vh/overflow:hidden lockdown so the pre-call result scrolls with the
   document like post-call), OR a hybrid. Justify the decision briefly.
2. Give EXACT file paths and EXACT edits (CSS only, unless JS is needed). Precise selectors.
3. Note: #prep-tabs fw-tab-panel is already flex:1; min-height:0; overflow:hidden (precall.css:1097)
   and .prep-tab-panel-wrap already overflow-y:auto (precall.css:1105). If the height:100% fix needs
   anything on #prep-result-view or the :has chain, say exactly what.
4. Anti-regression checklist: npm run build must pass; grep guard; manual scroll test on both tabs.
5. Commit strategy: one commit, message format "fix(precall): ...".

Deliver only the plan.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
