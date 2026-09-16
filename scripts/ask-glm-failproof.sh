#!/usr/bin/env bash
# Query GLM-5.2 for a failproof fix plan for the two critical production bugs.
set -euo pipefail

ANALYSIS=$(cat /root/lionpath_V2/docs/plans/2026-08-08-failproof-analysis.md)

read -r -d '' PROMPT <<EOF || true
You are the architect (GLM-5.2) in a two-brain workflow. Gideon (the investigator) has
analyzed two CRITICAL production bugs from a live portal log. Your job: give a FAILPROOF,
bug-free implementation plan for Codex (gpt-5.5) that fixes BOTH bugs for good. Be precise
and decisive. Do NOT write full code — give exact file paths, exact changes, and verification.

Here is the analysis:

$ANALYSIS

Deliver:
1. BUG A (deterministic commit retry): the exact fix so the retry produces a DIFFERENT,
   complete JSON. Pick the best approach (vary seed / raise temp / continue-hint / combine)
   and give exact code-level steps for worker/src/postcall/commit.ts and providers/index.ts.
2. BUG B (permission-denied cascade): the exact fix for (a) filtering hist_* stub IDs before
   Firestore queries, (b) the technical commit / call detail / deal reads failing on
   permissions, (c) the post-call dual-write permission failure. Give exact file paths and
   steps. Note the realtime refactor in flight (store.js read/write split, firestore-store
   onSnapshot) — integrate with it, don't conflict.
3. Ordering (which bug first) and verification steps.
EOF

curl -sS https://api.neuralwatt.com/v1/chat/completions \
  -H "Authorization: Bearer $HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"model":"glm-5.2","messages":[{"role":"user","content":sys.argv[1]}],"temperature":0.2}))' "$PROMPT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
