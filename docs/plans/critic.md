# Critic Sub-Agent

Phase A adds a standalone critic runner for swarm worktrees.

## Owned Files

- scripts/critic-agent.sh
- scripts/critic-run.sh
- docs/plans/critic.md

## Contract

- `scripts/critic-agent.sh <spec-file> <worktree-or-git-dir>` prints the current `git show --stat HEAD`, extracts named output files from the spec, checks that each file exists in the target worktree, runs `bash -n` on named shell scripts, and prints `ACCEPT` or `REJECT` with reasons.
- `scripts/critic-run.sh <worktree-or-git-dir> <spec-file> <results-file>` wraps the agent, writes the full verdict to the results file, and prints a one-line summary.
- The critic is read-only against the reviewed worktree.
- Do NOT add CREATE TABLE for any table.
- Do NOT modify `agent-radio.sh`, `task-router*.sh`, or any existing script.
