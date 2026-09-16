# Main Baseline — before the Astra functional integration

`MAIN_BASE_SHA` = `a4d5cb7e8624f1f8fea1b4b807a2bac067fe8846`

Captured on a clean checkout of `MAIN_BASE_SHA` (`git status` empty) **before**
any integration work, so every post-merge result has something to be compared
against.

## Environment

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| Node | v20.18.0 |
| npm | 10.8.2 |
| PostgreSQL | 18.4 (x86_64-windows) via `embedded-postgres`, `npm run sql:local` |
| Playwright | chromium-headless-shell 151.0.7922.34 |
| `core.autocrlf` | `true` (global) — matters, see "Environment artifacts" |

Dependencies installed from committed lockfiles only:
`npm ci --prefix web`, `npm ci --prefix worker`. No `npm install`, no lockfile
was modified.

The database is a disposable local cluster in `worker/.local-pg`
(gitignored), created from scratch by `worker/scripts/start-local-postgres.mjs`.
No staging or production database was contacted at any point, and no migration
was applied anywhere but this throwaway cluster.

## Baseline results

| Gate | Command | Result |
| --- | --- | --- |
| Web build | `npm run build` | **PASS** — app bundle 373.3 KB, 58 files, 1.2 MB total |
| Worker typecheck | `npm run typecheck --prefix worker` | **PASS** |
| Web tests | `npm run test:web` | **PASS 148/148** |
| Worker tests | `node scripts/run-tests.mjs` (see note) | **90/91** — 1 known env failure |
| Grants smoke | `npm run test:janus-smoke --prefix worker` | **PASS 18/18** |
| RLS fails closed | (same command) | **PASS 8/8** |
| View RLS | `npm run test:view-rls --prefix worker` | **PASS 4/4** |
| AT-4 ranking | `node janus/tests/acceptance/at4_ranking.test.mjs` | **PASS 19/19** |
| Dual-write soak | `npx tsx scripts/dual-write-soak.ts` | **PASS** |
| ai_run insert | `node janus/tests/ai_run_insert.test.mjs` | **10/12** — 2 known env failures |
| Firestore rules | `npm run test:rules` | **BLOCKED** — no Java, and not applicable |

`npm run test:web` initially reported 133/148. All 15 failures were the single
cause "Playwright browser binary not downloaded". After
`npx playwright install chromium` the suite is **148/148 with zero failures**,
which is the baseline actually used for comparison. A zero-failure baseline is
what makes "no new failures" a meaningful claim later.

AT-4 is only meaningful once the rubric catalog exists
(`scorecard.rubric_id` is a NOT NULL FK). `node janus/scripts/load-rubric-catalog.mjs`
was run first: 19 profiles, 270 themes, 1350 sub-parameters.

## Baseline failures — recorded, all pre-existing and environmental

These fail on **clean `main`** with no integration applied. They are carried
forward as expected-failure constants, not treated as passing.

1. **`worker/scripts/test-rubric-profiles.ts`** — a Windows line-ending
   artifact, not a code defect. `parseYamlProfilesFromSpec` extracts YAML from
   `docs/QIP_SCORING_V2_1.md` with
   `/```yaml\s*\n([\s\S]*?)\n```/g`. Under `core.autocrlf=true` the checked-out
   file has CRLF endings, and the capture group is left holding a stray `\r`
   after a quoted scalar, so `yaml.parse` raises
   `Unexpected scalar at node end`. Measured directly: **19 of 19 blocks fail
   as checked out, 0 of 19 fail after stripping CR**. Fails identically before
   and after the merge, so it cannot mask a regression.

2. **`node scripts/run-tests.mjs` (worker) cannot run at all on Windows** —
   reported `0/91`, every test failing in under 12 ms with
   `Error: spawn npx ENOENT`. The runner calls
   `spawn("npx", ["tsx", ...])` without `shell: true`
   (`worker/scripts/run-tests.mjs:77`), and Node will not resolve `npx.cmd`
   without a shell (tightened after CVE-2024-27980). `npx.cmd` is present and
   on `PATH`; this is purely the spawn call. Equivalent isolated validation was
   used instead: a scratchpad runner with the identical manifest selection and
   the identical `npx tsx <file>` invocation, differing only by `shell: true`.
   Nothing in the repository was modified. That runner gives **90/91**.

3. **`ai_run_insert` — 2 of 12 checks** (`insertAiRun harness exit 0`,
   `ai_run row inserted`). Two independent causes, both pre-existing:
   the test shells out with `spawnSync("npx", ...)` (cause 2 above, hence
   `status=null`), and the harness itself cannot load anywhere — 
   `janus/tests/ai_run_insert.harness.ts` uses top-level await while neither
   `janus/` nor the repo root declares `"type": "module"`, so tsx compiles it
   as CJS and esbuild rejects it with
   `Top-level await is currently not supported with the "cjs" output format`.
   The 10 passing checks still cover the invariants that matter here:
   `ai_run` RLS fails closed for a non-admin (`visible=0`), and a non-activity
   id is rejected by the FK, which is the canonical-ownership rule.

4. **`npm run test:rules` — BLOCKED and not applicable.** Two independent
   blockers: `rules-tests/run-all.mjs` uses the same
   `spawnSync("npx", ...)` pattern, and the Firestore emulator needs Java,
   which is not installed. It is also **not applicable to this integration**:
   `git diff` shows neither `main` nor the Astra branch touches
   `firestore.rules` or `rules-tests/`, so there is nothing for this gate to
   regress. Marked blocked rather than passed.

## Environment artifacts to be aware of

- `core.autocrlf=true` converts text files to CRLF on checkout. Git normalizes
  back to LF on commit, so the committed diff is unaffected (verified: the
  final diff has no whitespace errors and no EOL-only file changes). It is the
  cause of failure 1 above.
- `web/qc-preview.html` shows as modified after a branch switch. `git diff`
  for it is **empty** — the blob was committed with CRLF, so this is a stat/EOL
  renormalization notice, not a content change. It was never staged and is not
  in the final diff.
