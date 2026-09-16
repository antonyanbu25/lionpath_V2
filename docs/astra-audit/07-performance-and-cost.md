# 07 — Performance and Cost

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Evidence level:** the invocation counts, concurrency structure and timeout budgets are **CODE-PROVEN**. All *durations* below are a **static latency model** built from the repository's own documented p95 annotations, clearly labelled as such. No production telemetry was available — see §6.
**Related:** [02-postcall-dag](02-postcall-dag.md) · [06-bugs-and-risks](06-bugs-and-risks.md) · [12-postcall-ux-zoom-and-loading](12-postcall-ux-zoom-and-loading.md)

---

## 1. Why measured numbers are not available

`ai_run` exists, is populated, and is **~0% attributable to a user-visible post-call** (F-023):

- `ai_run` has **no `call_id` column** — only `activity_id` (`E-092`). The `callId` string is resolved to an internal id at write time and otherwise discarded.
- **No post-call route injects the authenticated identity**; `userId` and `callId` are client-supplied body fields (`E-094`).
- The critical-path passes send **no `callId` at all** (`E-095`).
- The video pass sends `call_pending_<ms>` (`E-064`), which resolves to nothing.
- `summaries` is structurally unattributable — its input type has no such field (`E-096`).
- `ai_run` is append-only, so no row can ever be backfilled (`E-093`).

So `SUM(cost_usd) GROUP BY activity_id` yields one large `NULL` bucket. **Fixing attribution is a prerequisite for any real performance work**, which is why it appears early in [10-remediation-plan](10-remediation-plan.md).

The repository does annotate its own observed p95s in `worker/src/providers/gemini-retry.ts:22-34`. Those annotations are the basis of the model below, and they are the strongest latency evidence available:

```
research:    45_000   /** google_search grounding p95 ~30–35s under load */
synthesize:  90_000   /** 12k-token brief JSON p95 ~65–75s */
postcall:    75_000   /** cached transcript + structured pass p95 ~50–60s */
vision:      60_000   /** up to 10 JPEG frames p95 ~35–45s */
extraction:  45_000   /** smaller prep extraction schemas p95 ~20–30s */
```

## 2. Provider workload table

`N` = invocations per normal post-call. `Budget` = AbortController timeout. **Model p95** = derived from the annotations above, by workload class.

| Workload | N | Nested | Model / effort | Budget | Model p95 | maxTokens | Retries | Critical path? | Attribution |
|---|---|---|---|---|---|---|---|---|---|
speaker-attribution | 0–1 | inside `/resolve` | flash-lite / `low` (inert) | **45 s — misclassified** | 20–30 s | 3000 | HTTP ×2 | **yes** | **NULL callId AND NULL userId** |
classify | 1 | — | flash-lite / `low` | 75 s | 50–60 s | 800 | HTTP ×2 | **yes** | NULL |
deck-validate | 0–1 | nested in generate | flash-lite / `low` | **45 s — misclassified** | 20–30 s | 400 | HTTP ×2 | **yes** | NULL |
analyze (narrative) | 1 | nested | flash-lite / `low` | 75 s | 50–60 s | 6000 | HTTP ×2 | **yes** | NULL |
**scorecard** | **1** | nested | flash-lite / `medium` | 75 s | 50–60 s | **12000** | HTTP ×2 | **yes** | NULL |
scorecard-verify | 1 (+1) | nested, **serial after scorecard** | flash-lite / `medium` | **45 s — misclassified** | 20–30 s | 8000 | +1 app-level | **yes** | NULL |
golden calibration | 1 (+1) | nested, **serial after verify** | flash-lite / `medium` | **45 s — misclassified** | 20–30 s | 8000 | +1 app-level | **yes** | NULL |
qualify | 1 | — | flash-lite / `low` | 75 s | 50–60 s | 4000 | HTTP ×2 | no | NULL |
**summarise** | **3** (parallel; MoM is its own call) | — | flash-lite / `medium` | 75 s | 50–60 s | 4000/2500/2500 | HTTP ×2 | no | NULL |
commit | 1–3 (parse ladder) | — | flash-lite / `low` | 75 s | 50–60 s | 4000→6000→8000 | +2 app-level | no | `recordId` — **null on first run** |
arr-inputs | 1 | — | flash-lite / `low` | 75 s | 50–60 s | 4000 | HTTP ×2 | no | null on first run |
gaps | 1 (+1 schema fallback) | — | flash-lite / `low` | 75 s | 50–60 s | 4000 | +1 fallback | no | NULL |
gap embeddings | **0–12** | per gap, `Promise.all` | `text-embedding-004` (hard-pinned) | **NONE** `E-099` | unbounded | — | none | no | none |
video/vision | 1 | all frames in ONE request, cap 10 | flash-lite | 60 s | 35–45 s | — | 1× refreshed URLs | no | **`call_pending_*`** |
video/transcript-infer | 1–2 | — | flash-lite | **NONE** `E-099` | unbounded | — | **none** | no | `call_pending_*` |
video/summary-timeline | 0–1 | — | flash-lite | **NONE** `E-099` | unbounded | none | no | `call_pending_*` |
summaries (Pass 9) | 1–2 | — | flash-lite / `medium` | 75 s | 50–60 s | 3500 | HTTP ×2 | no | **structurally impossible** |
arr-compute | 0 | deterministic | — | — | — | — | — | no | n/a |
timeline | 0 | **fully deterministic** `E-089` | — | — | — | — | — | no | n/a |

