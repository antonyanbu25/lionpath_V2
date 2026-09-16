# Astra Change Matrix

Every change on `fix/astra-audit-functional-prompts` that is not already on
`main`, with exactly one decision each. No source hunk is dropped silently.

```text
MAIN_BASE_SHA    a4d5cb7e8624f1f8fea1b4b807a2bac067fe8846
ASTRA_SOURCE_SHA d99d82d7ec9df095cb75bc30c243a5d9df609c0d
MERGE_BASE_SHA   0dfd6b1334eae0be1b2f8d10f286def70f2011a8
```

Divergence is small and recent: the merge base is from Sep 9 2026, `main` is
15 commits ahead, the Astra branch 3 commits ahead. 44 files differ.

## Source commits

| Commit | Subject |
| --- | --- |
| `c773b84` | fix(worker): register dead routes, harden Zoom fetch, stop process crashes on Firestore errors |
| `0d7d011` | fix(web): streamline post-call intake, fix realtime subscription leak, cut redundant repaints |
| `d99d82d` | docs: add astra-audit findings, remediation plan, and implementation prompts |

## Overlap with main

Only **three** files were modified on both sides:

| Path | Outcome |
| --- | --- |
| `web/postcall.js` | **Real conflict** — resolved by hand, see A-19 |
| `worker/src/routes.ts` | Auto-merged into disjoint regions — verified, see A-24 |
| `web/scripts/test-manifest.mjs` | Auto-merged — both sides' entries verified present |

The other 41 files were untouched on `main`, so they carry no conflict risk.

## Matrix

Decisions: `PORT AS-IS` / `RECONSTRUCT ON MAIN` / `OMIT` / `BLOCKED`.

