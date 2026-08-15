# Gideon Mesh Roles

Inspired by oh-my-hermes roles system.

## Role Definitions

### Orchestrator — Gideon (this agent)
- Owns: planning, memory, user-facing communication, cron orchestration
- Delegates: code execution, research, verification
- Cannot be: bypassed by subagents for user-facing output

### Worker — Codex / GLM subagents
- Own: the specific deliverable assigned by orchestrator
- Cannot: modify shared state (event-bus, SQLite) without going through orchestrator
- Must: commit their changes before reporting "done"

### Reviewer — Secondary Codex agent (verification pass)
- Own: verifying worker output against spec
- Checks: file existence, syntax validity, spec compliance
- Reports: "verified" or "failed: reason" — never "looks good probably"

## Interaction Protocol

1. Orchestrator creates worktree + task file
2. Worker implements in their worktree, commits
3. Reviewer verifies worktree output
4. Orchestrator merges on "verified"
5. On "failed": reviewer writes fix suggestion, worker gets one retry