**Totals: 15–18 `generateContent` + up to 12 `embedContent` ≈ 27–30 provider HTTP calls per normal post-call.** Worst case with every retry: ~24 `generateContent`.

### 2.1 Two structural cost findings

- **`effort` is inert.** `buildRequestBody` never reads `req.effort`, and any Gemini-3 model is pinned to `thinkingLevel: "minimal"` (`E-091`). `POSTCALL_EFFORT` is a no-op knob. Every "medium effort" pass above is in fact running at minimal thinking.
- **The only cost guardrail is inert too.** The daily token budget no-ops whenever `userId` is absent (`E-098`), which is essentially the whole pipeline, and `transcript-infer` / `embeddings` / `gemini-batch` never reserve at all. Every reservation that *does* happen books a flat 120 k regardless of the actual call size, so a 300-maxToken LinkedIn extraction reserves as much as the 12 000-maxToken scorecard.

Cost cannot be stated in currency: `cost_usd` is computed at write time from `cost-rates.ts`, but the rows are unattributable, and no rate source was authorised for a live lookup.

## 3. The critical path

```
page open
  └─ CRM preview lookup (1 network round-trip)      ← THE BUTTON IS DISABLED UNTIL THIS RETURNS
        └─ [human: fill fields; every keystroke re-disables the button]
              └─ click Analyse
                    ├─ flushCrmMatchesPanel      (await — a SECOND CRM lookup)
                    ├─ collectIntakePayload      (await)
                    ├─ postCallOwnerId           (await)
                    ├─ loadPostCallResolveContext(await, 12 s timeout race)
                    ├─ POST /api/postcall/resolve      ← Zoom fetch + identity match + 1 LLM
                    ├─ enrichResolveDealsForAccount    (await)
                    ├─ resolvePipelineSeMotion         (await)
                    └─ POST /api/postcall/classify     ← 1 LLM
                          └─ CONFIRMATION GATE          ← human wait #2
                                └─ click Confirm
                                      ├─ serial for-await ensureCustomerContact × N   ← BLOCKS EVERYTHING
                                      ├─ [qualify ∥ summarise ∥ arr ∥ commit ∥ video launched, NOT awaited]
                                      └─ POST /api/postcall/generate                  ← THE ONLY AWAITED BRANCH
                                            ├─ analyze  ∥  (deck → scorecard)
                                            ├─ verify                (SERIAL)
                                            └─ golden calibration    (SERIAL)
                                                  └─ savePostCallHistory → navigate
```

**Model p95 for the awaited chain**, using the repo's own annotations:

