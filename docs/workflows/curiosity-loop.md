# Curiosity Loop Workflow

Self-directed capability improvement loop running every 30 minutes.

## 9 Stages

1. **OBSERVE** — Scan event bus for anomalies, new patterns, unexpected failures.
2. **QUESTION** — Formulate a "I wonder why X" question from the observation.
3. **HYPOTHESIZE** — Propose 2-3 possible explanations using GLM-5.2.
4. **EXPERIMENT** — Design a minimal test to discriminate between hypotheses.
5. **ANALYZE** — Run the experiment, collect evidence, update hypothesis probabilities.
6. **SYNTHESIZE** — Merge findings into a capability improvement or documented exception.
7. **CLASSIFY** — Categorize: SKIP / PATCH / INVESTIGATE_DEEPER.
8. **ACT** — Apply the approved change to skills, memory, or code.
9. **REFLECT** — Log what was learned. Update confidence scores in capability-manifest.json.

## Budget Guardrails

- Per-stage token budget: 2,000 tokens
- Total per-run budget: 20,000 tokens
- On budget exhaust: stage "ACT" with best current hypothesis, skip remaining stages
- Neuralwatt 402 → immediate PATCH skip, log to event bus

## Stage → Stage Labels

Map each stage to oh-my-hermes labels:
- Stages 1-3: `Plan · running`
- Stage 4: `Code · running`
- Stages 5-6: `Test · running`
- Stage 7: `Plan · not run` (next loop)
- Stage 8: `Code · running`
- Stage 9: `Test · verified`
