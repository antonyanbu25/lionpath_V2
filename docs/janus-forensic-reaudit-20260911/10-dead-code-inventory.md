# 10 — Dead code, duplicates and reachability

Nothing was deleted in this phase. Audit-only mode.

**Evidence classes:** **VERIFIED** = I read it. **DELEGATED** = produced by a read-only
reachability inventory that computed real import closures (not greps) across web HTML
entries, build entries, the worker route table, regex dispatchers, both test manifests,
all four `package.json` script sets, three CI workflows, both schema-apply paths, and the
cron/scheduler scripts. Closure result: **web 145/154 modules reachable, worker/src
224/254**.

I verified the items I act on or that contradict prior findings.

---

## 1. DEAD-PROVEN

Each is negative on every root: imports, route tables, test manifests, package scripts,
CI, deployment config, feature flags, and git intent.

| Item | Size/scope | Why it died | Deletion group |
|---|---|---|---|
| `worker/zoom-app.js` | **82,638 bytes** of vendored minified Zoom player | arrived in a single bulk baseline-import commit, never wired to anything | **G3** |
| `worker/src/postcall.ts` (incl. `analyzePostCall`) | whole file | superseded by `worker/src/postcall/analyze.ts` | **G2** |
| `janus/schema/19_history_tasks_feedback.sql` | 41 lines | byte-identical duplicate of `20_…`; orphan of a renumbering. **VERIFIED: applied by neither path** (E-019) | **G1** |
| `web/demo-links.js` | `DEMO_LINKS`, `pickDemoLinks` | both symbols referenced only inside the file | **G4** |
| `web/lifecycle-view.js` | `renderLifecycleView` | superseded by `deal-view.js` / `pipeline-view.js` | **G4** |
| `web/recovery/sync-modal.js` + `.css` | 3 exports | superseded by `autoSyncOnLogin`; the product moved from opt-in to automatic. The CSS is in no `<link>` and is not injected | **G5** |
| `web/domain/embed-service.js` | 5 exports | replaced by worker-side `data/embedding-backfill.ts` driven by cron | **G4** |
| `web/domain/write-scope.js` | `resolveWriteScope` | absorbed into `dual-write.js` / `user-resolve.js`. Its only external mention is an **assertion-message string** in a test that does not import it | **G4** |
| `#postcall-loading` | markup + 6 hide-only call sites | all six pass `false`; zero show-true repo-wide, corroborated in the generated bundle. Live replacement is `#postcall-progress` | **G6** |
| **`#prep-loading`** | markup + 4 hide-only call sites | **NEW — the prior audit missed this sibling.** Identical never-shown pattern; live replacement is `#prep-gen-overlay` | **G6** |
| `worker/src/data/repositories/tasks.ts` | whole file | zero importers; live path is `worker/src/tasks.ts` + `tasks-pg.ts` | **G7** |
| `worker/src/video/index.ts`, `video/transcript-cues.ts` | 2 files | no barrel import exists anywhere; live video modules are imported by explicit path | **G7** |
| `worker/src/prep/research-cache-usage.ts` | whole file | telemetry moved to PG `ai_run` | **G7** |
| `worker/src/domain-model/index.ts` + **12 type modules** | barrel + `artifacts, contact-event, contact, deal, lifecycle-event, lifecycle, meddpicc-delta, org, permissions, rubric, team, user` | a v9.3 type surface only partly adopted; live domain-model files are imported by explicit path. **Type-only — erased by `tsc`, so zero runtime impact** | **G8** |

### Two deletion traps

- **Do not co-delete `web/lifecycle.css` with `lifecycle-view.js`.** The stylesheet is
  linked from `web/index.html` and its classes are deliberately reused by
  `web/contact-tile.js`.
- **Do not delete `web/crayons-head.js`.** It is dead as executable code but live as a
  **version-drift anchor**: `test-dew-theme.mjs` reads it as text and asserts the pinned
  Crayons version. Three other copies of that version string exist in HTML and are
  ungated.

### Deliberately quarantined — unreachable, but do NOT delete

**VERIFIED:** `worker/src/routes/analytics.ts` (`handleDirectorAnalyticsGet`) is
registered nowhere, and `routes.ts:95` plus `:3541-3544` document that this is
**intentional**: the handler calls only `requireUser`, with no role check and no org
predicate, so registering it would let any authenticated SE read org-wide volume. There is
a documented re-enable recipe. Classify as unreachable; exclude from deletion. Its only
dependent, `worker/src/analytics/bigquery.ts`, is dead transitively.

---

## 2. Corrections to prior findings

| Prior claim | Correction |
|---|---|
| F-037: `isFirestoreStoreReady` is dead code | **ALREADY REMOVED.** `web/domain/store.js` contains only `fbReadyResolve` / `fbReadyPromise`. Live mentions survive in `README.md:545` and the astra-audit docs — **stale documentation, not dead code** |
| F-037: `janus/schema/19_history_tasks_feedback.sql` should be deleted by P15 | Correct, and still true — but note my `test-ci-foundation.mjs` computes `unaccounted` from files **on disk**, so deleting it keeps the gate green while leaving the `KNOWN_UNAPPLIED` entry stale. **Both must go in the same commit** |
| My own manifest reason: `test-history-pg-backend.mjs` is a placeholder for a module that "does not exist" | **WRONG — see J-027.** `worker/src/history-pg.ts` exists and is imported twice. Corrected in place |

