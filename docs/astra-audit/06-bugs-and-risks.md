# 06 — Prioritized Findings

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Related:** [_evidence-index](_evidence-index.md) · [05-runtime-sql-verification](05-runtime-sql-verification.md) · [10-remediation-plan](10-remediation-plan.md) · [11-implementation-prompts](11-implementation-prompts.md)

Priorities follow the brief. No P0 is asserted without an explicit failure mode and evidence.

---

## 1. Findings table

| ID | Pri | Class | Finding | Evidence chain | User impact | Data impact | Security | Perf/cost | Conf. | Fix | Runtime proof needed? |
|---|---|---|---|---|---|---|---|---|---|---|---|
**F-001** | **P0** | CONFIRMED BUG | The two `post_call` SQL writers derive different idempotency keys for the same `public_id`, so the second one raises `23505` and the entire domain dual-write transaction rolls back | `E-022`→`E-029`, `E-056`, corroborated `E-055`, **reproduced `R-004`** | none visible — the UI looks correct | **every normalized child row for the call is lost**: scorecard, participants, video facts, timeline, follow-ups, objections, MoM, qualification, technical commit, Pass 8 traction, ARR, Pass 6 gaps, Pass 9 summaries, contact frameworks, identities | none | one wasted round-trip + a 500 | **TEST-REPRODUCED** | M | no — proven |
**F-002** | **P0** | CONFIRMED BUG | Every hydrated post-call artefact is structurally absent from relational SQL: `/generate` does not return them, the one lifecycle link runs before they exist, and `onCallRecordHydrated` performs no write | `E-013`→`E-017` | analysis appears complete in the UI, backed by browser localStorage | 18 of 20 artefacts exist only in a JSON blob; unrecoverable if localStorage is cleared and the remote blob is lost | none | none | **CODE-PROVEN** | L (architectural) | §8.4 of [05](05-runtime-sql-verification.md) quantifies scale |
**F-003** | **P0** | CONFIRMED BUG | Pass 8 (deal traction) and Pass 9 (deal + account summaries) execute with `qualification`, `summarise` and `technicalCommit` all `undefined`, and are never recomputed | `E-013`, `E-018`, `E-019` | deal-health and account/deal summaries are derived from an empty current call | wrong durable output where the write does land (new-account flow) | none | wasted LLM spend on Pass 9 | **CODE-PROVEN** | M | no |
**F-004** | **P0** | CONFIRMED BUG | `POST /api/calls/:id/offload-payload` authenticates but never authorises — any signed-in user can overwrite any call's offloaded payload by id | `E-048` | victim's call payload replaced | cross-tenant destructive write | **IDOR write, cross-tenant** | none | **CODE-PROVEN** | **S** | no |
**F-025** | **P0** | CONFIRMED BUG | Five committed files contain a real Zoom cloud-recording share URL **and its plaintext passcode** | `E-112` | none | none | **credential exposure in git history; the recording is accessible to anyone with repo access** | none | **CODE-PROVEN** | **S** (+ rotation) | check `git log -S` |
**F-005** | **P1** | CONFIRMED BUG | `upsertPostCall`'s ON CONFLICT branch replaces `detail`, `transcript_ref`, `pipeline_state` and the shape versions outright; the history writer always sends `detail: null` | `E-030`→`E-032`, `E-040`, **reproduced `R-005`** | sections vanish after a later save | one ordinary patch nulls all 12 `detail` collections and `transcript_ref` | none | none | **TEST-REPRODUCED** | **S** | no — proven |
**F-006** | **P1** | CONFIRMED BUG | `pipeline_state` has two writers, both hardcoding `'analysis_done'`; four of six enum values are never written; the derived `provisional` flag is therefore permanently `true` for every SQL-read call | `E-033`, `E-034` | every call reads back as provisional | "complete" is unrepresentable | none | none | **CODE-PROVEN** | M | §8.3 of [05](05-runtime-sql-verification.md) |
**F-007** | **P1** | CONFIRMED BUG | Concurrent history patches lose updates at the server: the browser POSTs whole records from unsynchronised RMWs, and `saveHistoryEntry` is load-blob → mutate → put-blob with no CAS | `E-020`, `E-021` | a hydrated section reappears empty after a sync | remote blob can regress; `mergeHistoryLists` then propagates the regression back to local | none | none | **CODE-PROVEN** | M | concurrency repro |
**F-008** | **P1** | ARCHITECTURAL RISK | The browser is the only post-call job runner. The transcript required to finish lives in a module global; there is no unload handler, no resume, no server-side job | `E-062`, `E-063`, `E-017` | a refresh mid-hydration permanently strands gaps, timeline, ARR and the deferred commit | those artefacts can never be produced for that call | none | wasted spend on abandoned in-flight calls | **CODE-PROVEN** | L | no |
**F-009** | **P1** | CONFIRMED BUG | Pass 3 scores without the current call's video facts (`generateBody.videoFacts` reads stale `pipelineState.videoFacts`), and is never rescored when they arrive | `E-012`, `E-013` | visual-evidence rubric themes under-score on first analysis | scores durably wrong for video-dependent themes | none | avoids one serialisation — likely an intentional latency trade, but undocumented and uncompensated | **CODE-PROVEN** | M | measure theme impact |
**F-010** | **P1** | CONFIRMED BUG | `GET /api/feedback?global=1` returns every user's feedback and short-circuits before any auth resolution | `E-047` | none | none | **unauthenticated cross-user data read** | none | **CODE-PROVEN** | **S** | no |
**F-011** | **P1** | CONFIRMED BUG | `POST /api/search/rag` has no authentication of any kind and spends embedding tokens | `E-046` | none | none | **unauthenticated compute; only an IP rate limit** | billable | **CODE-PROVEN** | **S** | no |
**F-012** | **P1** | CONFIRMED BUG | `/api/health`, `/api/health/live`, `/api/health/ready` handlers exist but `healthRoutes` is imported by nothing → 404, while Cloud Run docs configure probes against them | `E-043` | — | — | — | container may be considered unhealthy / restart-looped | **CODE-PROVEN** | **S** | confirm probe config |
**F-013** | **P1** | DEAD PATH | `POST /api/read-models/schedule`, `/api/internal/batch/enqueue` and `/api/internal/read-models/nightly-rebuild` are unregistered; the browser and an **active** cron script call them nightly | `E-044`, `E-045` | dashboards/read models never rebuild | Pass 9 batch path is entirely dead | none | silent nightly 404s | **CODE-PROVEN** | **S** | check cron logs |
**F-014** | **P1** | CONFIRMED BUG | The bulk `entries` branch of `POST /api/history` returns before `tryHistoryPostCallSqlWrite`, so login sync and recovery upload never project to SQL | `E-037` | recovered calls stay invisible to SQL readers | local-only calls can never reach `post_call` | none | none | **CODE-PROVEN** | M | no |
**F-015** | **P1** | CONFIRMED BUG | Idempotency-key prefix mismatch: writers store `'call_' + key`, readers compare the raw key → `findPostCallByIdentity` can never match, so re-analysis dedupe is dead | `E-038`, `E-039` | re-analysing a call creates a second visible record | two records, one SQL row (the second silently overwrites the first via the partial unique index) — **runtime-verified via the orphaned regression test** | none | duplicate LLM spend | **RUNTIME-VERIFIED** | **S** | no |
**F-023** | **P1** | CONFIRMED BUG | `ai_run` is ~0% attributable to a user-visible post-call: no `call_id` column, `callId` resolved-and-discarded at write time, no route injects the authenticated identity, critical-path passes send no `callId`, the video pass sends `call_pending_<ms>`, and `summaries` is structurally unattributable. Its only test cannot load | `E-092`→`E-097`, `E-064`, `E-120`, `R-007` | — | cost/latency per call unreconstructable; `ai_run` is append-only so it can never be backfilled (`E-093`) | none | **no cost attribution at all**; the summarise anomaly detector can never fire | **CODE-PROVEN** + **RUNTIME-VERIFIED** | M | §8.6 of [05](05-runtime-sql-verification.md) |
**F-026** | **P1** | ARCHITECTURAL RISK | Zoom acquisition is pull-only, synchronous and single-attempt: no webhook, no scheduled discovery, no transcript-readiness polling, and a still-processing transcript is reported as "no transcript" | `E-102`→`E-107` | the SE must download and upload a VTT whenever Zoom is even slightly slow | — | — | — | **CODE-PROVEN** | M–L | no |
**F-027** | **P1** | CONFIRMED BUG | Three provider calls on the live post-call path have **no timeout, no AbortController and no retry**; five passes are silently misclassified into the 45 s `extraction` budget despite 8000 maxTokens on the critical path | `E-099`, `E-100` | a hung Gemini socket hangs the request indefinitely | — | — | **unbounded latency**; the default no-consent video route is the worst case | **CODE-PROVEN** | **S** | no |
**F-028** | **P1** | CONFIRMED BUG | The daily token budget is a no-op whenever `userId` is absent — which is essentially the entire post-call pipeline — and three call families never reserve at all | `E-098`, `E-094` | — | — | — | **the only cost guardrail is inert** | **CODE-PROVEN** | M | §8.6 |
**F-038** | **P1** | ARCHITECTURAL RISK | CI provisions no PostgreSQL, never runs `tsc --noEmit`, and three SQL gates exit 0 on missing `DATABASE_URL`; the promotion gate lacks the JDK its emulator legs require; 13 test files are in no manifest, including the entire ADR-008 persistence lane | `E-122`→`E-128`, `E-054` | — | **every finding in this audit was reachable because nothing tests it** | none | — | **CODE-PROVEN** + `R-006`/`R-007` | M | no |
**F-016** | P2 | CONFIRMED BUG | The Analyse button cannot enable until a CRM network lookup has completed at least once, and every keystroke in the email field resets that gate | `E-003`, `E-004`, `E-060` | the button appears broken; typing re-disables it | — | — | extra CRM round-trips | **CODE-PROVEN** | **S** | no |
**F-017** | P2 | CONFIRMED BUG | Intake handlers are double-bound (`fw*` + native) and the submit path is bound twice, while the repo's own `bindActionOnce` dedupe helper is used at only 3 of ~99 sites | `E-005`→`E-008`, `E-061`, `E-079` | duplicate lookups, duplicate navigation | — | — | 2× CRM lookups per blur/keystroke | **CODE-PROVEN** | **S** | verify double-fire in a browser |
**F-018** | P2 | ARCHITECTURAL RISK | Pass 0 is fully serial, classification blocks the confirmation view, and a serial `for … await` contact-creation loop blocks all generation | `E-009`→`E-011` | long dead time before the gate and after confirm | — | — | avoidable serialisation | **CODE-PROVEN** | M | measure |
**F-019** | P2 | ARCHITECTURAL RISK | Cloudflare and Node diverge in persistence default, history backend injection, boot guards, CORS and ~15 routes; `PERSISTENCE_MODE` has three different defaults in one request and the shipped VPS Compose pins `firestore` | `E-049`→`E-051`, `E-116`→`E-118`, `E-002` | — | **as shipped, no deployment file selects a mode in which post-call SQL writes are attempted** | CF has no boot guards | — | **CODE-PROVEN** | M | §8.1 |
**F-020** | P2 | ARCHITECTURAL RISK | Migration 34 is applied by no automated path; three hand-maintained schema lists have diverged; no drift test exists | `E-052`→`E-054`, **`R-003`** | — | latent (the view has no consumer yet) | none | — | **RUNTIME-VERIFIED** | **S** | no |
**F-029** | P2 | CONFIRMED BUG | A saved-call open performs six full `innerHTML` repaints across 8 serial barriers, ≥12 full localStorage history parses, ~45 store operations and ≥10 network requests, with one exactly duplicated query | `E-070`→`E-074` | flicker, layout shift, repeated KPI count-ups, lost scroll/tab state | — | — | dominates perceived load time | **CODE-PROVEN** | M | measure |
**F-030** | P2 | ARCHITECTURAL RISK | Seven independent deciders compute call-view state, `pending` is derived three times from three different reads, and one decider reads another panel's DOM to decide its own | `E-075`→`E-077` | contradictory states on one screen | — | — | — | **CODE-PROVEN** | M | no |
**F-031** | P2 | CONFIRMED BUG | The realtime call-detail subscription can never be unsubscribed (an `async` factory stores a Promise where a function is expected) and never attaches in the default read mode (`fbReadyPromise` never resolves) | `E-065`, `E-066` | no live updates by default; unbounded listener growth in `firestore` mode | — | — | in firestore mode: 12 listeners per render, each triggering a full re-fetch | **CODE-PROVEN** | **S** | no |
**F-032** | P2 | CONFIRMED BUG | Nine empty states assert absence before any authoritative read; `safeEnrich` makes a failed read indistinguishable from empty; one tells the user to re-run a pipeline that already succeeded | `E-071`, `E-083`, `E-084` | users re-run analysis unnecessarily | — | — | needless re-analysis spend | **CODE-PROVEN** | M | no |
**F-033** | P2 | ARCHITECTURAL RISK | Local-vs-remote precedence is inverted between the awaited path (local wins) and the realtime path (remote over a **pre-hydration** snapshot), and `mergeHistoryLists` resolves collisions by argument order with no timestamp comparison | `E-081`, `E-082` | hydrated fields visibly revert | remote can overwrite a newer local record | — | — | **CODE-PROVEN** | M | no |
**F-034** | P2 | CONFIRMED BUG | `#call-mom-save` fires twice per click → two concurrent `POST /api/history` read-modify-writes | `E-078` | — | can lose a concurrent patch | — | 2× writes | **CODE-PROVEN** | **S** | no |
**F-035** | P2 | CONFIRMED BUG | The hydration-complete progress clear is a no-op (`!message` guard); four refresh-request branches set a variable nobody reads and arm no timer; one global timer cancels other calls' refreshes | `E-067`→`E-069` | a stale "Qualifying…" banner persists; some updates never repaint | — | — | — | **CODE-PROVEN** | **S** | no |
**F-039** | P2 | CONFIRMED BUG | `/api/config` reports nothing about persistence mode or PG readiness — SQL-only mode is unobservable from the browser — and reports the **wrong** Zoom predicate | `E-119`, `E-106` | Zoom status can be exactly inverted | — | — | — | **CODE-PROVEN** | **S** | no |
**F-021** | P3 | DEAD PATH | The Gemini context-cache step is a permanent no-op retained in code (`cacheFields = {}`) | `E-041` | — | — | — | none | **CODE-PROVEN** | **S** | no |
**F-022** | P3 | CONFIRMED BUG | Video-pass telemetry is attributed to `call_pending_<ms>` | `E-064` | — | — | — | the most expensive pass is unattributable | **CODE-PROVEN** | **S** | no |
**F-024** | P3 | CONFIRMED BUG | The persistence barrel re-exports only the deprecated `withSystemContext` alias, so the M3 rename never reached any call site | `E-121`, `R-008` | — | — | RLS bypass is not explicit at call sites, contrary to intent | — | **RUNTIME-VERIFIED** | **S** | no |
**F-036** | P3 | EXPECTED / MISLEADING | `effort` is inert on the default Gemini path — `POSTCALL_EFFORT` changes nothing | `E-091` | — | — | — | tuning knob does nothing | **CODE-PROVEN** | **S** | no |
**F-037** | P3 | DEAD PATH | Dead code: `worker/src/postcall.ts` (a duplicate lacking the determinism pin), `worker/zoom-app.js` (82 KB vendored bundle), `isFirestoreStoreReady` (inverted logic, zero callers), `#postcall-loading` (never shown, hidden at 6 sites), `19_history_tasks_feedback.sql` | `E-114`, `E-113`, `E-115`, `E-077`, `E-053` | — | — | — | — | **CODE-PROVEN** | **S** | no |

