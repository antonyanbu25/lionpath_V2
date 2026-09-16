# Final Validation Report

```text
Repository        https://github.com/Antony-sagayaraj/SE-Labs
Main base SHA     a4d5cb7e8624f1f8fea1b4b807a2bac067fe8846
Astra source SHA  d99d82d7ec9df095cb75bc30c243a5d9df609c0d
Merge base SHA    0dfd6b1334eae0be1b2f8d10f286def70f2011a8
Safety branch     safety/main-before-astra-functional-20260910-2136  (= main base SHA)
Duplicate branch  main(postgresfixfinal)                             (= main base SHA)
Integration       main-with-functional-fix
Integration SHA   0e2973f3f956e0750f92c7510354636548bad205
```

The integration commit is a real merge commit with both parents
(`a4d5cb7` and `d99d82d`), so attribution for the Astra commits is preserved
in history rather than flattened.

## Final delta

44 files changed, 5730 insertions, 275 deletions. 4020 of those insertions are
the `docs/astra-audit/` documentation set.

High-risk paths in the final diff:

| Path | Files changed |
| --- | --- |
| `janus/schema` | **0** |
| `janus/tests` | **0** |
| `worker/src/data` | **0** |
| `web/domain` | 1 (`store.js`) |
| `worker/scripts` | 4 (3 tests plus the manifest) |
| `worker/wrangler.toml` | 1 (`nodejs_compat`) |

The entire persistence layer is untouched.

Hygiene, all verified against the final diff:

- No lockfile, `.env`, `.dev.vars`, generated-artifact, `dist/` or binary changes.
- `git diff --check` reports no whitespace errors.
- No secret-shaped additions (scanned for token, key and private-key patterns).
- Every one of the 44 changed files maps 1:1 to the Astra changeset — nothing
  extra, nothing dropped (verified with `comm` against the source diff).
- `web/qc-preview.html` is **not** in the diff. It briefly showed as modified
  after a branch switch, but `git diff` for it was empty — an EOL
  renormalization notice under `core.autocrlf=true`, not a content change.

## Gate results

Compared against `MAIN_BASELINE.md`, which was a zero-failure web baseline.

| Gate | Baseline (`main`) | Integration | Verdict |
| --- | --- | --- | --- |
| `npm ci` from lockfiles | PASS | PASS | no change |
| `npm run build` | PASS — app 373.3 KB | PASS — app 373.4 KB | **no regression** |
| `npm run typecheck --prefix worker` | PASS | PASS | no change |
| `npm run test:web` | 148/148 | **151/152** | +4 tests; 1 inherited failure, **0 new** |
| Worker tests | 90/91 | **92/93** | +2 tests, both pass; same 1 known env failure |
| Grants smoke | 18/18 | **18/18** | no change |
| RLS fails closed | 8/8 | **8/8** | no change |
| View RLS | 4/4 | **4/4** | no change |
| AT-4 ranking | 19/19 | **19/19** | no change |
| Dual-write soak | PASS | **PASS** | no change |
| `ai_run` insert | 10/12 | **10/12** | identical, same 2 known env failures |
| Clean schema install | n/a | **PASS** | `init_all.sql` from scratch on an empty DB |
| Schema idempotency | n/a | **PASS** | re-apply over itself succeeds |
| Schema object parity | 79 tables / 46 policies | **79 / 46** | identical |
| `npm run test:rules` | BLOCKED | BLOCKED | not applicable — see below |

All SQL work ran against a disposable local PostgreSQL 18.4 cluster
(`embedded-postgres`, `worker/.local-pg`, gitignored). No staging or production
database was contacted, and the throwaway `janus_verify` database used for the
clean-install gate was dropped afterwards.

### Commands

```bash
npm ci --prefix web && npm ci --prefix worker
npm run build
npm run typecheck --prefix worker
npm run test:web
npm run test:janus-smoke --prefix worker
npm run test:view-rls --prefix worker
node janus/scripts/load-rubric-catalog.mjs        # AT-4 prerequisite
node janus/tests/acceptance/at4_ranking.test.mjs
node janus/tests/ai_run_insert.test.mjs
cd worker && npx tsx scripts/dual-write-soak.ts
DATABASE_URL_MIGRATIONS=<fresh db> node worker/scripts/apply-janus-schema.mjs
```

Worker tests were run through an equivalent scratchpad runner rather than
`npm test --prefix worker`, because the committed runner cannot execute on
Windows at all. See `MAIN_BASELINE.md` failure 2 — the runner calls
`spawn("npx", ...)` without `shell: true`, which cannot resolve `npx.cmd`, so
it reports 0/91 on `main` too. The substitute uses the identical manifest
selection and the identical `npx tsx <file>` invocation and differs only by
`shell: true`. **Nothing in the repository was modified to make tests pass.**

## Performance comparison

