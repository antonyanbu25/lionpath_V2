# 09 — Architecture Options

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Related:** [06-bugs-and-risks](06-bugs-and-risks.md) · [10-remediation-plan](10-remediation-plan.md) · [03-postcall-write-ledger](03-postcall-write-ledger.md)

---

## 1. What the evidence constrains

Any option must respect five findings:

1. **Two writers race for one row.** F-001, reproduced (`R-004`). Any design keeping both must reconcile their keys — and must fix the destructive UPSERT first (F-005, `R-005`), or the reconciliation converts silent failure into active data loss.
2. **The hydration tail is structurally unpersisted.** F-002. `/generate` does not return those artefacts, the single lifecycle link runs before they exist, and the completion hook writes nothing. This is not a race; no amount of retry fixes it.
3. **The browser is the only job runner.** F-008. The transcript needed to finish lives in a module global; a reload strands the pipeline permanently.
4. **Pass 8 and Pass 9 consume nothing.** F-003. Their inputs are `undefined` by construction.
5. **RLS, grants and `security_invoker` views genuinely work** (`R-006`). This is a solid foundation — no option should disturb it.

## 2. Option A — Minimal-risk correctness fixes

Keep the architecture. Repair the confirmed P0/P1s with the smallest possible diffs.

**Scope**

- Make `upsertPostCall` non-destructive using the `COALESCE` form already at `routes.ts:2400-2409` (F-005).
- Unify the idempotency key on one derivation, and give `upsertPostCall` an `upsertActivity`-style CTE that resolves on `public_id OR idempotency_key` (F-001).
- Strip the `call_` prefix on read, or stop adding it (F-015).
- Add `assertCanReadResource` to `offload-payload`; add auth to `/api/search/rag`; auth-gate `?global=1` (F-004, F-010, F-011).
- Delete the five committed-credential files and rotate (F-025).
- Register `healthRoutes` and the four dead internal routes (F-012, F-013).
- Call `tryHistoryPostCallSqlWrite` from the bulk `entries` branch (F-014).
- Fix `ai_run` attribution: thread a real `callId` and inject the server-side identity (F-023).
- Add timeouts to the three unguarded provider calls; widen `POSTCALL_PASS_NAMES` (F-027).
- **Add a hydration-completion writer**: re-invoke the child persisters with the merged record when hydration finishes — the minimum viable fix for F-002/F-003, and the one genuinely architectural piece in this option.
- Add a PG service container to CI plus the tests in [08](08-test-coverage.md) §8.

**Does not fix**: F-008 (browser-owned jobs), F-006 semantics (`pipeline_state` still cannot represent the DAG), F-029–F-035 (render architecture), the two-writer duplication itself.

| Dimension | Assessment |
|---|---|
Effort | **Small–medium.** Most items are 1–20 lines; the hydration-completion writer is the only substantial piece |
Migration / rollback risk | **Low.** No schema change required; every change is reversible |
User-visible latency | unchanged |
Reliability across refresh | **unchanged — still broken** |
Data consistency | greatly improved: child rows land, nothing is erased |
Idempotency | fixed for `post_call`; history blob still last-writer-wins |
Partial failure / replay | still best-effort, but now observable |
Observability | much better once `ai_run` attributes and the fallback log is trusted |
Cost | unchanged |
Testing complexity | **low**, and the two repro harnesses already exist |
Operational burden | unchanged |
Maintainability | unchanged — two writers remain |

## 3. Option B — Controlled post-call finalization refactor

Keep the browser orchestration and the API surface, but introduce **one canonical server-side persistence boundary** for post-call results.

**Scope, in addition to Option A**

- **One writer.** `POST /api/history` stops writing `post_call` entirely. Its only job becomes the history blob. All relational post-call persistence goes through one server-side finalizer.
- **`POST /api/postcall/finalize`** — a new endpoint the browser calls when hydration completes, with the merged record. It performs the whole child-row write in one transaction, idempotently, keyed on the call identity. Re-callable safely; the same call twice is a no-op.
- **Every stage result becomes an idempotent, versioned upsert** rather than a fire-and-forget best-effort write.
- **`pipeline_state` gains real meaning**: written by the finalizer based on which artefacts are actually present, so `provisional` stops being permanently true (F-006).
- **Pass 8 and Pass 9 move into the finalizer**, after the required evidence is proven present — which fixes F-003 by construction rather than by timing luck.
- History becomes a **read model / cache**, not a competing writer.
- Adopt the single view-state model from [12](12-postcall-ux-zoom-and-loading.md) §C7.

| Dimension | Assessment |
|---|---|
Effort | **Medium.** One new endpoint, one refactor of `linkPostCallToLifecycle`, plus the view-state work |
Migration / rollback risk | **Low–medium.** Additive; the finalizer can ship behind a flag with the old path intact |
User-visible latency | unchanged or slightly better |
Reliability across refresh | **partially fixed** — a completed hydration always persists, but a hydration interrupted mid-flight is still lost |
Data consistency | strong: one writer, one transaction, one idempotency key |
Idempotency | designed in |
Partial failure / replay | the finalizer is re-callable, so replay from the history blob becomes a supported operation |
Observability | "complete" becomes checkable |
Cost | unchanged |
Testing complexity | **medium**, and much easier than today — one boundary to test instead of 14 best-effort writes |
Operational burden | slightly higher (one more endpoint) |
Maintainability | **substantially better** |

## 4. Option C — Durable server-side orchestrated pipeline