---

## 2. P0 / P1 detail

### F-001 — dual-writer idempotency collision

- **Trigger**: any post-call analysis where the history SQL write runs first — i.e. **any existing-account call** (`savePayload.accountId` present, so `tryHistoryPostCallSqlWrite` does not skip), which is the common case.
- **Environments**: any environment where `postgresReady` is true **and** `PERSISTENCE_MODE ∈ {sql, dual}`. Not Cloudflare (`E-117`). Not the shipped VPS default (`E-116`).
- **Blast radius**: every normalized child row for that call. The account, deal and contacts survive.
- **Already affected?** Yes — `janus/schema/34…sql:15-21` records that `v_scorecard_rankable` had rows for exactly 2 calls, "every real call since has 0 rows in `scorecard`".
- **Detection**: `SELECT count(*) FROM post_call WHERE idempotency_key = 'call_' || public_id;` — every such row is a call whose domain write failed. Plus `grep -c 'dual-write-DROPPED'` in worker logs and `Lifecycle dual-write (post-call) failed` in browser telemetry.
- **Recovery**: possible. The history blob retains every artefact, so a replay job can reconstruct child rows from `user_kv`/KV/file per call. Nothing is unrecoverable **provided the history blobs are intact**.
- **Containment before repair**: make `trySqlDomainWrite` surface the failure (or at least `logFallback` it) so the silence stops; and make the browser show a non-blocking warning instead of `console.warn`. Do **not** align the keys yet — see F-005.