| Segment | Model p95 | Note |
|---|---|---|
CRM preview before the button enables | 0.3–1 s | ×2 in practice (`E-006`) |
`flushCrmMatchesPanel` + collect + ownerId + resolveContext | 0.5–2 s | four serial awaits |
`/resolve` (Zoom fetch + speaker attribution) | 3–35 s | Zoom scrape is 5 sequential HTTP calls with **no timeout** |
`/classify` | 50–60 s worst, typically ≪ | 800 maxTokens — fast in practice |
**→ time to confirmation gate** | **~5–40 s** | |
contact-creation loop | 0.2 s × N customers | serial |
`/generate` = max(analyze, deck→scorecard) + verify + golden | **~90–150 s** | three serial LLM legs |
**→ time to first result** | **~95–190 s after confirm** | |
hydration to a stable view | + 60–120 s | 9–11 more LLM calls behind 3 barriers |

### 3.1 Unnecessary serialisation barriers, ranked by recoverable time

| # | Barrier | Recoverable | Why it is safe to remove |
|---|---|---|---|
1 | `verify` and `golden calibration` are serial after `scorecard` | **~40–60 s** | Both consume the *same* scorecard and transcript. Golden calibration explicitly preserves the verifier's `leadershipShareable`/`verifierJustifications` (`generate.ts:239-243`), so it does not depend on the verifier's *scores* — only on its flags, which could be merged afterwards. Running them concurrently and merging is behaviour-preserving. |
2 | Contact-creation loop is serial and blocks generation | **0.2 s × N** | Contacts are only needed by `linkPostCallToLifecycle`, which runs *after* generate returns. Parallelise, or defer entirely. |
3 | `/classify` blocks the confirmation gate | **up to a full LLM round-trip** | The gate needs `resolve` for identities; `callType` is a *pre-selected default the user can override*. Render the gate on resolve, fill the call-type chip when classify lands. |
4 | Pass 0's four serial awaits before `/resolve` | 0.5–2 s | `postCallOwnerId` and `loadPostCallResolveContext` are already promise-started; the second `await postCallOwnerId()` is redundant. |
5 | `flushCrmMatchesPanel` on submit | 0.3–1 s | A second lookup of data already fetched to enable the button. |
6 | Call-view: 8 serial `safeEnrich` barriers | **seconds** | Sites 8/17 read the same deal twice; site 15 and site 18 each do two nested serial round-trips; the TC query runs 3× (`E-073`). |

**Removing barriers 1–3 alone is worth roughly 40–70 s of user-visible wait, with no correctness change.**

## 4. Non-LLM latency

| Source | Cost | Evidence |
|---|---|---|
Zoom share-link scrape | **5 sequential HTTP calls** (`share-info` → `validate-meeting-passwd` → play page → `play/info` → VTT), each with **no timeout and no retry** | `zoomShare.ts:400-494,635-665` |
Zoom API path | 2 calls (token cached, then a **paged** `/accounts/me/recordings` scan of up to 10×300 rows) + VTT download | `zoom-api.ts:165-200` |
ffmpeg frame sampling | 15 min cap (linear) / 5 min per window; concurrency semaphore of 2 with a 120 s queue wait | `video/ffmpeg.ts:173,268`; `ffmpeg-semaphore.ts:6-7` |
History serialization | **whole-record** POST on every hydration patch (5–8 per call) and a **whole-blob** load+put on the server | `E-020`, `E-021` |
localStorage history | full `getItem` + `JSON.parse` + `sort()` of the entire array, **≥12× per saved-call open** | `E-074` |
PostgreSQL pool | `connectWithRetry` + 3 `set_config` calls per transaction | `session-context.ts:334-345` |
Saved-call open | **≥10 network requests across 8 serial barriers**, 4 worker HTTP + 6 direct browser Firestore queries | `E-072`, F-029 |
Duplicate queries | technical commit fetched 3×; deal fetched twice (site 8 and the `getDeal:probe` at site 17) | `E-073` |
Renders | **6 full `#call-panel` innerHTML replacements** per open, each restarting KPI count-up animations | `E-070` |
Cold-start | 5 sequential dynamic imports in `bootDev`, two with stale `?v=` strings | `web/index.html:1034-1039` |
Intake handlers | every input handler bound twice (`fw*` + native) → 2× CRM lookups per blur | `E-006` |
Read amplification in `firestore` mode | 12 listeners **per render**, never unsubscribed, each snapshot triggering a full 10-request `loadCallBundle` + repaint | `E-065`, `E-066` |

