# Portal Sync Workflow

Sync Janus GitHub repo data → Firestore → portal janus.benjaminsquare.com.

## Inputs
- GitHub API: antonyanbu25/lionpath_V2 commit activity, PRs, branches
- Deploy anchor: version tag (currently `2.1`)

## Stages

1. **FETCH** — Clone/pull the Janus repo, enumerate commits since last deploy anchor.
2. **PARSE** — Extract: author, timestamp, files changed, PR numbers, deploy tags.
3. **DIFF** — Compare against Firestore last-sync snapshot.
4. **UPSERT** — Write new/changed records to Firestore with timestamp.
5. **VERIFY** — Read back Firestore, confirm record count matches expectation.
6. **NOTIFY** — Emit thought: "portal synced, N new commits since anchor 2.1"

## Error Handling
- GitHub 403 (rate limit): back off 1h, retry next cycle
- GitHub 404: log and skip (repo may be private or renamed)
- Firestore permission-denied: stop retry loop (prevents billing), alert via event-bus

## Cache
Cache GitHub API responses in SQLite for 15 minutes to avoid rate limits.
