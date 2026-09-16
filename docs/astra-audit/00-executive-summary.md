# 00 — Executive Summary

**Snapshot audited:** `SE-Labs` @ `c58eac930f8676e73a8406b9909c87b3f179b21c`, branch `main`, `VERSION` 2.1.30. Audit run 2026-09-08.
**Scope:** audit-only. No product code, test, migration, dependency, deployment, infrastructure or environment file was modified. No production, staging or shared database was contacted. No paid external API was called.
**Evidence:** every claim carries an ID in [_evidence-index](_evidence-index.md). Two P0/P1 findings were **reproduced against a live database**; four SQL gate suites were **actually executed**. All performance durations are an explicitly-labelled static model, because the telemetry that would give real numbers is itself broken (F-023).

---

## The one-sentence answer

> **Is this system genuinely wired correctly from browser action to final durable PostgreSQL state?**

**No.** The post-call pipeline computes 20 artefacts and durably persists 2 of them. The other 18 live in a JSON blob in browser localStorage plus one server-side key-value document. Two SQL writers race for the same row with different idempotency keys, the second one aborts its entire transaction with a unique violation, and every failure is swallowed into a `console.warn` behind an HTTP 200 — so the UI looks perfect while the database is hollow.

The repository already knew. `janus/schema/34_usage_and_leaderboard_views.sql:15-21`:

> As of this migration, `v_scorecard_rankable` has rows for exactly 2 calls (both 2026-09-03) — every real call since has 0 rows in `scorecard`, because `linkPostCallToLifecycle` (`web/domain/dual-write.js`) has been failing silently for every user.

This audit supplies the mechanism, reproduces it, and orders the fix.

---

## Five most important findings

### 1. F-001 — The post-call domain write aborts on a unique violation, silently · **P0 · TEST-REPRODUCED**

Two writers target the same `post_call.public_id` with different `idempotency_key` values: the history writer derives `call_<publicId>` (because the history record has no `callIdentityKey` field), the domain writer derives `call_zoom:<recordingId>`. `upsertPostCall` conflict-targets only the partial unique index on `idempotency_key`, while `public_id` is `text UNIQUE NOT NULL`. So the second writer's INSERT finds no conflict, proceeds, and raises `23505`.

Reproduced verbatim against a live PostgreSQL 18.4:

```
[2] domain writer upsertPostCall FAILED: 23505 on constraint post_call_public_id_key
```

`withSessionContext` rolls back the whole transaction and rethrows; `trySqlDomainWrite` has no try/catch; the error becomes a 500 whose body is rewritten to `"Internal error."`; the browser logs `console.warn("Lifecycle dual-write (post-call) failed:", err)` and shows a normal call view.

Everything sequenced after `attachPostCall` never runs: **scorecard, call participants, video facts, timeline, follow-ups, objections, MoM draft, MEDDPICC qualification, technical commit, deal traction (Pass 8), ARR, product gaps (Pass 6), deal and account summaries (Pass 9), contact frameworks, identity stamping.** The account, deal and contacts survive, because they are written earlier.

→ [05](05-runtime-sql-verification.md) §3 · repro: [`repros/repro-h2-…ts`](repros/repro-h2-dual-writer-idempotency-collision.ts)

### 2. F-002 / F-003 — The hydration tail is structurally unpersistable, and Passes 8/9 compute from nothing · **P0 · CODE-PROVEN**

Not a race — three facts compose:

- `/api/postcall/generate` returns only `{...narrative, scorecard, videoFacts, confirmed, analysisMeta}`. It does **not** return `summarise`, `qualification`, `technicalCommit`, `pass6`, `arrCompute` or `timeline`.
- `linkPostCallToLifecycle` — the only writer of normalized child rows — reads every artefact off that response, so on a first analysis they are all `undefined`. That includes **Pass 8 deal traction** and **Pass 9 deal/account summaries**, which therefore roll up and summarise an empty current call.
- `setOnCallRecordHydrated` performs **no write at all**. It calls `scheduleCallRecordPanelRefresh` — a UI repaint.

So even with F-001 fixed, 18 artefacts would still never reach SQL. → [03](03-postcall-write-ledger.md) §2

### 3. F-005 — A destructive UPSERT that a naive fix would weaponise · **P1 · TEST-REPRODUCED**

`upsertPostCall`'s `ON CONFLICT … DO UPDATE` replaces `detail`, `transcript_ref`, `pipeline_state` and both shape versions outright, and its history caller always passes `detail: null`. Exercised directly, **one ordinary history patch** destroyed:

```
detail erased to NULL ............ YES — DATA LOSS
pipeline_state regressed ......... YES (signals_done -> analysis_done)
transcript_ref cleared ........... YES
detail_shape_version rolled back . YES (2 -> 1)
```

Today F-001 masks it — the second writer errors before reaching that branch. **Aligning the idempotency keys without first making the UPSERT non-destructive would convert a silent write-failure into recurring active data loss on every hydration patch (5–8 per call).** This is why the remediation order is load-bearing. The correct `COALESCE` pattern already exists 500 lines away in the same file.

→ [05](05-runtime-sql-verification.md) §4 · repro: [`repros/repro-h1-…ts`](repros/repro-h1-detail-erasure-and-pipeline-regression.ts)

### 4. F-004 and F-025 — Two immediate security issues · **P0 · CODE-PROVEN**

- **`POST /api/calls/:id/offload-payload`** calls `authContext` but never `assertCanReadResource` — its GET sibling does. **Any authenticated user can overwrite any call's offloaded payload by id.** Cross-tenant destructive write; two-line fix.
- **Five committed files** (`worker/scripts/debug-zoom*.mjs`) contain a real Freshworks Zoom cloud-recording share URL **and its plaintext passcode** as top-level constants. All five are dead code in no manifest. Deleting them does not remediate pushed history — the recording must be deleted or re-passcoded.

Also unauthenticated: `GET /api/feedback?global=1` returns every user's feedback before auth resolves; `POST /api/search/rag` has no auth call at all and spends embedding tokens.

### 5. F-019 — As shipped, no deployment target attempts a post-call SQL write · **P2 · CODE-PROVEN**

`PERSISTENCE_MODE` is read three ways with three different defaults **in the same request**: the canonical `resolvePersistenceMode` defaults to `"sql"` but is used **only by the fallback logger**; `resolvePersistencePort` defaults to `"sql"`; and `handleDomainWrite` reads `(env.PERSISTENCE_MODE || "")` — so with the variable unset, its 501 "mode guard" never fires and unwired methods silently fall through to Firestore. That is precisely the failure mode `types.ts:20-29` says was eliminated.

Meanwhile: `deploy/vps/docker-compose.yml:28` pins `PERSISTENCE_MODE: "${PERSISTENCE_MODE:-firestore}"`, in which `resolvePersistencePort` returns `null` and **no SQL write is attempted at all**; Cloud Run gets `dual` only if an optional script is run; and on Cloudflare `postgresReady()` returns `false` unconditionally, making PostgreSQL **structurally impossible** there.

`/api/config` reports nothing about persistence mode or PG readiness, so **SQL-only mode is not observable from the browser** — which is exactly why a fully working UI can coexist with an empty database.

---

## Data-loss and corruption risks, separated

**Confirmed (reproduced against a live database)**

| Finding | What is lost |
|---|---|
F-001 | every normalized child row for the call — 15 write targets |
F-005 | all 12 `post_call.detail` collections, `transcript_ref`, both shape versions, `pipeline_state` |

**Confirmed by code, not yet by runtime**

| Finding | What is lost |
|---|---|
F-002 | 18 of 20 artefacts never reach relational SQL |
F-003 | Pass 8/9 produce durably wrong output where the write does land |
F-007 | concurrent history patches lose updates at the server — whole-blob load→mutate→put with no CAS, fed by unsynchronised browser read-modify-writes |
F-008 | a refresh mid-hydration permanently strands gaps, timeline, ARR and the deferred commit — the transcript needed to finish lives in a module global |
F-015 | re-analysis silently overwrites the earlier row (two visible calls, one SQL row) |
F-033 | remote can overwrite a newer local record; `mergeHistoryLists` resolves by argument order with no timestamp comparison |
localStorage trim | the 100-record cap and 4 MB quota trim **drop the oldest records** — and localStorage is the de-facto source of truth |

**Recoverable?** Yes, largely. The history blobs retain every artefact, so a replay job can reconstruct child rows per call — **provided those blobs are intact**. That is R12 in the plan.

---

## SQL-write confidence by runtime and flow

| Runtime | Post-call → PostgreSQL |
|---|---|
Cloudflare Workers | **none, structurally impossible** (`postgresReady()` is false off-Node) |
VPS as shipped | **none by default** — Compose pins `firestore` |
Cloud Run as shipped | **none by default**; `dual` only after an optional script |
Local dev | works when `DATABASE_URL` is set |

