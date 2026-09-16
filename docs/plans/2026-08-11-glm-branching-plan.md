# Branch Cleanup & Branching-Rules Plan — `antonyanbu25/lionpath_V2`

## Assumptions
- You run from a clean local clone with `origin` = GitHub.
- No one is mid-commit to `2.1`, `2.1.4`, `2.1.5`, or `2.1-eval-harness` during this window.
- Web build is reproducible via `node web/scripts/build.mjs`.
- A deploy window is scheduled (Janus will pick up the new `2.1` tip on next `update.sh` run).

## Risks flagged up front
- **R1:** Cherry-picking onto `2.1` moves the deploy anchor. Next VPS `update.sh` auto-applies it. Coordinate timing.
- **R2:** If `56988b3`/`d2c78ee` conflict with newer `2.1` work, cherry-pick aborts — fallback is manual port (still onto `2.1`).
- **R3:** Never force-push `main` or `2.1`. Both operations below are FF / fast-forward only.
- **R4:** Branch name `2.1.3(nivi-sunday)` is ambiguous in your topology — confirm the literal name before archiving (I use `2.1.3` below; substitute if it's `nivi-sunday` or `2.1.3-nivi-sunday`).

---

## Phase 0 — Snapshot (safety net, 2 min)
Tag every branch tip before touching anything. Cheap insurance.

```bash
git fetch --prune origin
for b in 2.0.7.3 2.0.7.4 2.0.8.1-merge 2.0.8.2 2.1.1 2.1.2 2.1.3 2.1-org-hierarchy \
         fix/loading-perf-2.1 3.0 2.1.4 2.1.5 2.1-eval-harness main 2.1; do
  git tag snapshot/pre-cleanup-$b $b 2>/dev/null || true
done
git push origin --tags
```

---

## Phase 1 — Cherry-pick the 2.1.4 production fix onto `2.1` (Decision 2)

**Recommendation: CHERRY-PICK.** The ARR-optional fix (`56988b3`) is a real, targeted UI fix for call-record rendering that the live Janus deploy is missing. `2.1`'s newer history does not cover it (you confirmed it's a unique commit). Porting it onto `2.1` is the only path that gets the fix to Janus. The build-sync commit (`d2c78ee`) comes along so `npm ci` stays green.

```bash
git fetch origin
git checkout 2.1
git pull --ff-only origin 2.1

# Cherry-pick in chronological order (UI fix first, then lockfile sync)
git cherry-pick 56988b3 d2c78ee
# If conflict: resolve, git add, git cherry-pick --continue. If unrecoverable: git cherry-pick --abort and fall back to manual port.

# Rebuild web assets so boot.js hash matches the freshly picked sources
node web/scripts/build.mjs

# Verify boot.js hash is referenced correctly in the served HTML
grep -R "boot.js" web/ public/ 2>/dev/null   # adjust path to where the hash is referenced
git status                                   # confirm only intended files changed

git push origin 2.1
```

**Verify before moving on:**
- `git log --oneline -3 2.1` shows the two new commits on top.
- `boot.js` hash in HTML matches the rebuilt file.
- No stray unstaged changes.

---

## Phase 2 — Fast-forward `main` to `2.1` tip (Decision 1)

**Recommendation: FF `main` to `2.1` tip. No merge commit.** `main` is a strict ancestor of `2.1` (0 behind, 436 ahead), so `--ff-only` succeeds cleanly. A merge commit would just add noise and diverge from "main = newest stable". FF keeps `main` as a pure pointer to stable.

Risk of FF-ing main forward: **none** — it's a fast-forward, no history rewrite, no force-push.

```bash
git checkout main
git pull --ff-only origin main
git merge --ff-only origin/2.1
git push origin main
```

After this: `main` == `2.1` tip (including the 2.1.4 fix). `main` is now the source of truth for newest stable.

---

## Phase 3 — Archive fully-contained branches (Decision 3)

**Recommendation: lightweight tags `archive/<branch>`, then delete the branch refs.** Tags are invisible in `git branch` output (clean branch list = "no mess"), still reachable via `git log archive/<name>` or `git checkout`, and immutable. `archive/` branches would clutter the branch list and invite accidental commits. Since all these commits are already reachable from `2.1`, the tag is just a bookmark — nothing is lost.

Known fully-contained branches (9 listed; you mentioned 14 — run the loop below for any extras):

```bash
# Tag tips
for b in 2.0.7.3 2.0.7.4 2.0.8.1-merge 2.0.8.2 2.1.1 2.1.2 2.1.3 \
         2.1-org-hierarchy fix/loading-perf-2.1 3.0; do
  git tag archive/$b $b
done
git push origin --tags

# Delete remote branches
git push origin --delete 2.0.7.3 2.0.7.4 2.0.8.1-merge 2.0.8.2 2.1.1 2.1.2 2.1.3 \
                     2.1-org-hierarchy fix/loading-perf-2.1 3.0

# Delete local branches
git checkout main
git branch -D 2.0.7.3 2.0.7.4 2.0.8.1-merge 2.0.8.2 2.1.1 2.1.2 2.1.3 \
            2.1-org-hierarchy fix/loading-perf-2.1 3.0
```

