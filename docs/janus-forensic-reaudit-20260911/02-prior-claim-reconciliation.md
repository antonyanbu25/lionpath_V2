# 02 — Prior claim reconciliation

Every inherited claim, reconciled against the current branch. Statuses use the prompt's
vocabulary: `FIXED-AND-VERIFIED`, `PARTIAL`, `REGRESSED`, `STALE`, `STILL-OPEN`,
`RUNTIME-BLOCKED`.

Claims I verified **personally** against source, schema or live staging carry evidence
IDs into `_evidence-index.md`. Claims I read only in documents are labelled as such and
are **not** treated as evidence — the inherited corpus contradicts itself in several
places, so its own assertions cannot settle anything.

---

## 0. The most important reconciliation: the corpus contradicts itself

Before any individual item, the inherited evidence has a structural problem that changes
how all of it should be read.

| Document | Says |
|---|---|
| `docs/astra-audit/11-implementation-prompts.md:6` | "**None of these were executed during the audit.**" |
| `docs/astra-audit/_audit-state.md:117` | "No implementation prompt executed." |
| `docs/astra-audit/00-executive-summary.md:271` | gate G "complete — prompts created, none executed" |
| `docs/astra-audit/13-handoff-next-session.md:11` (git-only, not on this branch) | "All **four functional prompts** are implemented and unit-tested" |

Both are true of different moments; neither file knows about the other. The handoff doc
exists only in git object `f6cfbbd` on local `main` and is **absent from the working tree
of the branch under audit** — so a reader who checks out this branch and reads
`docs/astra-audit/` will conclude no work has been done, which is wrong.

Similarly, `docs/datamodel/README.md:29-30` states "**not one acceptance test has ever
run against a live schema**" while `docs/datamodel/RUN_LOG.md:133` reports
"AT-1 10/10 · AT-2 13/13 · AT-3 23/23 · AT-4 19/19 · AT-5 17/17" against Cloud SQL. And
`RUN_LOG.md:609` announces "Firestore is no longer a write target" while `RUN_LOG.md:691`
— the same file, later — retracts it: "My previous claim of 'no Firestore write target'
was wrong."

**Consequence:** picking a document at random yields a different answer to "is Firestore
still authoritative", "has the cutover happened", and "has anything been tested". The
newest statement inside `RUN_LOG.md` generally wins (that file is chronological, oldest
first, per its own line 12), but its sibling documents were never updated. Treat the
document set as a **history of beliefs**, not a description of the system.

---

## 1. The four "functional" prompts reported complete

| Prompt | Prior claim | Status now | Evidence |
|---|---|---|---|
| **P6** — register unreachable routes | done (handoff §1) | **FIXED-AND-VERIFIED** | The route table registers the health, internal-batch and read-models routes; `/api/analytics/director-summary` is still deliberately unregistered (`routes.ts:3541-3544`), which P4 requires. E-061 |
| **P12** — streamline post-call intake | done, "~100 duplicate bindings deduped" | **PARTIAL → now complete** | The dedup landed, but the button gate did **not**: `#analyze-call` was enabled-and-visible for ~87ms with empty fields. Reproduced and fixed this session (J-014). E-046, E-047, E-048 |
| **P13** — Zoom acquisition | done | **PARTIAL** | Timeouts existed on the *retry helper* but three Zoom fetches had none at all — found and fixed under P10 (E-071). The "transcript still processing" polling path exists (`postcall.js:3140`) and is `CODE-PROVEN`; the live Zoom path is `RUNTIME-BLOCKED` (no Zoom credentials on this machine) |
| **P14** — one view-state model | done "in scoped-down, lower-risk form" per the handoff's own caveat | **PARTIAL** | The realtime-subscription leak fix is present. The single-state-model goal is not met: `setButtonLoading` remained a second authority over `#analyze-call.disabled`, which is precisely what J-014 was. The handoff's warning to "read the commit messages before assuming anything was done exhaustively" was well placed |

---

## 2. The unresolved bug the handoff escalated

| Prior claim | Status | Evidence |
|---|---|---|
| "press [Analyse call] twice, that is the issue" — one click produced **three** `POST /api/postcall/resolve`; one identified as warm-up, "the other two are unexplained"; "**not root-caused**" | **STALE as diagnosed; fully explained now** | The three requests are **two warm-ups plus one submit**, not a duplicated submit. `zoomPreResolveWarmedKey` is keyed on the recording link, so paste-then-correct re-arms it. The submit path issues exactly one request per gesture across five scenarios including rapid double-click and the exact reported Zoom OAuth 400. E-044, E-045 |

The handoff's three "ruled out" items were all correct — `pass0Busy`,
`resolveWithZoomPendingRetry`'s retry condition, and `runZoomPreResolve`'s dedup key are
each sound. What it missed is that the dedup key is *per link*, so two different links
legitimately produce two warm-ups. The submit-path invariant it was trying to protect was
never broken.

