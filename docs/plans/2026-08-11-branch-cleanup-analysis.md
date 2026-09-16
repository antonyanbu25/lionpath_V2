# lionpath_V2 Branch Topology Analysis — 2026-08-11

## Deploy anchor (CRITICAL — do not rename)
**`2.1`** is hardcoded in the VPS deploy:
- `deploy/vps/update.sh`: `git checkout 2.1; git reset --hard origin/2.1`
- `deploy/vps/git-fetch-origin.sh`: `BRANCH="${2:-2.0.8.1-merge}"` default, but update.sh passes `"2.1"`
- Janus (janus.benjaminsquare.com) / portal runs from `2.1`. Current stamp: portal-build 2.1.42, VERSION 2.1.30.

**`2.1` must stay exactly as named. Renaming it breaks Janus.**

## Branch inventory (20 branches)

| Branch | State vs 2.1 | Content | Action |
|--------|-------------|---------|--------|
| **main** | ancestor of 2.1 (FF possible: 0 behind, 436 ahead) | stale @1fa0721 (Jul 21) | **fast-forward to 2.1** |
| **2.1** | DEPLOY ANCHOR | portal-build 2.1.42 | **KEEP (untouched)** |
| 2.0.7.3 | contained in 2.1 | old release | archive/rename |
| 2.0.7.4 | contained in 2.1 | old release | archive/rename |
| 2.0.8.1-merge | contained in 2.1 | old release | archive/rename |
| 2.0.8.2 | DIVERGED (3 commits: branch-rename artifacts only) | old release | archive/rename |
| 2.1.1 | contained in 2.1 | old release | archive/rename |
| 2.1.2 | contained in 2.1 | old release | archive/rename |
| 2.1.3(nivi-sunday) | contained in 2.1 | old release | archive/rename |
| **2.1.4** | DIVERGED (2 commits: package-lock sync + ARR-compute-optional fix) | user calls "latest build" but is BEHIND 2.1 (2.1 has 14 unique commits) | **check: are the 2 fixes already in 2.1?** |
| 2.1.5 | DIVERGED (1 commit: fish sizing buckets theme) | experimental | archive/rename or keep |
| 2.1-eval-harness | DIVERGED (8 commits: CI/e2e fixes) | experimental | archive/rename or keep |
| 2.1-org-hierarchy | contained in 2.1 | merged feature | archive/rename |
| fix/loading-perf-2.1 | contained in 2.1 | merged fix | archive/rename |
| **3.0** | ancestor of 2.1 (fully contained) | old experiment | archive/rename |

## Key facts
- **main → 2.1 is a clean fast-forward** (0 behind, 436 ahead, shared base 1fa0721). Merging main to latest is trivial and safe.
- Branches **contained in 2.1** are pure history — renaming to `archive/…` loses nothing (all commits reachable via 2.1/main).
- Diverged branches (2.1.4, 2.1.5, 2.1-eval-harness, 2.0.8.2) hold a few unique commits — must preserve content before archiving (either they're already merged, or a tag/note preserves them).
- Version stamps are inconsistent (portal-build vs VERSION disagree) — do not trust them for classification.

## Safety rules
1. **Never rename or move `2.1`** (deploy anchor, Janus).
2. Renaming other branches does NOT affect code — git fetch/pull uses branch names only in deploy scripts, and only `2.1` is referenced. GitHub's default branch is `main`; renaming non-default branches is safe.
3. If a diverged branch has unique unmerged work, preserve via a lightweight tag or confirm it's intentionally discarded.
4. Keep `main` as GitHub default; after FF to latest, update the promotion/release docs so branching rules are followed going forward.
