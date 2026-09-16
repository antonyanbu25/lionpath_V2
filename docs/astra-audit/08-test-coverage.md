# 08 — Test Coverage Audit

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Evidence level:** the inventory and manifest reconciliation are CODE-PROVEN. The four SQL-gate results in §5 are **RUNTIME-VERIFIED** — they were actually executed against the disposable local database described in [05](05-runtime-sql-verification.md) §1.1.
**Related:** [_evidence-index](_evidence-index.md) · [06-bugs-and-risks](06-bugs-and-risks.md) · [11-implementation-prompts](11-implementation-prompts.md)

---

## 1. Inventory

| Directory | Test files | Discovery mechanism |
|---|---|---|
`web/scripts/` | **158** `test-*.mjs` | `web/scripts/test-manifest.mjs` — hand-maintained array |
`worker/scripts/` | **108** `test-*.{ts,mjs}` | `worker/scripts/test-manifest.mjs` — hand-maintained array |
`janus/tests/` | **11** `*.test.mjs` | **none** — driven only by hand-written `&&` chains in `worker/package.json` |
`rules-tests/` | **9** `*.test.mjs` | directory glob in `rules-tests/run-all.mjs:15-17` |
`janus/scripts/`, root `scripts/` | 0 | — |
| **Total** | **286** | |

Manifest entries: web **153** (`unit` 132, `e2e` 15, `manual-only` 6); worker **100** (`unit` 89, `live-api` 8, `emulator` 2, `manual-only` 1).

## 2. Reconciliation — 13 orphan test files

On disk, in **no** manifest, therefore run by nothing:

**`web/scripts/`** — `test-adr008-read-contract.mjs`, `test-local-recovery.mjs`, `test-postcall-domain-routing.mjs`, `test-writemode-fallback.mjs`, `test-manifest.mjs` (the manifest itself — benign).

**`worker/scripts/`** — `test-history-pg-backend.mjs`, `test-persistencereadmode-gate.mjs`, `test-pg-read-repository.ts`, **`test-postcall-update-idempotency-conflict.ts`**, `test-prep-save-fix.mjs`, `test-recovery-route.ts`, `test-scorecard-retry.mjs`, `test-user-usage.mjs`.

**The clustering is the finding.** Five of these are the entire ADR-008 / PostgreSQL persistence lane — exactly the surface where this audit found its P0s:

| Orphan | Would have caught |
|---|---|
`test-postcall-update-idempotency-conflict.ts` | the `activity` half of the idempotency-conflict family (F-001's neighbourhood) |
`test-pg-read-repository.ts` | read-repository regressions incl. `provisional` derivation (F-006) |
`test-history-pg-backend.mjs` | `user_kv` history backend behaviour |
`test-persistencereadmode-gate.mjs` | the read-mode gate (F-019) |
`test-adr008-read-contract.mjs` | the read contract — **and it is permanently dead anyway**, see §4 |

**Ghost entries: none.** Both manifests reference only files that exist, and neither has a duplicate `file` key.

**Not covered by any manifest at all:** all 11 `janus/tests/` files and all 9 `rules-tests/` files. `rules-tests` compensates with a directory glob; `janus/tests` has no discovery mechanism whatsoever.

`worker/scripts/test-manifest.mjs:250-254` lists **itself** as a `unit` test. The runner spawns it, it imports a module that exports an array, and exits 0. It asserts nothing, can never fail, and inflates the worker pass count by one.

## 3. What CI actually runs

| Workflow | Trigger | Commands | Tags executed |
|---|---|---|---|
`ci.yml` | push + PR on `**` | matrix `[worker, web, rules]`; `npm test` for web and (inside `firebase emulators:exec`) worker; `npm run test:rules` | web `unit`+`e2e`; worker `unit`+`emulator`; 9 rules tests |
`promotion-gate.yml` | **`workflow_dispatch` only** | web `npm test`, worker `npm test` under the emulator, `test:rules`, `eval:prep-golden`, `eval:self-consistency` — every step `continue-on-error: true` with an aggregating gate | same as ci, plus two live-Gemini evals |
`eval-nightly.yml` | cron `0 6 * * *` | `eval:prep-golden`, `eval:self-consistency` only | **zero** manifest tests |

### Never executed by any workflow

- **worker `live-api` (8 files)** — `eval-nightly.yml`'s header claims live-API work "runs on its own cadence", but no workflow ever invokes `--tag=live-api`. Two of those files hardcode absolute paths under another developer's home directory and can never pass on any other machine (`E-130`).
- **web `manual-only` (6 files)** — intentional, documented ("targets live production URL").
- **worker `manual-only` (1)** — `test-zoom.mjs`, intentional.
- **All 11 `janus/tests/` files**, including every SQL gate and all 7 acceptance tests.
- **Thirteen npm scripts with zero workflow references**: `test:sql-gates`, `test:janus-smoke`, `test:view-rls`, `test:dual-soak`, `test:sql-network`, `test:api-store-parity`, `test:prep-payloads`, `test:fast`, `test:e2e`, `test:emulator`, `test:live-api`, `test:build`, **`typecheck`**.

**`tsc --noEmit` never runs in CI** (`E-126`). It is reachable only inside `test:sql-gates`, which no workflow calls.

**No workflow provisions a PostgreSQL service container.** Every one of the 12+ PG-dependent tests is unreachable in CI (`E-127`).

### Two CI defects

1. **`promotion-gate.yml` has no `setup-java` step** yet runs `firebase emulators:exec` (`:51`) and `npm run test:rules` (`:56`). `ci.yml:19-23` documents that firebase-tools requires JDK 21 and that ubuntu-latest's default Java fails. Both emulator legs of the promotion gate are therefore expected to fail — and every step is `continue-on-error: true` (`E-128`).
2. **`web/scripts/run-tests.mjs:123`** silently drops all 14 shared-e2e tests whenever any unit test fails — no message, and the final `N/M passed` line shows a shrunken denominator (`E-125`). The job still exits non-zero from the unit failure, so it is not a false green; but e2e coverage disappears exactly when a regression is in flight.

## 4. Tests that can silently no-op and still exit 0

### Permanently dead today

**`web/scripts/test-adr008-read-contract.mjs:9-12`**

```js
if (!/PERSISTENCE_READ_MODE/.test(routesSource)) {
  console.log("test-adr008-read-contract.mjs: pending (routes.ts read-flip gate not present yet)");
  process.exit(0);
}
```

`grep -c PERSISTENCE_READ_MODE worker/src/routes.ts` → **0**. The variable is threaded through `node-server.ts`, not `routes.ts`, so the guard's regex points at the wrong file and can never un-fire. Its three assertions have never executed. It is also an orphan, so nothing runs it either way (`E-122`).

### Silent skip on missing `DATABASE_URL`, exit 0

| Test | Guard | What is skipped |
|---|---|---|
`janus/tests/grants_smoke.test.mjs:44-47` | `if (!process.env.DATABASE_URL) { console.log(...); return; }` | 4 grant classes + 6 REVOKE checks |
`janus/tests/rls_fails_closed.test.mjs:44-47` | same | all 5 fails-closed scenarios, **including the "no session vars → 0 rows" case the file's own header calls "the migration's most dangerous failure mode"** |
`janus/tests/ai_run_insert.test.mjs:51-54` | same | telemetry insert + RLS |
`janus/tests/acceptance/lib/harness.mjs:157-164` → 7 acceptance tests | `if (!APP_URL \|\| !MIG_URL) return false;` then `process.exit(0)` | all of AT1–AT7 |
`janus/tests/acceptance/run_acceptance.mjs:48-58` | same | the whole acceptance runner |

**Only `janus/tests/view_rls.test.mjs:21-24` hard-fails on missing env** — the correct pattern, and the model the others should follow.

`worker/scripts/verify-sql-network.mjs:109-113` skips only behind an explicit `--allow-skip` flag. Also correct.

### The `test:sql-gates` chain is structurally broken

```
node grants_smoke && node rls_fails_closed && node view_rls && node ai_run_insert && tsx dual-write-soak && tsc --noEmit
```

Without `DATABASE_URL`: links 1–2 skip-and-exit-0, link 3 (`view_rls`) hard-exits 1, and the `&&` chain short-circuits — so `ai_run_insert`, `dual-write-soak` **and `tsc --noEmit`** never run. If anyone ever "fixed" `view_rls` to skip like its siblings, the gate would report green having asserted nothing. No workflow calls it either way.

### Partial skips — the body runs, the substantive block does not

| Test | Guard | Consequence |
|---|---|---|
`worker/scripts/test-api-store-parity.ts:65-80` | `if (!TEST_OWNER_ID)` | degrades to an accounts-only smoke; skips `listPostCallsByOwner`, `getPostCall`, `listScorecardsByCall`, `listDealsByOwner`, `getDeal` parity. Against an empty project it prints `OK listAccounts` (both `[]`) and exits 0 having compared nothing. Also `live-api`, so CI never runs it. **Effectively inert.** |
`worker/scripts/test-batched-hydration.ts:180-219` | `if (!TEST_OWNER_ID) return` | the live block is skipped; the CI-visible fixture assertion is **near-tautological** — both "serial" and "batched" paths feed identical in-memory data to the same function and perform no reads (`E-129`) |
`worker/scripts/test-postcall-cache.mjs:86-90` | `console.warn` where an assertion belongs | "short fixture must skip caching" can never fail the test |
`web/scripts/test-auth-login-f5acac.mjs:62-64` | a runtime DOM state | the entire login+dashboard assertion block is skipped when the dev server serves the Firebase SSO shell |
`worker/scripts/test-deck-validate.ts:250-252` | export presence | prompt-containment silently unverified on a rename |

### Inert but self-healing

`test-history-pg-backend.mjs:67-71` and `test-pg-read-repository.ts:192-196` guard on `optionalImport` returning null. Both target files **do** exist, so the guards do not fire — but both tests are orphans. Note that a *compile* error surfacing as a resolution failure would be reported as "pending" and exit 0.

## 5. SQL gates — actually executed (RUNTIME-VERIFIED)

Run against the disposable local cluster ([05](05-runtime-sql-verification.md) §1.1):

| Test | Result | Assessment |
|---|---|---|
`janus/tests/grants_smoke.test.mjs` | **18/18 PASS**, exit 0 | Genuine. `janus_app` grants correct; REVOKEs on `deal_stage_history`, `audit_log`, `score_override`, `contact_merge_log` all hold with `42501`. Two weak checks: the 8 `SELECT <table>` probes only assert `typeof n === 'number'`, and `check('DELETE org_unit', true)` is a hardcoded pass. |
`janus/tests/rls_fails_closed.test.mjs` | **8/8 PASS**, exit 0 | Genuine and valuable. No session vars → 0 deals; a typo'd `app.org_path` does not widen access; cross-org isolation holds; admin sees all. Note the file's docstring is stale relative to its own case 3. |
`janus/tests/view_rls.test.mjs` | **4/4 PASS**, exit 0 | Genuine. `security_invoker` on `v_deal_traction` / `v_org_metrics` really does enforce base-table RLS. |
`janus/tests/ai_run_insert.test.mjs` | **2 checks FAILED, exit 1** | `ai_run_insert.harness.ts` cannot load: top-level `await` in a `.ts` file that `tsx` resolves as CJS. `insertAiRun` therefore has **no working test** (`E-120`, `R-007`). The test is honest — it exits 1. Nothing runs it. |
`worker/scripts/test-postcall-update-idempotency-conflict.ts` | **PASS** ("ok"), exit 0 | A genuine, correct regression guard that CI never executes. See §6. |

**The single most reassuring result in this audit: the RLS and grants layer works.** Where SQL rows exist, they are correctly isolated. That is the foundation the remediation plan can build on.

## 6. What the key tests actually assert

### `test-postcall-update-idempotency-conflict.ts` — the four cases

The brief asked not to assume this file covers all four orderings. It does not.

| Case | Covered | Evidence |
|---|---|---|
(a) same public ID, different idempotency keys | **partially — `activity` only** | `runSamePublicIdDifferentIdempotencyKeyRegression:178-257`. The divergent keys are applied to `upsertActivity` (`:184`, `:205`); **`postCallIdempotencyKey` is identical in both `upsertPostCall` calls** (`:193`, `:232`). The production F-001 scenario — same `post_call.public_id`, *different* `post_call.idempotency_key` — is **not exercised** (`E-124`). |
(b) different public IDs, same idempotency key | **yes, well** | `runSameIdempotencyKeyDifferentPublicIdRegression:101-176`; asserts the existing row is reused, the new `public_id` is remapped in `id_registry`, and `analysis`/`detail`/`pipeline_state` all update |
(c) history-SQL-before-domain-SQL ordering | **no** | zero references to `tryHistoryPostCallSqlWrite`, `trySqlDomainWrite`, `/api/history` or ordering. It drives `repo.*` directly, bypassing `routes.ts` |
(d) initial history SQL skipped, then later history patches | **no** | the history code path is never touched |

It also hardcodes `pipelineState: "detail_done"` — proving the repository *can* write that value, while no application code ever does (F-006).

**Verdict: a correct and useful test, orphaned, and blind to the exact production interleaving that fails.** The repro harnesses in [`repros/`](repros/) close cases (a)-for-`post_call` and the destructive-UPSERT branch; (c) and (d) remain uncovered anywhere.

### `*history*sql*` — no such test exists

`find` for `*history*sql*` / `*sql*history*` → **zero** files. Greps for `trySqlHistoryWrite`, `historySql`, `history_sql`, `sqlHistory` across `worker/src`, `worker/scripts`, `web`, `janus` → **zero** matches.

`tryHistoryPostCallSqlWrite` (`routes.ts:2915`) — the writer responsible for F-001, F-005 and F-006 — **has no test at all.** Neither does the ordering relationship between it and `trySqlDomainWrite`. This is the single largest coverage hole in the repository.

### `*sql*gate*` — no test file, only the broken npm chain in §4.

### `test-schema-drift.ts` — a false lead

Despite the name it has nothing to do with SQL files or installers. It replays a fixture through `normalizePostCallOutput` and asserts no expected top-level Gemini field was dropped. Two weaknesses: the check is one-directional (a field *added* passes silently), and if `_capturedAt === null` (a hand-built placeholder fixture) it prints a NOTE but does not fail. It is tagged `unit`, so it does run.

`.github/workflows/promotion-gate.yml:6` claims the gate runs "the schema-drift test" as a distinct item. It does not; the coverage is incidental, and it is about LLM output fields, not schema.

**Nothing anywhere compares `init_all.sql`'s `\ir` list to `apply-janus-schema.mjs`'s `PHASE_FILES`, or either to `readdirSync('janus/schema')`.** `.github/workflows/ci.yml` has zero matches for `schema`, `.sql` or `migration`. A third hand-maintained list in `janus/tests/run_all_phase_tests.mjs:30-37` covers only phases 00–06 and merely string-matches file contents. Three lists, three divergences, no guardrail (F-020).

### `test-postcall-hydration-sequencing.mjs` — honest but brittle

A structural source-regex check over `web/postcall.js` (it says so at `:18-20`: postcall.js "can't be unit-imported directly"). It asserts `handleQualify`/`handleSummarise` exist as async closures joined by `Promise.all`, and that `videoP` is **not** in that barrier and is handled by its own `.then`. Correct intent; any rename breaks it, and a real sequencing regression that preserves those identifiers passes.

### `test-api-store-parity.ts` — effectively inert

Every assertion is data-dependent (`if (repoAccounts[0]?.id)`, `if (repoCalls[0]?.id)`, `if (repoDeals[0]?.id)`). Against an empty project it compares `[]` to `[]` and exits 0. Combined with the `TEST_OWNER_ID` skip and the `live-api` tag, it has almost certainly never verified parity.

## 7. Critical behaviours vs. effective tests

| Behaviour | Test exists? | In a manifest? | CI runs it? | Executes behaviour? | Can pass while broken? |
|---|---|---|---|---|---|
Post-call initial save → SQL (`tryHistoryPostCallSqlWrite`) | **no** | — | — | — | **n/a — untested** |
History/domain dual-writer **ordering** | **no** | — | — | — | **n/a — untested** |
`post_call` same-public-id / different-key conflict | **only via this audit's repro** | no | no | yes | — |
Destructive `detail` UPSERT | **only via this audit's repro** | no | no | yes | — |
Hydration → normalized SQL | **no** | — | — | — | **n/a — untested** |
Hydration **sequencing** | yes | yes | yes | **no — source regex** | **yes** |
`pipeline_state` transitions | no application-level test | — | — | — | **n/a** |
SQL write proof end-to-end | `dual-write-soak.ts` | no | **no** | yes | — |
API-store parity | yes | yes (`live-api`) | **no** | data-dependent | **yes** |
SQL-only no-fallback (501 mode guard) | `test-adr008-read-contract.mjs` | **no** | no | **no — permanently dead** | **yes** |
Read-mode gate | `test-persistencereadmode-gate.mjs` | **no** | no | yes | — |
RLS / session resolution | yes ×3 | no | **no** | **yes** | no — **and they pass** |
`ai_run` insert | yes | no | no | **cannot load** | no — it fails |
Scorecard ↔ video dependency | no | — | — | — | **n/a** |
Pass 4–9 persistence | no | — | — | — | **n/a** |
ARR / timeline / gaps persistence | unit tests for the *computation* only | yes | yes | yes (compute) | **yes — persistence untested** |
Recovery / replay | `test-recovery-route.ts`, `test-local-recovery.mjs` | **both orphans** | no | yes | — |
Idempotency | `test-postcall-update-idempotency-conflict.ts` | **orphan** | no | **yes, and it passes** | — |
Configuration matrices | `test-node-boot.mjs` (boot guards) | yes | yes | yes | partial |
Schema installer parity | **no** | — | — | — | **n/a** |
Zoom `zoomShare.ts` network layer (5 HTTP calls, cookie jar, SSO sniffing, **both CAPTCHA branches**) | **no** | — | — | — | **n/a — untested** |
Firestore rules ↔ RLS parity | `test-firestore-rules-smoke.mjs` | yes | yes | **no — regex over `firestore.rules`; it documents its own gap at `:18-19`** | **yes** |

## 8. Every critical untested behaviour, with the test required

Ordered to match [10-remediation-plan](10-remediation-plan.md). Full specifications are in [11-implementation-prompts](11-implementation-prompts.md).

| # | Untested behaviour | Required test |
|---|---|---|
T1 | `upsertPostCall` must never null a non-null `detail`, `transcript_ref` or regress `pipeline_state` | promote [`repros/repro-h1-…ts`](repros/repro-h1-detail-erasure-and-pipeline-regression.ts) into `worker/scripts/test-postcall-detail-merge.ts`, add to the manifest, add a PG service container to `ci.yml` |
T2 | The two writers must converge on one row for one call, in **both** orders | promote [`repros/repro-h2-…ts`](repros/repro-h2-dual-writer-idempotency-collision.ts), then extend to cases (c) and (d) by driving `handleHistoryPost` and `handleDomainWrite` as HTTP handlers rather than the repository directly |
T3 | Every hydrated artefact must reach a proven destination | a fixture post-call driven end-to-end, then one assertion per artefact from [03](03-postcall-write-ledger.md) §2 — asserting **presence**, not just row existence |
T4 | `pipeline_state` must advance and never regress | state-machine test over the six enum values, plus an assertion that `provisional` becomes false |
T5 | Concurrent history patches must not lose updates | deterministic two-writer concurrency repro against `saveHistoryEntry` |
T6 | `/api/calls/:id/offload-payload` must reject a cross-tenant id | authz test mirroring the GET sibling |
T7 | `/api/feedback?global=1` and `/api/search/rag` must require auth | route authz tests |
T8 | Health endpoints must be registered and return 200 | route-registration test asserting every handler exported from `routes/*.ts` is reachable, which would also have caught the 4 dead internal routes |
T9 | Schema installer parity | assert `init_all.sql`'s `\ir` list === `PHASE_FILES` === `readdirSync('janus/schema')` minus `init_all.sql` |
T10 | `ai_run` must be joinable to `post_call` | fix the harness's module format, then assert `activity_id IS NOT NULL` for every pass of a fixture post-call |
T11 | Every provider call must have a timeout | static test asserting no bare `fetch(` to a provider host outside `fetchGeminiWithRetry`, plus that `POSTCALL_PASS_NAMES` covers every post-call `passName` |
T12 | Zoom: transcript-ready / delayed / absent / passcode / CAPTCHA / SSO-redirect | mocked-`fetch` suite over `zoomShare.ts` and `zoom-api.ts` — the highest-value new test file in the repo |
T13 | Intake: the Analyse button must enable without a completed network lookup | unit test over `computeAnalyzeButtonDisabled` plus a Playwright journey counting clicks and waits |
T14 | Saved-call open must issue one paint and no duplicate queries | instrumented render test asserting paint count and request count |

## 9. Structural recommendations

1. **Add a PostgreSQL service container to `ci.yml`.** Nothing else on this list matters until PG runs in CI: 12+ tests and every SQL gate are currently unreachable, and three of them exit 0 rather than failing.
2. **Make missing `DATABASE_URL` a hard failure** in `grants_smoke`, `rls_fails_closed` and `ai_run_insert`, matching `view_rls.test.mjs:21-24`. Keep an explicit `--allow-skip` for local use.
3. **Add `typecheck` to `ci.yml`.** `tsc --noEmit` has never run in CI.
4. **Adopt manifest-by-discovery**: fail the build when a `test-*` file on disk is absent from the manifest. That single rule eliminates the orphan class permanently.
5. **Give `janus/tests/` a runner and a manifest.** Eleven tests, including every SQL gate, are currently invoked only by hand-written `&&` chains that no workflow calls.
6. **Add `setup-java` to `promotion-gate.yml`** and drop `continue-on-error: true` from the emulator legs, or the gate cannot fail for the reasons it exists to catch.
7. **Fix `web/scripts/run-tests.mjs:123`** so a unit failure does not silently drop 14 e2e tests.
8. **Delete or fix the tautologies**: `test-manifest.mjs` self-listing, `test-batched-hydration.ts`'s fixture assertion, `check('DELETE org_unit', true)`, and `test-postcall-cache.mjs`'s `console.warn`-instead-of-assert.
9. **Add a secret-scanning step.** Nothing in `.github/workflows/` scans for credentials; F-025 (a committed Zoom recording passcode) would have been caught at commit time.