---

## 3. The nine astra-audit findings owned by no prompt

`docs/astra-audit/` defines F-001…F-039. Ten of them are claimed by no P-numbered prompt
(F-007, F-008, F-009, F-019, F-020, F-021, F-024, F-028, F-036, F-039). Of these:

| Finding | Prior claim | Status now | Evidence |
|---|---|---|---|
| F-020 — migration 34 applied by no automated path | `RUNTIME-VERIFIED` | **FIXED-AND-VERIFIED, and it was worse than recorded.** Three files (34, 35, 36) were missing from `PHASE_FILES`, not one. Adding them exposed a second latent defect: the schema was **not idempotent** with 34 present (J-017). Both fixed; both paths now list 42 files in the same order | E-063, E-064, E-065 |
| F-019 — `PERSISTENCE_MODE` has multiple defaults | `CODE-PROVEN` | **STILL-OPEN**, and quantified: **three different defaults across five surfaces** (J-007) | E-024 |
| F-023 — `ai_run` ~0% attributable | `CODE-PROVEN` + `RUNTIME-VERIFIED` | **STILL-OPEN**, now measured: **4 of 2816 rows (0.14%)** have an `activity_id` (J-019) | E-082 |
| F-006 — `pipeline_state` meaningless | `CODE-PROVEN` | **STILL-OPEN**, measured: `analysis_done` on **345/345** rows (J-012) | E-033 |
| F-025 — committed Zoom credential | `CODE-PROVEN` | **FIXED-AND-VERIFIED for the working tree**, and a **second exposure found that F-025 missed** (J-016). History exposure remains — 4 commits — and is not remediable by deletion | E-052…E-056 |
| F-038 — CI has no PostgreSQL, no typecheck, silent skips, 13 orphan tests | `CODE-PROVEN` | **FIXED-AND-VERIFIED.** All four sub-claims addressed; the orphan count was exactly 13 | E-075…E-081 |
| F-004 / F-010 / F-011 — three authorization holes | `CODE-PROVEN` | **FIXED-AND-VERIFIED.** All three re-confirmed open in source before being changed | E-026…E-028, E-059, E-060 |
| F-027 — three provider calls lack timeouts | `CODE-PROVEN` | **FIXED-AND-VERIFIED, and larger than recorded:** ten files, not three, including the Firebase JWK fetch on the critical auth path | E-071 |

---

## 4. The database workstream (P2, P3, P7, P8, P9, P11)

The merge audit is explicit that it proved the merge **preserved** database code, not that
any invariant holds — `docs/merge-audit/DATABASE_GUARDRAIL_REPORT.md:39` says so in those
terms. Reconciled against live data:

| Prompt | Invariant | Status | Evidence |
|---|---|---|---|
| **P2** — non-destructive post-call UPSERT | sparse writes must not null hydrated fields | **STILL-OPEN.** `docs/SQL_QA_VALIDATION.md:36-38` (#6 destructive partial patch) and `:52-54` (#10 shape validation 500s) are recorded CONFIRMED and not marked fixed. Not independently re-verified this session — deferred to `07-acid-concurrency-recovery.md` | document claim |
| **P3** — writer convergence | one `post_call` per call, either arrival order | **PARTIAL.** AT-2 covers *sequential* re-analysis by one writer (13/13, `RUN_LOG.md:133`). No document tests concurrent writers or arrival order. `SQL_QA_VALIDATION.md:60` records an unresolved `ON CONFLICT (public_id)` vs UNIQUE `activity_id` mismatch | document claim |
| **P7** — hydration persistence | every artefact reaches its destination | **CONTRADICTED BY DATA.** `RUN_LOG.md:729` claims "write methods with a Postgres path — 50/50". Measured: **283 of 345 post-calls have no scorecard** (J-020). Per-method reachability was proven; per-artefact arrival was not, and does not hold | E-083 |
| **P8** — pipeline state | derived from real artefacts, monotonic | **STILL-OPEN.** No in-scope document mentions `pipeline_state` at all. Measured: one value on every row | E-033 |
| **P9** — AI-run attribution | attributable to user and final activity | **STILL-OPEN**, and the worst-quantified finding in this audit: 0.14% | E-082 |
| **P11** — bulk/recovery projection | projects every valid call, no Firestore dependency | **STILL-OPEN and documented as not working.** `sync_outbox` pending has grown **107 → 236** (J-021) | E-084 |

---

## 5. Merge-audit claims that are now stale

| Claim | Source | Current reality | Evidence |
|---|---|---|---|
| `main-with-functional-fix` and `main` are distinct refs with distinct roles | master prompt § Repository direction | **Identical SHA** `5121bc4` | E-002 |
| main @ `a4d5cb7`, source @ `5121bc4` | merge report | `a4d5cb7` is now an ancestor; `origin/main` is `5121bc4` | E-002 |
| "the entire persistence layer is untouched" | `FINAL_VALIDATION_REPORT.md:26-34` | True of the merge. No longer true of this branch — P5 and J-010 changed `session-context.ts`, `fallback-log.ts`, and added migration 37 | this branch's diff |
| Web baseline "148/148, zero failures" | `MAIN_BASELINE.md:35` | Could not be reproduced as stated. Measured baseline at `5121bc4`: web unit **136/136**, and 6+ e2e specs time out. The difference is J-015 — `networkidle` cannot settle against the looping `login-bg.webm`, which is environment-dependent | E-029, E-049 |
| Worker baseline 90/91 | `MAIN_BASELINE.md:36` | Measured 90/93 at `5121bc4` — three failures, not one. All three environmental | E-043 |
| `ai_run_insert` "2 of 12 checks cannot run" (top-level await in CJS) | `MAIN_BASELINE.md:81-91` | **FIXED-AND-VERIFIED.** Root cause was tsx emitting CJS for `janus/`. Now **15/15** | E-078, E-079 |
| Authorized networks are `0.0.0.0/0` | `docs/CLOUDSQL_SECURITY.md:11` | **STALE** — the instance enforces a `/32` allowlist. The doc overstates exposure | E-013, E-014 |
| Instance is `janus-pg-dev`; target is Postgres 15 | `deploy/cloudsql/README.md:33`, `provision.sh:19,33` | **STALE** — live instance is `janus-db` running **16.14** | E-007, E-012 |
| `v_se_score_leaderboard` "created by migration 34, read by nothing" | `docs/astra-audit/04-sql-persistence-map.md:102` | **PARTIAL.** Still read by no product code — but it now **exists on staging** and returns 3 rows, so migration 34 was applied there by hand | E-021, E-087 |
| "All 288 post-calls read `new_business` with source NULL" | `docs/datamodel/RUN_LOG.md:237` | **CONFIRMED and grown: 345/345**, source NULL on all. Pattern unchanged | E-032 |
| "107 `sync_outbox` rows pending — the projector is not running" | `RUN_LOG.md:233` | **CONFIRMED and worse: 236** | E-084 |
| "25 of 46 roster people unprovisioned" | `RUN_LOG.md:111-114` | **SUPERSEDED.** 37 active `app_user` rows exist, but **16 (43%) have no `org_unit_id`**, which is what RLS scopes on — a different and still-live defect (J-022) | E-085 |
| `scorecard` = 0 rows | `RUN_LOG.md:232` | **STALE** — 62 scorecards now exist, with 3900 lines and zero orphans. The gap moved: it is now the 283 calls *without* one | E-083 |
| "Rotate credentials — both database passwords were pasted in chat" | `RUN_LOG.md:238` | **STILL-OPEN, and repeated.** A database password was pasted in chat again this session, and a Zoom passcode was printed into the transcript by my own under-specified redaction. Three rotations are now owed | J-016, P1 §disclosure |
| `nodejs_compat` relevance unresolved (A-07) | `ASTRA_CHANGE_MATRIX.md:47` | **RUNTIME-BLOCKED** — needs deployed Cloudflare/Cloud Run config; no `gcloud` available | B-04 |
| BigQuery analytics deliberately unreachable | `DATABASE_GUARDRAIL_REPORT.md:144-145` | **CONFIRMED unchanged** — `handleDirectorAnalyticsGet` remains registered nowhere | E-061 |

---

## 6. Claims that could not be reconciled at all

| Claim | Why blocked |
|---|---|
| Anything about the **deployed** `PERSISTENCE_MODE`, `PERSISTENCE_READ_MODE` or `HISTORY_BACKEND_MODE` | Requires reading Cloud Run env vars. No `gcloud` (B-04). This is the single most consequential unresolved question in the audit — see `03-current-architecture.md` |
| Whether RLS and grants behave correctly **as `janus_app` on staging** | Only a superuser credential was available, which is the one the prompt says is insufficient (B-07). Verified on the local cluster instead, where `janus_app` behaves correctly |
| Live Zoom transcript acquisition | No Zoom Server-to-Server credentials (`ZOOM_ACCOUNT_ID`/`CLIENT_ID`/`CLIENT_SECRET` unset) |
| Firestore rules behaviour | No JDK, so the emulator cannot run (B-03). Unchanged from the merge audit, which also could not verify them |
| Whether the source branch was the **latest** `origin/main-with-functional-fix` | `git fetch` fails, no credential helper (B-01). Refs are as of 2026-09-11 16:01 |