### F-005 — destructive `detail` UPSERT (fix this BEFORE F-001)

- **Trigger**: any second `upsertPostCall` for the same `idempotency_key` — i.e. any history patch once the keys agree.
- **Today it is masked** by F-001: the second writer errors before reaching `DO UPDATE`. `R-005` exercised the branch directly and it destroyed all 12 `detail` collections, `transcript_ref`, `detail_shape_version` and `pipeline_state` from a single patch.
- **This makes remediation order load-bearing**: aligning the keys first would convert a silent write-failure into recurring active data loss on every hydration patch (5–8 per call).
- **Detection**: `SELECT count(*) FROM post_call WHERE detail IS NULL;` — expected to be ~100% today.
- **Fix**: adopt the `COALESCE` form already present at `routes.ts:2400-2409`, and stop passing an explicit `detail: null` from a writer that has no detail to contribute.

### F-002 / F-003 — the hydration tail never reaches SQL, and Passes 8/9 run empty

- **Trigger**: every post-call analysis, unconditionally.
- **Root cause is structural, not a race**: `/api/postcall/generate` does not return the hydrated artefacts (`E-013`), the single lifecycle link consumes only that response (`E-014`), and the hydration completion hook writes nothing (`E-016`).
- **Blast radius**: 18 of 20 artefacts. Pass 8 and Pass 9 produce durably wrong output wherever the write does land.
- **Detection**: §8.4 of [05](05-runtime-sql-verification.md).
- **Recovery**: reconstructable from history blobs.