| Measure | Baseline | Integration | Delta |
| --- | --- | --- | --- |
| `app` entry bundle | 373.3 KB | 373.4 KB | **+0.1 KB (+0.03%)** |
| Total JS output | 1.2 MB, 58 files | 1.2 MB, 58 files | unchanged |
| Other entry bundles | 1.8 / 1.9 / 1.3 KB / 157 B | identical | unchanged |

No avoidable serial calls, duplicate work or blocking UI behaviour was
introduced. The integration moves in the opposite direction on several counts:

- The CRM preview stops gating the primary action, so the Analyze button no
  longer waits on a network round-trip (A-19, F-016/E-003).
- `bindActionOnce` and the call-view fix remove a double click-event binding
  that fired `saveMom()` twice per click — strictly fewer writes and fewer AI
  passes (A-16, A-17).
- Post-call hydration updates are coalesced into one panel refresh per call id,
  and an intermediate repaint is removed (A-15, A-16).
- Zoom API and scrape calls now have timeouts where they previously had none,
  bounding a previously unbounded wait (A-04, A-05).

LLM pass count, ordering and token sizes are unchanged — no prompt in this
integration alters a pass definition.

## The one failing test

`web/scripts/test-postcall-intake-e2e.mjs` fails with
`FAIL: #analyze-call must start disabled`.

**It is not caused by this integration.** It fails identically on the unmerged
Astra branch. Verified in an isolated `git worktree` checked out at exactly
`d99d82d`, confirmed to contain 0 references to `PROXY_SE_PICKER_ENABLED`
(so definitely not the merged code), with its own dev server on a port
confirmed free beforehand. Same failure, same assertion.

Root cause, measured directly against the DOM at the moment the test asserts:

```text
immediately after #postcall-form-view becomes visible:
  tagName FW-BUTTON, disabled=false, hasAttribute("disabled")=false, upgraded=true
2.5s later:
  disabled=true,  hasAttribute("disabled")=true
```

The button is **transiently enabled** on view entry and only settles to
disabled about 2.5s later, once the async state update runs. The test asserts
inside that window. Because step (a) fails, the test never reaches step (b),
which is the assertion that actually covers the F-016/E-003 fix — so the fix
itself is unverified by this test, though the rest of the web suite exercises
the same code.

Deliberately **not** "fixed" by adding a wait to the assertion. The transient
window is real: the primary action is briefly clickable before its state
settles, which is the same class of defect the Astra audit was written to find.
Papering over the assertion would hide it. This needs a product decision —
either fix the ordering so the button is never transiently enabled, or relax
the assertion — and that decision belongs to the team, not to a merge.

## Known limitations

1. `web/scripts/test-postcall-intake-e2e.mjs` fails, inherited from the source
   branch, with the real transient-enable behaviour described above.
2. `worker/scripts/test-rubric-profiles.ts` fails on Windows only, from
   `core.autocrlf=true` plus a CRLF-fragile regex. Measured: 19/19 YAML blocks
   fail as checked out, 0/19 after stripping CR. Would pass in a LF checkout
   or CI.
3. The committed worker test runner and `rules-tests/run-all.mjs` cannot run on
   Windows (`spawn("npx", ...)` without `shell: true`). Pre-existing on `main`.
4. `npm run test:rules` is blocked — no Java for the Firestore emulator — and
   not applicable, since neither branch touches `firestore.rules` or
   `rules-tests/`.
5. `ai_run_insert` 2/12 checks cannot run: the harness uses top-level await
   while neither `janus/` nor the repo root declares `"type": "module"`, so tsx
   compiles it as CJS. Pre-existing on `main`, independent of OS.
6. `nodejs_compat` (A-07) cannot be validated without a deploy, which was not
   authorized. Needs a smoke test on first deploy.
7. `/api/read-models/schedule` does not verify that the caller owns the
   referenced post-call. Pre-existing handler behaviour on `main`; recorded as
   a hardening recommendation, not changed here.
8. No functional gate exercised a live Zoom account, a real BigQuery dataset,
   or a real Firebase project — all absent from this environment. The Zoom
   changes are covered by the branch's own network-level tests instead.

## Rollback procedure

The integration branch has not been merged into `main`, so `main` is currently
untouched and no rollback is required.

If `main-with-functional-fix` is later merged and needs reverting:

```bash
# revert the merge, keeping first-parent (main) history
git revert -m 1 <merge-commit-sha>
```

To recover the exact pre-integration `main` tree for comparison, both refs
point at `a4d5cb7` and neither has been moved:

```bash
git checkout safety/main-before-astra-functional-20260910-2136
git checkout "main(postgresfixfinal)"
```

Do not rewrite `main` history. Keep the safety branch until production
validation is complete.

## Status

**PR READY / NOT MERGED — by instruction.**

The task was to produce `main-with-functional-fix` for a later merge into
`main`, so Stage 8's "merge the pull request" step was deliberately not
performed. `main` is unchanged at `a4d5cb7`.

Two gates did not pass cleanly (the inherited e2e failure and the blocked
rules tests), so a merge would not have been appropriate regardless.