| Flow (where SQL *is* enabled) | Confidence |
|---|---|
account / deal / contacts | **high** — written before the failure point |
`post_call` row + `analysis` | **high**, but hollow: `detail` NULL, `pipeline_state` frozen at `analysis_done`, `provisional` permanently true |
`callNotes` | medium — arrives via a later history patch |
every other post-call artefact | **none** |
RLS / grants / `security_invoker` views | **verified working** — 18/18, 8/8, 4/4 executed live |

---

## Biggest latency and cost sources

15–18 `generateContent` calls plus up to 12 `embedContent` calls per post-call — **~27–30 provider HTTP invocations**. 6–7 are on the user-visible critical path, and four of those are strictly serial.

| Rank | Source | Recoverable |
|---|---|---|
1 | `scorecard` → `verify` → `golden calibration`, serial inside `/generate` | **40–60 s.** They consume the same inputs, and calibration already preserves the verifier's flags — running them concurrently and merging is behaviour-preserving |
2 | `/classify` blocking the confirmation gate | up to one LLM round-trip; it only pre-selects a chip the user can override |
3 | Saved-call open: 6 full `innerHTML` repaints, 8 serial barriers, ≥10 requests, ≥12 full localStorage history parses, one duplicated query | most of the perceived load time |
4 | Zoom share-link scrape: 5 sequential HTTP calls with **no timeout and no retry** | 3–35 s |
5 | Serial `for … await` contact-creation loop blocking all generation | 0.2 s × N |
6 | Three provider calls with **no timeout at all** (both `transcript-infer` calls, `embedVerbatim` ×12 concurrent) | an unbounded hang |

Two structural cost findings: **`effort` is inert** on the default Gemini path (`POSTCALL_EFFORT` changes nothing — any Gemini-3 model is pinned to `thinkingLevel: "minimal"`), and **the only cost guardrail is inert too** — the daily token budget no-ops whenever `userId` is absent, which is essentially the whole pipeline.

Cost cannot be stated in currency, because **`ai_run` is ~0% attributable** (F-023): no `call_id` column, the `callId` string resolved-and-discarded at write time, no route injecting the authenticated identity, critical-path passes sending no `callId`, the video pass sending `call_pending_<ms>`, `summaries` structurally unattributable — and the table is append-only, so no row can ever be repaired.

---

## Recommended target architecture

**Option B — a controlled post-call finalization refactor.** One canonical server-side persistence boundary (`POST /api/postcall/finalize`): idempotent, re-callable, transactional. `POST /api/history` stops writing `post_call` and history becomes a read model. Pass 8/9 move inside the finalizer behind an evidence check. `pipeline_state` gets written from real artefact presence.

**Transition: A now → B next → C only when automatic Zoom ingestion or refresh-survivability becomes a committed requirement.**

Why not Option C (a durable server-side orchestrated pipeline) yet: its prerequisite is reliable scheduled server-side execution, and the repository shows three independent signs it does not have that — no `scheduled()` handler in `index.ts`, two nightly crons pointed at **unregistered** routes, and `POST /api/internal/outbox/project` registered with no caller. Building a job queue on that foundation while the P0s are live means debugging a new queue and a data-loss bug simultaneously. **Fix the writes, then earn the queue.** Option B is a genuine stepping stone: the finalizer is exactly what a scheduler would later call.

→ [09](09-architecture-options.md)

---

## First three changes

1. **Purge the committed Zoom credential** (R1/P1) — the only finding whose exposure grows with time and cannot be undone later. Delete the five files, check `git log -S`, rotate the recording.
2. **Make `upsertPostCall` non-destructive** (R2/P2) — `COALESCE` instead of whole-column replace, and no `pipeline_state` regression. **This must precede any idempotency-key change.**
3. **Unify the post-call idempotency key** (R3/P3) — give `upsertPostCall` the conflict-resolving CTE `upsertActivity` already has, pick one key derivation, and fix the reader's `call_` prefix mismatch. Behind a flag, watching the `dual-write-DROPPED` and domain-write-500 counters.

Run **R4 (the three authorisation holes)** in parallel — three minimal diffs, no dependencies.

---

## Immediate containment, before any repair

- **Rotate or delete the exposed Zoom recording.** Repo access currently equals access to that call.
- **Add `assertCanReadResource` to `offload-payload`.** Two lines; it closes a cross-tenant destructive write.
- **Stop the silence** (R5): `logFallback` the escaping error in `trySqlDomainWrite` and each silent skip in `tryHistoryPostCallSqlWrite`. Six skip conditions currently log nothing at all.
- **Confirm the production persistence mode** (§8.1 of [05](05-runtime-sql-verification.md)). If it is `firestore`, no SQL write has been attempted and the blast radius is different — larger in one sense, simpler in another.
- **Do not run a bulk history re-sync** until R2/R3 land: it would multiply the collision by up to 100 per user.