**Note on `2.0.8.2`:** its 3 unique commits are rename artifacts + an RELEASE md encoding fix — no real feature work. Tagging preserves them; deletion is safe. If you want to be extra cautious, port the RELEASE md fix onto `2.1` first — but I judge it not worth the noise. Decisive call: archive as-is.

**To find any other fully-contained branches I didn't list:**
```bash
for b in $(git branch -r --list 'origin/*' | sed 's|origin/||' | grep -v HEAD); do
  if git merge-base --is-ancestor origin/$b origin/2.1 && [ "$b" != "2.1" ] && [ "$b" != "main" ]; then
    echo "CONTAINED: $b"
  fi
done
```
Run each `CONTAINED:` result through the same tag+delete loop.

---

## Phase 4 — Keep `2.1.5` and `2.1-eval-harness` as-is (Decision 4)

**Recommendation: KEEP.** Both hold unmerged, non-trivial work (experimental feature / CI harness). Archiving active or potentially-active branches destroys discoverability and signals abandonment. Leave them in the branch list. If they go 60+ days untouched, revisit and archive then.

No commands. Just don't touch them.

---

## Phase 5 — Document the branching policy (Decision 5)

Create `docs/BRANCHING.md` (or paste into README). Content:

```markdown
# Branching Policy — lionpath_V2

## Branch roles
- `main` — GitHub default. Always points at the newest stable code. FF-only updates from the current release branch.
- `2.1` — PRODUCTION DEPLOY ANCHOR. Janus (janus.benjaminsquare.com) runs from `2.1` via `deploy/vps/update.sh`. Never rename, never force-push, never delete.
- `<release>` (e.g. `2.2`, `2.3`) — next release branch. Branched off `main` when a release cycle starts.
- `feat/<scope>`, `fix/<scope>` — short-lived work branches off `main` (or off the current release branch if targeting a specific release).
- `archive/<name>` — lightweight tag, not a branch. Marks a deleted branch's tip for history.

## Workflow
1. Branch off `main` for new work: `git checkout -b feat/<scope> main`.
2. Open PR → merge into the active release branch (e.g. `2.2`).
3. When release stabilizes, FF `main` to the release branch tip: `git checkout main && git merge --ff-only origin/2.2 && git push origin main`.
4. Tag the release: `git tag v2.2.0 2.2`.

## Hotfix flow (production bug on Janus)
1. Branch off `2.1`: `git checkout -b fix/<scope> 2.1`.
2. Fix, commit, PR to `2.1`.
3. Merge to `2.1`. Next `update.sh` run deploys it.
4. Cherry-pick or FF the fix onto `main` so main stays stable-current.
5. If a newer release branch exists, cherry-pick there too.

## Archive convention
- When a branch is fully merged into `main`/`2.1` and no longer active:
  `git tag archive/<branch> <branch> && git push origin archive/<branch>`
  `git push origin --delete <branch>`
- Never delete `main` or `2.1`.
- Never rename `2.1` (deploy script is hardcoded to it).

## Rules
- `main` updates are FF-only. No merge commits, no force-push.
- `2.1` accepts cherry-picks and FF merges only. No rewrites.
- Default branch on GitHub stays `main`.
```

---

## Phase 6 — Final verification

```bash
git fetch --prune origin
git log --oneline -1 origin/main      # == 2.1 tip
git log --oneline -1 origin/2.1       # deploy anchor, with 2.1.4 fix on top
git branch -r                         # clean: main, 2.1, 2.1.5, 2.1-eval-harness, plus any active feat/*
git tag -l 'archive/*' | wc -l       # 10+ archive tags
git tag -l 'snapshot/pre-cleanup-*'  # safety net intact
```

Then trigger a Janus deploy via `deploy/vps/update.sh` and smoke-test call-record rendering (the ARR-optional fix path).

---

## Summary of decisions
1. **main:** FF `main` to `2.1` tip with `--ff-only`. No merge commit.
2. **2.1.4 fix:** Cherry-pick `56988b3` + `d2c78ee` onto `2.1`, rebuild web, verify boot.js hash.
3. **Archive:** Lightweight `archive/<name>` tags + branch deletion. Cleaner branch list than `archive/` branches.
4. **2.1.5 / 2.1-eval-harness:** Keep as-is.
5. **Policy:** `docs/BRANCHING.md` as above.
6. **Order:** Phase 0 (snapshot) → 1 (cherry-pick to 2.1) → 2 (FF main) → 3 (archive) → 4 (skip) → 5 (doc) → 6 (verify).