### F-004 — IDOR write on `offload-payload`

- **Trigger**: `POST /api/calls/<any id>/offload-payload` with any valid session token.
- **Blast radius**: the offloaded payload (analysis / transcriptMeta / detail) of any call in the tenant.
- **Detection**: correlate GCS object writes against `assertCanReadResource` outcomes; there is currently no audit row.
- **Containment**: add `assertCanReadResource(ctx, resourceFromRow(postCall))` exactly as the GET sibling does (`domain-reads.ts:166`). Two-line fix.

### F-025 — committed Zoom credential

- **Trigger**: repository read access.
- **Blast radius**: one Freshworks Zoom cloud recording (likely a real customer call, i.e. customer PII).
- **Containment**: delete the five files, treat the passcode as compromised, delete or re-passcode the recording, and check `git log --all -S` for history exposure. **Deleting the files does not remediate pushed history.**

### F-023 — telemetry attribution

- **Trigger**: every LLM call.
- Of ~28 provider invocations per post-call, essentially **none** join back to a `post_call` row. `ai_run` is append-only (`E-093`) so historical rows can never be repaired.
- Downstream: the summarise cost-anomaly detector skips rows without a `callId` and therefore has a permanently empty baseline.

---

## 3. Hypothesis resolution

| H | Verdict |
|---|---|
H1 — history upsert may erase hydrated `detail` | **CONFIRMED, currently masked by H2.** `R-005` |
H2 — two writers, incompatible idempotency keys | **CONFIRMED. `23505` on `post_call_public_id_key`.** `R-004`. Note the earlier assumption that `upsertActivity` was the failing statement is **wrong** — its CTE is correct; `upsertPostCall` is the failure point |
H3 — `analysis_done` set before analysis completes | **CONFIRMED**, and stronger: it is the *only* value ever written; `provisional` is permanently true |
H4 — hydrated outputs never reach normalized SQL | **CONFIRMED** |
H5 — Pass 8 uses incomplete evidence | **CONFIRMED** — it uses *no* current-call evidence |
H6 — Pass 9 summarizes stale/incomplete evidence | **CONFIRMED** for the synchronous path; the batch path is a **DEAD PATH** (unregistered route) |
H7 — Pass 3 lacks current video/timeline evidence | **CONFIRMED** |
H8 — history and relational state diverge | **CONFIRMED**, with inverted precedence between paths |
H9 — concurrent history patches lose updates | **CONFIRMED** at the server (no CAS); local RMW is synchronous so local is safe |
H10 — the browser is an unreliable job runner | **CONFIRMED** |
H11 — bulk sync/recovery bypasses SQL projection | **CONFIRMED** |
H12 — persistence defaults disagree by runtime | **CONFIRMED**, and worse: three defaults for one variable in one request |
H13 — schema deployment paths out of sync | **CONFIRMED** for migration 34 (`R-003`) |
H14 — "best effort" child persistence creates false success | **CONFIRMED** — ten sites |
H15 — read fallbacks and caches hide SQL defects | **CONFIRMED.** A working UI masks an absent SQL row, and SQL-only mode is unobservable from the browser (`E-119`) |
H16 — LLM telemetry does not correlate work to the call | **CONFIRMED**, ~0% attribution |
H17 — the first page hides a multi-stage workflow behind one disabled button | **CONFIRMED** |
H18 — Pass 0 and the gate delay real analysis | **CONFIRMED** |
H19 — Zoom transcript acquisition is not a reliable automatic pipeline | **CONFIRMED** |
H20 — post-call views suffer render races and read amplification | **CONFIRMED** |
H21 — automatic Zoom handling lacks a durable ingestion boundary | **CONFIRMED — none exists** |