---

## What must NOT change yet

| Do not touch | Why |
|---|---|
RLS policies, `FORCE ROW LEVEL SECURITY`, grants/REVOKEs, `security_invoker` views | **verified working** — 18/18, 8/8, 4/4 executed against a live database. The healthiest layer in the system, and the only reason landed data is safely isolated |
`upsertActivity`'s conflict-resolving CTE | already correct; it is the pattern R3 copies. *(An earlier draft of this audit wrongly assumed it was the failing statement; the repro locates the failure precisely at `upsertPostCall`.)* |
`upsertAccount`'s slug-dedupe | prevents a known staging-blocker class |
The verifier and golden-set passes, incl. fail-safe leadership capping | correctness machinery. Do not "optimise" them away — parallelise them instead |
`replaceCallParticipants`'s SAVEPOINT | correct transaction isolation |
The `[history][dual-write-DROPPED]` log line | deliberately loud and greppable |
The 200 contract of `POST /api/history` | intentional. Make the *failure* visible, not the response code |
The abort/generation machinery where already applied | well built |
**The idempotency keys, before R2** | reproduced: aligning them first starts active data loss |
**Option C infrastructure** | not until Phases 1–3 are done |

---

## What still requires runtime evidence

| # | Open question | How to close it |
|---|---|---|
1 | Effective `PERSISTENCE_MODE` / `PERSISTENCE_READ_MODE` / `HISTORY_BACKEND_MODE` in staging and production | [05](05-runtime-sql-verification.md) §8.1 |
2 | How many historical calls are already affected by F-001 / F-002 | §8.2, §8.4 |
3 | `pipeline_state` distribution (expected: 100% `analysis_done`) | §8.3 |
4 | Whether `ai_run` contains `call_pending_*` orphans in production | §8.6 |
5 | Whether Cloud Run liveness/readiness probes really point at the 404ing health paths | inspect the deployed service config |
6 | Whether the deployed branch is `2.1` on the `antony` remote, and how far it has diverged from `main` | `.cursor/rules/push-antony-2.1.mdc` says production deploys from a different remote |
7 | Whether `sync_outbox` has any projector running | nothing in `deploy/` calls its route |
8 | Real Core Web Vitals and a network waterfall | Playwright journey specified in [11](11-implementation-prompts.md) P12/P14 — not captured here, because it needs environment changes the audit's scope forbids |
9 | Real per-pass p50/p95/cost | **blocked on F-023.** Fix attribution first; every figure in [07](07-performance-and-cost.md) is a model until then |

---

## Audit files created

All under `docs/astra-audit/`. Nothing outside this directory was modified.

| File | Contents |
|---|---|
[`00-executive-summary.md`](00-executive-summary.md) | this document |
[`01-system-architecture.md`](01-system-architecture.md) | as-built topology, two diagrams, the runtime configuration truth table, dead HTTP surface |
[`02-postcall-dag.md`](02-postcall-dag.md) | the corrected dependency DAG, full stage table, provider-invocation totals |
[`03-postcall-write-ledger.md`](03-postcall-write-ledger.md) | the 29-row write ledger, 7 scenario traces, all 10 false-success sites, every destructive-overwrite surface |
[`04-sql-persistence-map.md`](04-sql-persistence-map.md) | bidirectional write/read parity, per-method classification, gap analysis |
[`05-runtime-sql-verification.md`](05-runtime-sql-verification.md) | environment classification, the two reproductions, four executed gate suites, redacted queries for what remains unproven |
[`06-bugs-and-risks.md`](06-bugs-and-risks.md) | 39 prioritized findings, P0/P1 detail, all 21 hypotheses resolved, and what is already correct |
[`07-performance-and-cost.md`](07-performance-and-cost.md) | workload table, critical path, ranked serialisation barriers, why measurement is blocked |
[`08-test-coverage.md`](08-test-coverage.md) | 286-file inventory, 13 orphans, silent-skip catalogue, 14 required tests |
[`09-architecture-options.md`](09-architecture-options.md) | Options A/B/C compared on 12 dimensions, with the recommendation and its reasoning |
[`10-remediation-plan.md`](10-remediation-plan.md) | 20 changes in 5 phases, 16 fields each, with the ordering constraint justified |
[`11-implementation-prompts.md`](11-implementation-prompts.md) | 15 self-contained coding-agent prompts with a dependency graph — **created, not executed** |
[`12-postcall-ux-zoom-and-loading.md`](12-postcall-ux-zoom-and-loading.md) | the three mandatory product problems: click-and-wait ledger, Zoom scenario matrix, render-and-fetch ledger |
[`_audit-state.md`](_audit-state.md) | checkpoint: phase status, coverage, blockers |
[`_evidence-index.md`](_evidence-index.md) | **130 evidence IDs, 39 findings, 8 runtime observations** — every claim above traces here |
[`repros/repro-h2-dual-writer-idempotency-collision.ts`](repros/repro-h2-dual-writer-idempotency-collision.ts) | reproduces F-001 |
[`repros/repro-h1-detail-erasure-and-pipeline-regression.ts`](repros/repro-h1-detail-erasure-and-pipeline-regression.ts) | reproduces F-005 and F-006 |

