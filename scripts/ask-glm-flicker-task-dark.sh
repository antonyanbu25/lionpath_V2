#!/usr/bin/env bash
# Query GLM-5.2 for failproof fixes: dashboard flicker, task board, calls load, dark-mode.
set -euo pipefail

ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-flicker-task-dark-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
analyzed four issues on the Lionpath SE portal. Give a FAILPROOF, bug-free implementation
plan for Codex (gpt-5.5). Be precise: exact file paths, exact changes, verification. Do NOT
write full code — exact steps.

Here is the analysis:

$ANALYSIS

Deliver:
1. Dashboard recent-activity flicker — exact fix. Pick ONE approach (in-place row patch vs
   coalesce the 3 section-rebuild sources vs both). Give exact steps.
2. Task board — hide "What should I do now?" heading + quick-add form; Recommended section on
   top. Exact steps in tasks.js renderTaskBoard.
3. #calls loading shell — dismiss when records render, enrich in place. Exact steps in
   calls-list-view.js.
4. DARK MODE — this is the big one. Walk EVERY UI element across web/styles.css and
   web/lifecycle.css (and any component css): sidebar + hovers, nav items, buttons, cards,
   inputs, selects, dropdowns, tooltips, modals, KPI tiles, task rows, tables. For EACH give the
   exact [data-theme="dark"] override using dark-surface variables. Call out the specific
   "sidebar hover too bright / unreadable" bug and fix it. This must be exhaustive and bug-free.
Ordering + verification for all four.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
