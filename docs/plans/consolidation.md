# Memory Consolidation Plan

Phase E adds a read-only memory consolidation sleep cycle for Gideon.

## Ownership

D4 owns only:

- `scripts/consolidation-daemon.sh`
- `scripts/consolidation-compress.sh`
- `scripts/consolidation-prune.sh`
- `docs/plans/consolidation.md`

D4 owns only the `gideon_mem_stats` table. Do NOT add `CREATE TABLE` for any table D4 does not own.

## Safety Rules

- Memory data is read-only.
- Existing memory, episodic, semantic, and fact tables must not be deleted from, rewritten, or pruned by these scripts.
- `consolidation-daemon.sh` may create and insert rows into `gideon_mem_stats`.
- `consolidation-compress.sh` prints semantic digests to stdout only.
- `consolidation-prune.sh` prints stale prune candidates only.

## Scripts

`consolidation-daemon.sh` computes the SQLite database size, discovers episodic and semantic row counts when tables are available, estimates counts when discovery is not possible, and inserts a single `gideon_mem_stats` row per run. Daemon mode is intended for the 3-4am window.

`consolidation-compress.sh` samples recent episodic rows and prints a semantic digest. If `CHEAP_MODEL_URL` and `CHEAP_MODEL_KEY` are set, it calls that HTTP model endpoint with `curl`; otherwise it emits a local stub summary.

`consolidation-prune.sh` scans memory-like tables for stale `updated_at`-style timestamps and prints candidate ids. It is report-only and never deletes rows.

## Verification

```bash
bash -n scripts/consolidation-daemon.sh
bash -n scripts/consolidation-compress.sh
bash -n scripts/consolidation-prune.sh

before="$(sqlite3 "$HOME/.hermes/state.db" "SELECT COUNT(*) FROM gideon_mem_stats;" 2>/dev/null || printf 0)"
scripts/consolidation-daemon.sh
after="$(sqlite3 "$HOME/.hermes/state.db" "SELECT COUNT(*) FROM gideon_mem_stats;")"
test "$after" -gt "$before"
```