---

## Definition-of-done answers

| # | Question | Answer |
|---|---|---|
1 | What happens from confirm click to final durable state? | [03](03-postcall-write-ledger.md) — 29 writes; W8 aborts and W9–W20 never execute |
2 | Which stages depend on which evidence? | [02](02-postcall-dag.md) — full DAG and stage table |
3 | Which operations are parallel / sequential / nested / detached / retry-driven? | [02](02-postcall-dag.md) §2–§3; 4 critical-path LLM calls are serial, hydration is detached |
4 | Where is every output stored and later read? | [03](03-postcall-write-ledger.md) §2, [04](04-sql-persistence-map.md) §4 |
5 | Which outputs can be lost, erased, duplicated, stranded or stale? | §"Data-loss risks" above |
6 | Is every expected SQL write implemented? | The statements exist. Their **callers** are unreachable or run before their inputs exist |
7 | Which SQL writes are proven at runtime? | The failure is proven (`R-004`, `R-005`); RLS/grants are proven working (`R-006`). No production write was observed |
8 | Which HTTP successes coexist with failed SQL? | 10 sites — [03](03-postcall-write-ledger.md) §4 |
9 | What is the true performance critical path? | [07](07-performance-and-cost.md) §3 — 6–7 LLM calls, four serial |
10 | Which operations dominate latency and cost? | scorecard→verify→calibrate; the 6-repaint call view; the untimed Zoom scrape |
11 | Which choices are intentional vs migration residue? | Residue: two writers, the Firestore Compose default, the `call_` prefix mismatch, dead batch/health routes, `worker/src/postcall.ts`, the dead user-OAuth stub. Intentional: the 200 contract, best-effort children, the contacts read-mode exception, `manual-only`/`live-api` tags |
12 | Confirmed P0/P1 issues? | 5 P0, 14 P1 — [06](06-bugs-and-risks.md) §1 |
13 | Could historical records already be damaged, and how would we know? | Yes — the repo's own migration comment says so. Detection queries in [05](05-runtime-sql-verification.md) §8 |
14 | Safest first change? | Purge the credential, then R2 (non-destructive UPSERT) |
15 | What should explicitly not change yet? | §"What must NOT change yet" |
16 | Why does the first post-call page need its current clicks and waits, and what is the minimum safe path? | [12](12-postcall-ux-zoom-and-loading.md) §A3 — ≥12 interactions today; 3 with every correctness gate preserved |
17 | Can a valid Zoom call fetch its transcript automatically today? | **Yes, but only in a narrow window** — five conditions, listed in [12](12-postcall-ux-zoom-and-loading.md) §B4. Miss any one and the SE uploads a VTT by hand |
18 | Why do the post-call views load strangely, and what fixes them? | [12](12-postcall-ux-zoom-and-loading.md) Part C — six repaints, seven state deciders, nine premature empty states, inverted merge precedence |
19 | Target architecture after staged remediation? | Option B — [09](09-architecture-options.md) §6 |

## Completeness gates

| Gate | Status |
|---|---|
A — repository coverage | **complete** |
B — post-call execution | **complete** |
C — persistence | **complete** |
D — SQL parity | **complete** |
E — tests | **complete** |
F — findings (21/21 hypotheses resolved, none runtime-blocked) | **complete** |
G — recommendation | **complete** — prompts created, none executed |
H — post-call journey and Zoom automation | **complete**, with one stated limitation: no browser trace or Core Web Vitals were captured, because that requires environment changes the audit's scope forbids. The exact journey to capture is specified in [11](11-implementation-prompts.md) |

Production runtime configuration and historical blast-radius counts are marked `REQUIRES RUNTIME EVIDENCE` with exact redacted queries supplied. Everything else is closed.