---

## 3. Duplicate implementations

The ones that matter, with the semantic difference — a duplicate that has *diverged* is a
latent regression, not dead weight.

### 3.1 The post-call writer — diverged, and dangerously

`worker/src/postcall.ts` vs `worker/src/postcall/analyze.ts`. Canonical is
`postcall/analyze.ts`. **They are not equivalent:**

| | `analyze.ts` (live) | `postcall.ts` (dead) |
|---|---|---|
| `temperature: 0` | **yes**, with the rationale in a comment | **no** — inherits provider default 0.2 |
| `userId` | yes | no |
| `callId` | yes | no |
| `cachedContent` | yes | no |

So the dead copy is **non-deterministic** — re-analysing one transcript yields a different
`qualityCoach` score — **and** emits no per-user or per-call cost attribution. Git confirms
the divergence: `analyze.ts` alone gained the context-caching and dual-ingest-identity
commits. If anyone ever revived `postcall.ts` thinking it a spare, they would reintroduce
both defects.

### 3.2 Motion logic — duplicated constants, no parity test

`web/domain/se-motion.js` and `worker/src/domain-model/se-motion.ts` are both 64 lines and
both required (browser + worker). The **logic is identical; the constants are not shared**:
the web copy imports the eight team/segment ids from `./constants.js`, while the worker
copy **hardcodes the same eight literals**.

**VERIFIED, and this is directly load-bearing for J-025:** a team-id change in
`web/domain/constants.js` silently desynchronises `post_call.se_motion` stamping. No parity
test exists — and the codebase already demonstrates the right pattern elsewhere
(`test-qip-normalize-parity.mjs`).

### 3.3 Others

| Pair | Canonical | Difference |
|---|---|---|
| `history.ts` / `history-file.ts` / `history-firestore.ts` / `history-pg.ts` | `history.ts` interface | **Not a duplicate** — one interface, three implementations selected at runtime. `history-pg.ts` is dormant only because `HISTORY_BACKEND_MODE` is unset, which no deployment file sets |
| `store.js` + `local-store` / `firestore-store` / `api-store` / `safe-store` | `store.js` factory | **Not a duplicate** — a strategy pattern, all four live |
| `lib/load-env.mjs` vs `lib/load-dev-vars.mjs` | `load-env.mjs` (superset) | **Both active.** `load-env` additionally reads repo-root `.env`; `load-dev-vars` reads only `worker/.dev.vars`. A script using the latter **silently ignores repo-root `.env`** — a live footgun, and 28 files use it |
| `web/shared/mom-email-draft.js` vs `worker/src/postcall/mom-email-draft.ts` | both live | worker copy is a **subset** — missing two exports |
| `web/coach/index.js` (514 lines) vs `worker/src/coach/index.ts` (327) | `web/coach/index.js` | worker copy has zero `worker/src` importers, reached only by its test. The web file's header claims it "mirrors" the worker copy — **the mirror direction is now inverted from reality** |
| `kaiaShare.ts` vs `kaia/fetchShareContent.ts` | `fetchShareContent.ts` | former is TEST-ONLY |
| 5 test harnesses | 3 canonical | the two `janus/` runners are unwired. `run_all_phase_tests.mjs` is a **third hand-maintained schema list** covering only phases 00–06 — superseded by `test-ci-foundation.mjs`, which checks both real apply paths |
| Crayons version pinned in **4 places** | `crayons-head.js` | same value, hand-synchronised, only one of the four asserted |

---

## 4. DEAD-SUSPECTED — evidence deliberately incomplete

| Item | What is missing |
|---|---|
| `janus/tests/run_all_phase_tests.mjs` | only zero-match greps for its invocation; no commit states retirement, and it may be a documented operator command in one of 84 `docs/` files not exhaustively read |
| `worker/src/coach/{index,config,types}.ts` | whether the worker copy is an intentional server-side parity reference or abandoned. **TEST-ONLY, not proven dead** |
| `worker/src/kaiaShare.ts`, `kaia/summaryJsonFormat.ts` | no evidence of deliberate retirement; their tests are registered, so removal breaks the manifest. **TEST-ONLY** |

**Not dead, correctly classified:** `history-pg.ts` / `tasks-pg.ts` are **LIVE but
env-gated** — they require `HISTORY_BACKEND_MODE` or `PERSISTENCE_READ_MODE` = `pg`, which
appears only **commented out** in `worker/.dev.vars.example` and is set by no deployment
file. `janus/scripts/*` and `janus/tests/acceptance/*` are **OPERATOR-ONLY** (referenced
only from `README.md`, absent from CI and all package scripts). `web/dist/*` is
**GENERATED** — `.gitignore`d, zero tracked files, rebuilt by `build.mjs`; never audit it,
never edit it.