## 5. Browser-visible timings (static model; not measured)

| Metric | Model | Dominated by |
|---|---|---|
Time to first meaningful post-call UI | < 1 s | static HTML; the form is visible by default |
Time until Analyse enables | **0.3–1 s after the first email blur, and it re-disables on every keystroke** | the CRM gate (`E-003`, `E-004`) |
Clicks + waits from page open to durable acceptance | **≥ 12 interactions, 2 human gates, 2 LLM waits** | see [12](12-postcall-ux-zoom-and-loading.md) §2 |
First Analyse click → confirmation view | **~5–40 s** | `/resolve` (Zoom) then `/classify`, serial |
Confirm → first useful result | **~95–190 s** | three serial LLM legs inside `/generate` |
Until the saved-call page stops changing | **+60–120 s** | hydration behind 3 barriers |
Network requests per normal journey | intake ~4–6; generate 1 + 5 background; saved-call open **≥10** (14 cold) | |
Duplicate requests | 2× CRM lookup per blur; 3× technical commit; 2× deal; 2× `POST /api/history` per MoM save | `E-006`, `E-073`, `E-078` |
Re-renders per saved-call open | **6** full-document replacements + 1 per realtime snapshot | `E-070` |
Layout shifts | the entire deal-context strip returns `""` on the local paint and appears ~8 barriers later; the ARR pill can disappear entirely | `E-083` |

**Core Web Vitals were not measured.** No Playwright trace was captured: the e2e suite requires a dev server plus a browser, and the audit's scope forbids the environment mutations that would need. The exact scripted journey to capture is specified in [11-implementation-prompts](11-implementation-prompts.md), Prompt 11.

## 6. What must be measured, and in what order

1. **Fix `ai_run` attribution first** (F-023). Until then every number here stays a model.
2. Then, per pass: p50/p95/p99, input/output/cached tokens, retry rate, timeout rate, cost — grouped by `activity_id`.
3. Capture a Playwright trace of the full journey for real Web Vitals and a network waterfall.
4. Instrument the six `#call-panel` repaints with `performance.mark` to size F-029 precisely.

## 7. Cheapest high-leverage optimisations

| # | Change | Est. gain | Risk |
|---|---|---|---|
1 | Run `verify` and `golden calibration` concurrently, merging flags afterwards | 40–60 s off the critical path | **low** — neither consumes the other's scores |
2 | Render the confirmation gate on `resolve`; fill the call-type chip when classify lands | up to one LLM round-trip | low |
3 | Parallelise or defer the contact-creation loop | 0.2 s × N | low |
4 | Drop the duplicate `flushCrmMatchesPanel` on submit; keep the CRM gate but make it non-blocking | 0.3–1 s + one request | low |
5 | Coalesce the six call-view repaints into one (local paint → one enriched paint) | most of the perceived load time | medium — needs the single view-state model |
6 | De-duplicate the 3× technical-commit and 2× deal reads | 2–3 round-trips | low |
7 | Use `bindActionOnce` everywhere `fw*`+native are paired | halves intake lookups; fixes the double MoM write | low |
8 | Add `AbortController` timeouts to the three unguarded provider calls | removes an unbounded hang | **low, and it is a reliability fix** (F-027) |
9 | Reclassify `scorecard-verify`/`calibrate`/`deck-validate`/`speaker-attribution` into the 75 s budget | prevents spurious 45 s timeouts on the critical path | low |
10 | Cache `getAccount` like `getDeal`/`getCall` | one request per call-view open | low |

Do **not** "optimise" by removing the verifier or the golden-set pass. Both are correctness/calibration machinery, and both already fail safe by refusing leadership-shareable status on error.
