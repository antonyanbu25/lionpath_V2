# Branching Policy — lionpath_V2

How we name branches and get code to production. Short, boss-friendly, follow it every time.

## The 3 things you must never forget

1. **`main`** = the single source of truth. Always shows the newest stable code.
2. **`2.1`** = the PRODUCTION DEPLOY ANCHOR. Janus (janus.benjaminsquare.com) runs from `2.1`
   via `deploy/vps/update.sh`. **NEVER rename it, never force-push it, never delete it.**
3. **`archive/<name>`** = tags (not branches) that bookmark old branches we deleted, so nothing is ever lost.

## Branch roles

| Branch | What it is | Rules |
|--------|-----------|-------|
| `main` | Source of truth, newest stable | FF-only updates, no force-push, no merge-commit noise |
| `2.1` | Deploy anchor — Janus runs from here | Never rename, never rewrite, never delete |
| `2.2`, `2.3`, ... | Next release branches | Branch off `main` when a release cycle starts |
| `feat/<scope>` | New feature | Short-lived, off `main` (or off the release branch you're targeting) |
| `fix/<scope>` | Bug fix | Short-lived, off the branch that has the bug |
| `archive/<name>` | Tag marking a deleted branch's tip | Read-only bookmark, never a branch |

## Naming — like a filing cabinet

- **`feat/login-page`** — feature branches start with `feat/`.
- **`fix/arr-crash`** — fix branches start with `fix/`.
- **`chore/cleanup`** — housekeeping (no code change) starts with `chore/`.
- **`docs/branching`** — documentation starts with `docs/`.
- **Release branches** are just the version number: `2.2`, `2.3`.
- **Everything after the `/`** is a short, lowercase, hyphen-separated description.
  No spaces. No CAPS. No random names like `nivi-sunday`.

## Workflow — the daily loop

1. **Pull the latest `main` first:** `git checkout main && git pull`
2. **Make your branch off `main`:**
   `git checkout -b feat/login-page`
3. **Code, commit, push your branch:**
   `git add . && git commit -m "feat(login): add password reset"` then `git push -u origin feat/login-page`
4. **Open a PR** from your branch into `main` (or into the active release branch).
5. **Review, merge, done.** Your branch is now merged into `main`.

## Hotfix flow (production bug on Janus)

1. Branch off `2.1` (NOT `main`): `git checkout -b fix/arr-crash 2.1`
2. Fix, commit, push.
3. Open a PR into `2.1`. Merge.
4. The next `deploy/vps/update.sh` run on the VPS deploys it to Janus automatically.
5. Also cherry-pick or FF the same fix onto `main` so main stays current.

## Releasing

When a release cycle stabilizes:

```
git checkout main
git merge --ff-only origin/2.2     # main catches up to the release branch
git push origin main
git tag v2.2.0 2.2                  # tag the release
git push origin v2.2.0
```

## Archiving old branches (how we cleaned up the mess)

When a branch is fully merged and dead, don't delete it silently — bookmark it first:

```
git tag archive/<old-branch> <old-branch>
git push origin archive/<old-branch>
git push origin --delete <old-branch>     # only after the tag is pushed
```

The branch disappears from the list, but every commit is still reachable via the
`archive/<old-branch>` tag. Nothing is lost.

## Hard rules (no exceptions)

- `main` updates are **FF-only** — never force-push, never rewrite history.
- `2.1` accepts **cherry-picks and FF merges only** — no rewrites, no renames.
- Default branch on GitHub stays `main`.
- Always `git pull` before you branch. Always branch off the current `main`.
- Never commit directly to `main` or `2.1` — always work on a `feat/`/`fix/` branch and merge via PR.