| ID | Commit | Path / Symbol | Intended functional fix | Main changed? | DB risk | Decision | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | `d99d82d` | `docs/astra-audit/**` (15 md files) | Audit findings, remediation plan, implementation prompts | No | None | PORT AS-IS | n/a (docs) |
| A-02 | `d99d82d` | `docs/astra-audit/repros/*.ts` (3 files) | Standalone repro scripts for H1/H2 and a post-rebase verification | No | None — not wired into any suite, not imported by shipping code | PORT AS-IS | n/a |
| A-03 | `c773b84` | `worker/src/node-server.ts` | Add an `unhandledRejection` handler. The Firestore Admin gRPC transport can reject credential resolution outside the awaited call chain, which killed the whole Node process — every session dying for one request's missing config | No | Low — improves availability, changes no write path | PORT AS-IS | `test-node-boot.mjs` |
| A-04 | `c773b84` | `worker/src/zoom-api.ts` | Timeouts on every Zoom API call (F-027/E-099); `findRecordingByTopic` fallback when the share link has no start-time query param (F-026/E-104); distinguish "transcript still generating" from "will never have a transcript" (F-026/E-107) | No | None — no DB access | PORT AS-IS | `test-zoom-api.ts`, `test-zoom-share-network.ts` |
| A-05 | `c773b84` | `worker/src/zoomShare.ts` | Timeouts on the share-link scrape path (F-027/E-099) | No | None | PORT AS-IS | `test-zoom-share-network.ts` |
| A-06 | `c773b84` | `worker/src/postcall/resolve.ts` | `classifyZoomFetchOutcome` plus `[zoom-telemetry]` counters so the real Zoom failure distribution is visible; thread `meetingTitle` into `fetchZoomRecordingViaApi` | No | **Reviewed** — sits in the post-call path but is purely additive: emits `console.info` and passes one extra argument. No SQL, no Firestore, no change to what is persisted | PORT AS-IS | `test-postcall-resolve.ts`, `test-postcall-resolve-dual-source.ts` |
| A-07 | `c773b84` | `worker/wrangler.toml` | Add `nodejs_compat` to `compatibility_flags` | No | **Deployment config — flagged for human review.** Additive; changes no binding, no secret, no var. Does not deploy anything by itself, but does change the Cloudflare runtime on the next deploy | PORT AS-IS (flagged) | typecheck; needs a deploy-time smoke test |
| A-08 | `c773b84` | `worker/scripts/test-route-reachability.ts` | New test asserting every handler is actually registered — the regression class that produced A-24 | No | None | PORT AS-IS | passes |
| A-09 | `c773b84` | `worker/scripts/test-zoom-share-network.ts` | New network-behaviour test for the Zoom paths | No | None | PORT AS-IS | passes |
| A-10 | `c773b84` | `worker/scripts/test-zoom-api.ts` | Extend for the new timeout / pending / topic-match behaviour | No | None | PORT AS-IS | passes |
| A-11 | `c773b84` | `worker/scripts/test-manifest.mjs` | Register A-08 and A-09 | No | None | PORT AS-IS | 93 worker tests selected (was 91) |
| A-12 | `c773b84` | `worker/package.json` | Test scripts for the new files; `allowScripts` allowlist | No | **Reviewed** — `allowScripts` permits install scripts for named packages. No dependency version changed and **no lockfile is modified** (verified against the final diff) | PORT AS-IS | `npm ci` from lockfile succeeds |
| A-13 | `0d7d011` | `web/domain/store.js` | Add `waitForDomainStoreReady()`. `fbReadyPromise` only resolves when the store enters *firestore* mode, which never happens in the default *api* mode, so callers awaiting it hung forever on every subscription attempt (F-031/E-066) | No | **Reviewed** — `web/domain/**` is high-risk by policy. This adds a readiness helper and removes dead code; it does not touch any write path | PORT AS-IS | `test-postcall-intake-e2e.mjs` (see A-21) |
| A-14 | `0d7d011` | `web/domain/store.js` — remove `isFirestoreStoreReady()` | Dead-code removal; the README records that it was once declared twice | No | None — **verified zero callers** on either branch (only its own definition plus a README mention) | PORT AS-IS | build plus full web suite |
| A-15 | `0d7d011` | `web/app.js` | Use `waitForDomainStoreReady()` at 5 sites instead of awaiting `fbReadyPromise`; coalesce rapid post-call hydration updates into one panel refresh per call id | No | Low — read/subscription path only | PORT AS-IS | `test-call-view-paint-count.mjs` |
| A-16 | `0d7d011` | `web/call-view.js` | One explicit state per call-record paint (P14); stop `saveMom()` firing twice per click from the double click-event binding (F-034/E-078); remove an intermediate repaint | No | **Reviewed** — the duplicate-submit fix *reduces* duplicate writes, which is the direction the idempotency invariant wants | PORT AS-IS | `test-call-view-paint-count.mjs`, `test-call-view-tab-pending.mjs` |
| A-17 | `0d7d011` | `web/crayons-ui.js` | Generalize `bindActionOnce` so the double click-event fire is fixed once centrally (F-017/E-079) | No | Low — same duplicate-submit class as A-16 | PORT AS-IS | full web suite |
| A-18 | `0d7d011` | `web/history.js` | Newest `updatedAt` wins on merge collisions. Argument order used to decide, so an earlier list's stale copy could overwrite a fresher record | No | **Reviewed** — this is a client-side merge of already-fetched history lists, not a persistence decision. It makes staleness deterministic rather than order-dependent | PORT AS-IS | `test-history-merge-precedence.mjs` |
| A-19 | `0d7d011` | `web/postcall.js` — `computeAnalyzeButtonDisabled` | Drop the `crmPreviewSurfacedOnce` gate. It was set only after a CRM round-trip and reset on every keystroke, so the primary action could go dark again after the user had filled every field (F-016/E-003) | **YES** | **Reviewed and cleared** — `crmPreviewSurfacedOnce` is a module-local boolean meaning "the preview rendered at least once". It carries no account or deal identity, so removing it removes no data resolution; account and deal still resolve server-side through `activity` | **RECONSTRUCT ON MAIN** — kept main's `PROXY_SE_PICKER_ENABLED` guard *and* took Astra's gate removal. Neither `ours` nor `theirs` | full web suite; see FINAL_VALIDATION_REPORT |
| A-20 | `0d7d011` | `web/postcall.js` — rest of the file | Streamlined post-call intake, realtime subscription leak fix, fewer repaints | **YES** | Reviewed — all four of main's other contributions to this file verified intact (the import, the `confirmAndGenerate` proxy-SE re-check, the explicit `proxySeUserId` in `savePayload`, the `resetPostCallView` re-wire) | PORT AS-IS (auto-merged) | full web suite |
| A-21 | `0d7d011` | `web/scripts/test-postcall-intake-e2e.mjs` | New e2e test for the intake flow | No | None | PORT AS-IS — **but it fails, and it fails identically on the unmerged source branch.** Not introduced here. See FINAL_VALIDATION_REPORT | **FAILING (inherited)** |
| A-22 | `0d7d011` | `web/scripts/test-call-view-paint-count.mjs`, `test-call-view-tab-pending.mjs`, `test-history-merge-precedence.mjs` | New focused tests for A-15 / A-16 / A-18 | No | None | PORT AS-IS | all pass |
| A-23 | `0d7d011` | `web/scripts/test-postcall-confirm.mjs`, `test-postcall-intake-preview.mjs`, `test-manifest.mjs`, `web/package.json`, `web/index.html` | Update existing tests for the new gating; register new tests; recording-link hint text now says the transcript is fetched, not transcribed | `test-manifest.mjs` only | None | PORT AS-IS | 152 web tests selected (was 148) |
| A-24 | `c773b84` | `worker/src/routes.ts` — register 8 unreachable routes | The handlers all existed on `main` but were never wired into the route table. `web/domain/read-models-service.js:76` already calls `/api/read-models/schedule`, so that one was a live 404 | **YES** | **Highest-risk item — split, see below** | `test-route-reachability.ts` |
| A-25 | `c773b84` | `worker/src/routes.ts` — `handleZoomStatus` / `handleConfig` | `configured` reported `zoomConfigured` (the user-OAuth triple, which has no callback route and no caller) instead of `zoomApiConfigured` (the Server-to-Server triple that actually fetches). A call could read as "Zoom configured" while fetching was structurally impossible (F-039/E-106). Both predicates are still exposed explicitly | **YES** (different region) | None | PORT AS-IS | typecheck, `test-zoom-api.ts` |
| A-26 | `c773b84` | `worker/src/routes.ts` — `handlePostCallResolve` | Surface `zoomTranscriptPending` and `meetingStartTime` so the browser can poll a retryable outcome instead of showing a dead end (F-026/E-107) | **YES** (different region) | None — response shape only, additive keys | PORT AS-IS | `test-postcall-resolve.ts` |