Evaluated, not assumed. The model in the brief:

`confirm` → create a canonical call + `pipeline_run` record → server schedules dependency-aware stages → each stage writes an idempotent versioned result → a finalizer validates required artefacts → Pass 8 runs only after its evidence exists → Pass 9 after finalization → the UI polls or subscribes to durable state → history becomes a read model.

**What this genuinely solves that B does not**

- F-008 entirely: a refresh, a closed tab, or a dead laptop no longer matter.
- F-009 properly: the scheduler can await video facts before scoring, or schedule a rescore, because dependencies are declared rather than implied by promise wiring.
- F-026/F-021: it is the only option that makes an automatic Zoom connector viable — a webhook has nowhere to deliver work today.
- Retry, replay and dead-lettering become first-class.

**What it costs, honestly**

- **The runtime does not support it today.** `worker/src/index.ts` exports `fetch` only — no `scheduled()` handler exists (`E-102`). The two cron scripts in `deploy/` already point at unregistered routes (`E-045`), and `POST /api/internal/outbox/project` is registered with **no scheduler calling it**. So the repository has *three* pieces of evidence that scheduled execution is currently unreliable-to-absent. Option C requires standing that up first.
- Cloudflare cannot host it: `postgresReady()` is false there unconditionally (`E-117`).
- The browser UI must be rewritten from "orchestrator" to "observer" — a large change to `postcall.js` (6,045 lines) and `call-view.js` (3,538 lines).
- The 6–7 critical-path LLM calls still have to happen; server orchestration does not make them faster, and it adds a scheduling hop.

| Dimension | Assessment |
|---|---|
Effort | **Large.** Job store, scheduler, worker loop, status API, UI rewrite |
Migration / rollback risk | **High.** Two pipelines coexisting during transition |
User-visible latency | neutral, possibly slightly worse (scheduling hop) |
Reliability across refresh | **fully fixed** |
Data consistency | strongest |
Idempotency | designed in |
Partial failure / replay | first-class |
Observability | best |
Cost | unchanged LLM spend, plus infrastructure |
Testing complexity | **high** |
Operational burden | **high** — a queue is a thing that pages people |
Maintainability | best long-term, worst during transition |

## 5. Comparison

| | A | B | **C** |
|---|---|---|---|
Stops confirmed data loss | ✅ | ✅ | ✅ |
Child rows reach SQL | ✅ (via a hydration writer) | ✅ (by construction) | ✅ |
Pass 8/9 get real evidence | partially | ✅ | ✅ |
Survives a browser refresh | ❌ | partially | ✅ |
`pipeline_state` becomes meaningful | ❌ | ✅ | ✅ |
One writer per row | ❌ | ✅ | ✅ |
Enables automatic Zoom ingestion | ❌ | ❌ | ✅ |
Effort | S–M | **M** | L |
Rollback risk | low | low–med | high |
Requires new infrastructure | no | no | **yes** |

## 6. Recommendation

**Target: Option B. Transition: A now, B next, C only when automatic Zoom ingestion or refresh-survivability becomes a committed product requirement.**

Reasoning from the evidence rather than preference:

- **A is not optional and not sufficient.** F-004 (cross-tenant IDOR write), F-025 (a committed recording passcode) and F-005/F-001 (proven data loss) must be fixed regardless of the destination. But A leaves two writers racing for one row, so it stabilises the symptom without removing the class.
- **B removes the class.** Every P0 in this audit traces to one root cause: *there is no single place that owns durable post-call state.* Two SQL writers with divergent keys, a lifecycle link fired before its inputs exist, a completion hook that writes nothing, and a `pipeline_state` that no one advances are four faces of that one absence. B introduces exactly one boundary and each of them dissolves. It needs no schema migration, no new infrastructure, and can ship behind a flag.
- **C is right in the long run but wrong right now.** Its prerequisite — reliable scheduled server-side execution — is precisely what the repository demonstrates it does not currently have (no `scheduled()` handler, two crons hitting 404s, an outbox projector with no caller). Building a durable job pipeline on that foundation, while the P0s are still live, would mean debugging a new queue and a data-loss bug at the same time. **Fix the writes, then earn the queue.**
- **B is also a genuine stepping stone**, not a detour. `POST /api/postcall/finalize` — idempotent, re-callable, server-side, transactional — is exactly the component a durable scheduler would call. Option C then becomes "add a job store and call the finalizer from a worker loop instead of from the browser", not a rewrite.

**Explicitly not recommended:** a big-bang move to C, and any attempt to "just align the idempotency keys" as a quick fix. The second is actively dangerous — `R-005` shows it would start erasing `detail` on every hydration patch.

## 7. What must not change

- RLS policies, `FORCE ROW LEVEL SECURITY`, the grant/REVOKE matrix, and `security_invoker` on the read-model views. These are verified working (`R-006`) and are the only reason the data that *does* land is safely isolated.
- The verifier and golden-set calibration passes, including their fail-safe behaviour of refusing leadership-shareable status on error.
- `upsertActivity`'s conflict-resolving CTE — it is the pattern to copy, not to change.
- `upsertAccount`'s slug-dedupe.
- `replaceCallParticipants`'s SAVEPOINT isolation.
- The `[history][dual-write-DROPPED]` log line.
- The abort/generation machinery (`beginPostcallPipeline`, `isPostcallPipelineStale`, `crmMatchesToken`, `callPanelRenderGen`) where it is already applied.