---

## 5. Deletion groups

| Group | Contents | Risk |
|---|---|---|
| **G1** | `19_history_tasks_feedback.sql` + its `KNOWN_UNAPPLIED` entry | runtime-neutral |
| **G2** | `worker/src/postcall.ts` | runtime-neutral, **removes a diverged landmine** |
| **G3** | `worker/zoom-app.js` (82 KB) | runtime-neutral |
| **G4** | `demo-links.js`, `lifecycle-view.js`, `domain/embed-service.js`, `domain/write-scope.js` + its lint `ENFORCED` entry | runtime-neutral; **do not touch `lifecycle.css`** |
| **G5** | `web/recovery/sync-modal.{js,css}` | runtime-neutral |
| **G6** | `#postcall-loading`, `#prep-loading` markup + 10 hide-only call sites | runtime-neutral |
| **G7** | `data/repositories/tasks.ts`, `video/index.ts`, `video/transcript-cues.ts`, `prep/research-cache-usage.ts` | runtime-neutral |
| **G8** | `domain-model/index.ts` + 12 type modules | type-surface only, gated by `tsc --noEmit` |

G1–G7 are runtime-neutral. **Recommended order: G3 (largest, zero risk) → G1 → G2 → G7 →
G4 → G5 → G6 → G8**, each its own commit with the suite run between.

---

## 6. ALL EIGHT GROUPS EXECUTED (P-E1)

**26 files deleted, 1749 lines removed, 18 added.** One commit per group in the order
above, with the suite run between each. Final state: worker **105/105**, web **158/158**,
`test:sql-gates` exit 0 across 8 gates, `tsc --noEmit` clean, secret scan clean.

Both documented traps were real and were checked rather than trusted:

- **`web/lifecycle.css` survives.** It is linked live from `web/index.html:31` and its
  contents are asserted by `test-dew-theme.mjs:33`. The name pairing with the dead
  `lifecycle-view.js` is misleading.
- **`web/crayons-head.js` survives.** `test-dew-theme.mjs:62` asserts its
  `CRAYONS_VERSION = "4.3.0-dew.14"` — it is a version-drift anchor.

### A THIRD trap, not in this document

**G6 broke `test-dew-theme.mjs`** (158/158 → 157/158). It asserted
`assert.match(index, /<fw-skeleton/)`, and the two permanently-hidden loading cards held
the **only** static `<fw-skeleton>` elements in `index.html`.

The component is **not** dead — `call-view.js:679` renders it and `dew-theme.css:241` themes
it. Only the static instances were. So the assertion was **redirected to the live render
path**, not deleted: removing it would have quietly retired real coverage along with dead
markup, and the suite going green again would have looked like confirmation.

**The generalisation, which is what makes the remaining deletions safer:** a test can assert
on a *dead* artefact because it is a convenient place to observe a *live* one. That is the
opposite of G1's `KNOWN_UNAPPLIED` entry and G4's `write-scope.js` lint entry, where the
referencing entry was itself dead and had to go in the same commit. Telling the two apart
requires **reading the assertion**, not counting references.

### Two corrections to method

- Reference counts by filename **stem** are useless here. A stem search reported 8 importers
  for `data/repositories/tasks.ts` and 29 for `video/index.ts`; every one was a collision
  (`./tasks` resolves to the live `worker/src/tasks.ts`, and `index.ts` is too generic to
  search for). Resolving actual import specifiers returned zero for both.
- For G8, references **inside** the delete set had to be excluded before judging: `deal.ts`
  imports `./lifecycle`, and both are in the set. A naive importer count would have reported
  both as referenced and blocked a safe deletion.

### Deleting a file is not the whole change

Three groups needed more than a `git rm`, because something still pointed at the corpse:

| Group | The dangling reference |
|---|---|
| G1 | the `KNOWN_UNAPPLIED` entry in `test-ci-foundation.mjs` — an exemption for a file that no longer exists |
| G2 | **six** documentation references, five in `web/about.html` calling `postcall.ts` "the debriefer", plus `postcall-schema.ts`'s header. All redirected to `postcall/analyze.ts`, where `transcriptMeta` is actually computed. Stale docs are how the wrong copy gets revived |
| G4 | the `ENFORCED` lint entry naming `write-scope.js` — a rule that could never fire, which reads as coverage without being any |

G2 is worth its own note: `worker/src/postcall.ts` had `temperature: 0` **×0** and
`recordLlmUsage`/`callId` **×0**, against ×2 and ×2 in the live `postcall/analyze.ts`. So
reviving it would have silently dropped the determinism pin and all cost attribution — the
latter being exactly what P9 had just made work.

**What I would do first regardless of deletion:** add the missing **motion parity test**
(§3.2). It is the only item in this document that protects against a *future* defect rather
than removing a past one, and it guards the constants behind J-025.
