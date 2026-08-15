# Gideon Stage Labels

Every significant Gideon operation passes through these stages. Stage labels make the
difference between "an executor said it finished" vs "something actually passed a quality gate."

## Stage Definitions

| You see | It means |
| ------- | -------- |
| `Plan · not run` | A prompt or plan is ready. Nothing has run yet. |
| `Plan · running` | Planning agent is active (GLM-5.2 or reasoning model). |
| `Code · not run` | Implementation is queued. No executor has started. |
| `Code · running` | Codex/code execution is in progress. |
| `Code · reported done` | Executor says it finished. Nobody verified the result. |
| `Test · running` | Verification, review, or CI gate is active. |
| `Test · verified` | A test, review, or CI gate actually passed. |
| `Done` | All stages complete. Deliverable is ready. |
| `Failed` | A stage gate rejected the output. Requires intervention. |

## Stage Transition Rules

- Forward: Plan → Code → Test → Done
- On failure: Any stage → Failed (must be reviewed manually)
- No skipping: A "verified" mark can ONLY be given by a reviewer, not the executor itself

## Usage in Gideon

Gideon's mesh status output should show the current stage of the primary active task.
The inner monologue dashboard can display this as a stage badge (see D1-UI).