**21 of 21 hypotheses resolved. None runtime-blocked.**

## 4. Things that are correct, and should not be "fixed"

Stated explicitly so remediation does not damage them:

- **RLS and grants genuinely work.** `grants_smoke` 18/18, `rls_fails_closed` 8/8, `view_rls` 4/4 against a live database (`R-006`). Fails closed with no session vars; `security_invoker` views enforce base-table RLS.
- **`upsertActivity`'s CTE** correctly resolves on `public_id OR idempotency_key` and does not raise. It is the model `upsertPostCall` should follow.
- **`routes.ts:2400-2409`** already implements the correct non-destructive JSONB merge.
- **`upsertAccount`'s slug-dedupe** correctly handles a Firestore-minted `public_id` colliding with an existing slug.
- **The abort/generation machinery** (`beginPostcallPipeline`, `isPostcallPipelineStale`, `crmMatchesToken`, `callPanelRenderGen`) is well built where it is applied.
- **`replaceCallParticipants`'s SAVEPOINT** correctly prevents a participant failure from poisoning the enclosing transaction.
- **Fail-safe scoring**: when the verifier or golden pass errors, `leadershipShareable` is forced false rather than granted. Do not weaken this.
- **The `[history][dual-write-DROPPED]` log line** is deliberately loud and greppable. Keep it.