## A-24 split — the route registrations

Each newly reachable route was checked for its own authorization before being
accepted. Seven were accepted, one was omitted.

| Route | Guard verified | Decision |
| --- | --- | --- |
| `...healthRoutes` | Readiness probe; admin-only for detail, and deliberately does not 401 the prober | PORT AS-IS |
| `/api/read-models/schedule` | `requireUser`. **Already called by `web/domain/read-models-service.js:76` on `main`, where it 404s.** The body yields IDs only; every rebuild function re-reads from Firestore, so a crafted body cannot poison aggregates, and the response returns no data | PORT AS-IS — hardening noted |
| `/api/internal/batch/enqueue` | `verifyInternalCronAuth` on the first line | PORT AS-IS |
| `/api/internal/batch/poll` | same | PORT AS-IS |
| `/api/internal/batch/fallback` | same | PORT AS-IS |
| `/api/internal/read-models/nightly-rebuild` | same | PORT AS-IS |
| `/api/internal/deal-grace-sweep` | same | PORT AS-IS |
| `/api/admin/llm-usage` | `resolveRequestContext`, then 403 below director scope | PORT AS-IS |
| `/api/analytics/director-summary` | `requireUser` **only** — no role check, no org filter — and `queryDirectorCallVolume` aggregates the raw call-summary tables with no tenant predicate | **OMIT** |

All five internal handlers compare the cron-secret header with a timing-safe
comparison and **fail closed when the secret is unset**.

### Why `/api/analytics/director-summary` is omitted

Registering it would let any authenticated SE read org-wide call volume. That
is a tenant-isolation regression, and the ordered priorities put
authentication, authorization and tenant isolation **above** integrating the
Astra functional fixes — so authorization wins.

Omitting it costs nothing: **no caller exists in `web/` or `worker/` on either
branch**, unlike `/api/read-models/schedule`, which is actively called. The
route is also gated behind a BigQuery-configured check, so exposure would only
materialize where BigQuery is configured — but that is a deployment detail, not
a guarantee.

The rationale is recorded inline in `worker/src/routes.ts` at the route table,
with the re-enable steps: gate on director/admin scope the way
`admin-llm-usage.ts` does, add an org predicate to the analytics query, then
register it.

## Nothing was blocked

No item required a human decision in order to proceed. The one item needing
human *attention* is A-07 (`nodejs_compat`), which is integrated but flagged,
and the single `OMIT` above, which is a deliberate authorization call a
reviewer can reverse by following the inline instructions.
