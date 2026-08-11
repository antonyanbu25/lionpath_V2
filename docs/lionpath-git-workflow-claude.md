# Lionpath — Git Workflow Rules (follow every time)

This repo (`antonyanbu25/lionpath_V2`) was cleaned up. Old branches (`2.0.x`, `2.1.1`, `2.1.2`, `3.0`) are archived as `archive/*` tags. Only these branches are live:

- **`main`** — source of truth, newest stable code
- **`2.1`** — PRODUCTION DEPLOY ANCHOR. Janus (janus.benjaminsquare.com) runs from `2.1`. **NEVER rename, force-push, or delete it.**
- `2.1.4`, `2.1.5`, `2.1-eval-harness` — active work streams

## The 3 golden rules

1. **NEVER code directly on `main`** — always work on your own branch.
2. **NEVER touch `2.1`** — it's what Janus runs from. Leave it alone.
3. **Always `git pull` before you branch.**

## Branch naming (the law)

| You're doing | Name it | Example |
|---|---|---|
| New feature | `feat/<short-name>` | `feat/login-page` |
| Bug fix | `fix/<short-name>` | `fix/arr-crash` |
| Housekeeping | `chore/<short-name>` | `chore/cleanup-logs` |
| Docs | `docs/<short-name>` | `docs/branching` |
| Release | just the version | `2.2` |

Rules: **lowercase, no spaces, hyphens between words, short.** No `nivi-sunday`, no `2.1.3`, no `NEW_FEATURE`. Release branches are version numbers.

## Daily workflow

```bash
# 1. Always start from latest main
git checkout main
git pull

# 2. Make your branch off main
git checkout -b feat/login-page

# 3. Code, commit, push
git add .
git commit -m "feat(login): add password reset"
git push -u origin feat/login-page

# 4. Open a PR into main, get it reviewed, merge
```

## Hotfix flow (production bug on Janus)

1. Branch off `2.1` (NOT main): `git checkout -b fix/arr-crash 2.1`
2. Fix, commit, push.
3. Open a PR into `2.1`. Merge.
4. Next `deploy/vps/update.sh` run on the VPS deploys it to Janus automatically.
5. Also cherry-pick or FF the same fix onto `main` so main stays current.

## Merging

- Open a **Pull Request** from your branch → `main`.
- Someone reviews it, clicks **Merge**.
- Done — your code is in `main`.

## If you see a deleted branch in your IDE

Run `git fetch --prune origin` to forget old branches. Don't try to check out `2.1.2` or `3.0` — they're archived, not live.

## Full policy

See `docs/BRANCHING.md` in the repo for the complete branching policy.
