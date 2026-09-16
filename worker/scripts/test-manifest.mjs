/**
 * Test manifest for worker/scripts/run-tests.mjs.
 *
 * Built by classifying every worker/scripts/test-*.{ts,mjs} file (2026-08-09,
 * against branch v2/2.1): files that hit a running worker over HTTP at
 * 127.0.0.1:8787 AND depend on Firestore Admin SDK state are tagged
 * "emulator" (need `firebase emulators:exec` — same mechanism rules-tests/
 * already uses); files that call a real external API (Gemini generateContent,
 * live Zoom/video) are tagged "live-api" — never run by CI or the deploy
 * gate, only the nightly eval workflow or by hand with a real API key.
 * Everything else — including files that construct a Request object and call
 * a route handler function directly in-process (e.g. test-dispute-notify.ts)
 * rather than making a real network call — is tagged "unit".
 *
 * An untagged file is NOT covered by `npm test` — that's the exact failure
 * mode this manifest exists to prevent. Add new test files here explicitly.
 *
 * @typedef {{ file: string, tags: string[], reason?: string, needsServer?: boolean }} ManifestEntry
 * @type {ManifestEntry[]}
 */
export const manifest = [
  {
    "file": "test-api-store-parity.ts",
    "tags": [
      "live-api"
    ],
    "reason": "own docstring requires GOOGLE_APPLICATION_CREDENTIALS against a real project — confirmed on 2026-08-10 it fails under the Firestore emulator with \"Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON\", so `emulator` was the wrong tag"
  },
  {
    "file": "test-account-writable-session.ts",
    "tags": [
      "sql"
    ],
    "reason": "J-010 regression gate: needs a live PostgreSQL with the schema applied through migration 35, and commits/deletes JANUS_AUDIT_TEST fixtures. Run by `npm run test:sql-gates`; refuses non-loopback hosts unless --allow-remote"
  },
  {
    "file": "test-route-authorization.ts",
    "tags": [
      "unit"
    ],
    "reason": "P4 route authorization gate (F-004/F-010/F-011). In-process: calls scope predicates and two route handlers directly, no Firestore and no server. The two Firestore-backed handlers are covered through the predicate they call, since the emulator needs a JDK this machine lacks"
  },
  {
    "file": "test-deal-create-idempotency.ts",
    "tags": [
      "unit"
    ],
    "reason": "UAT-003 regression gate (2026-09-11 staging UAT: deal count observed going 4 -> 8 on retry/reload). handleDealsCreate's write path is now createDealIdempotent, exported from routes.ts for this test and driven against a small in-memory fake implementing only collection().doc().create()/.get() -- no live Firestore/emulator (no JDK on this machine, same constraint as test-route-authorization.ts) and no real Firebase token verification, since the bug and the fix are both in the write path, not in auth. Proves: three identical-content retries collapse into one document with the same id; a genuinely later duplicate-content call (outside the 5-minute dedupe window) still creates a new one; and a self-contained simulation of the pre-fix `.add()` shape creates three distinct documents for the same three retries -- the exact defect this gate exists to catch"
  },
  {
    "file": "test-postcall-resolve-idempotency.ts",
    "tags": [
      "unit"
    ],
    "reason": "2026-09-11 staging UAT remediation item 10 (P1): runPostCallResolve has no Firestore/Postgres write of its own (unlike UAT-003's deal-create bug), but a network-level retry of POST /api/postcall/resolve would re-pay for a real Zoom API fetch and/or a real Gemini speaker-attribution call (attributeSpeakers is hardcoded true for this route). Fix is runPostCallResolveDeduped, exported from routes.ts for this test, which content-hashes the request via deterministicAppendId (same helper and time-bucket reasoning as UAT-003, much shorter window: RESOLVE_DEDUP_WINDOW_MS=30s). Driven entirely against an injected fake `run` and clock -- no live Zoom/Gemini/Firebase, same in-process style as test-deal-create-idempotency.ts. Proves: concurrent identical requests share one in-flight run; a post-success duplicate inside the window reuses the cached result; the same content outside the window runs fresh; a FAILED attempt is never replayed (protects resolveWithZoomPendingRetry's legitimate Zoom-transcript-pending polling from being starved by its own stale failure); different request bodies are never deduped; and the pre-fix shape (call the underlying resolve directly) always re-runs on every retry. Verified failing (import error -- RESOLVE_DEDUP_WINDOW_MS did not exist) against the pre-fix routes.ts via `git stash`, and passing after"
  },
  {
    "file": "test-fallback-telemetry.ts",
    "tags": [
      "sql"
    ],
    "reason": "P5 gate: proves a failed/skipped durable write lands a queryable, attributable sql_fallback_log row (correlation id, actor vs owner, sql-mode lost-write marking) and that the reason vocabulary matches chk_sfl_reason. Needs a live PostgreSQL with migration 37; inserts and deletes telemetry rows, so loopback only unless --allow-remote"
  },
  {
    "file": "test-ai-run-attribution.ts",
    "tags": [
      "sql"
    ],
    "reason": "P9 gate (J-019): proves an LLM run stays attributable to its call across the PRODUCTION ordering — analyze-call records the run before POST /api/history creates activity act_<callId>. janus/tests/ai_run_insert.test.mjs seeds the activity first, so it passed 15/15 while live attribution was 0.14%; this exercises the ordering that actually occurs. Also guards that attribution was not bought by weakening 18_ai_run_rls.sql (append-only, security_invoker). Needs a live PostgreSQL with migration 38; inserts and deletes rows, so loopback only unless --allow-remote"
  },
  {
    "file": "test-dormant-jobs.ts",
    "tags": [
      "sql"
    ],
    "reason": "P11 gate (J-021/J-023/J-036): sync_outbox is observable (status counts, dead-letter age, and a stuck-row count that must agree with claim_outbox_batch's own reaper condition), enqueueActive distinguishes a historical backlog from a live one so a pending alert cannot fire forever in sql mode, and the usage rollup is invocable and idempotent. Also asserts redact_pii() is executable only by janus_redactor as an EFFECTIVE privilege, so a blanket GRANT EXECUTE cannot silently re-widen it. Needs a live PostgreSQL with migrations 33 and 39; seeds and deletes rows, so loopback only unless --allow-remote"
  },
  {
    "file": "test-deal-status-enum.ts",
    "tags": [
      "sql"
    ],
    "reason": "Roadmap 1.6 gate (\u00a704 hunt 10): deal.status is written with the CLIENT vocabulary (paused/archived/closed_won_grace) which deal_status_enum cannot hold. Measured, that is worse than a failed write \u2014 22P02 on the enum poisons the transaction, so every sibling write batched with it fails 25P02 and the caller cannot recover by catching. assertDealStatus now refuses it in JS, before SQL, which leaves the transaction usable. Also a drift guard: DEAL_STATUS_VALUES must equal deal_status_enum in the database, so an ALTER TYPE forces a code change. Needs a live PostgreSQL; writes and deletes deal rows, so loopback only unless --allow-remote"
  },
  {
    "file": "test-assume-identity-cases.mjs",
    "tags": [
      "unit"
    ],
    "reason": "assume-identity hardening: route cases, audit ordering, nested-assume block"
  },
  {
    "file": "test-assume-identity-claims.mjs",
    "tags": [
      "unit"
    ],
    "reason": "assume-identity Firebase claim parse and expiry"
  },
  {
    "file": "test-domain-reads-auth.mjs",
    "tags": [
      "unit"
    ],
    "reason": "filterAccountsForReader scope matrix for domain-reads list fallback"
  },
  {
    "file": "test-append-idempotency.ts",
    "tags": [
      "sql"
    ],
    "reason": "Roadmap 3.5 gate (\u00a707.3): addArrOverride and addContactEvent had correct ON CONFLICT (public_id) DO NOTHING guards that could never fire, because the ROUTE minted the id as `aov_${dealId}_${Date.now()}` \u2014 so a retry appended a duplicate row to an audit trail. Ids are now derived from content plus a 5-minute window. The load-bearing checks drive trySqlDomainWrite, not the repository: supplying your own public_id only proves the ON CONFLICT works, which was never the broken part \u2014 verified by reverting, where the repo-level checks still pass and only the route-level ones report 'appended 3 rows'. Needs a live PostgreSQL; loopback only unless --allow-remote"
  },
  {
    "file": "test-provider-timeouts.ts",
    "tags": [
      "unit"
    ],
    "reason": "P10 gate (F-027): hung-socket and cancellation behaviour against a real loopback server (no external network), plus a drift guard asserting every pass name used in worker/src is explicitly classified to a timeout workload"
  },
  {
    "file": "test-ci-foundation.mjs",
    "tags": [
      "unit"
    ],
    "reason": "P15 gate: manifest completeness for both packages, tag runnability, schema-path agreement (J-004), and that DB-backed gates fail loudly without a database. Pure filesystem/text analysis"
  },
  {
    "file": "test-history-pg-backend.mjs",
    "tags": [
      "unit"
    ],
    "reason": "CORRECTION: an earlier version of this entry said worker/src/history-pg.ts does not exist. It DOES (imported by node-server.ts:12 and tasks-pg.ts:8), so the file's own optionalImport guard does not fire and this test does assert. The stale claim came from the test's own outdated docstring. Verify it asserts non-trivially, then drop this note"
  },
  {
    "file": "test-persistencereadmode-gate.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): PERSISTENCE_READ_MODE gate, in-process, no external deps"
  },
  {
    "file": "test-pg-read-repository.ts",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): exercises the PG read repository contract against a mock pool \u2014 no live database"
  },
  {
    "file": "test-postcall-update-idempotency-conflict.ts",
    "tags": [
      "sql"
    ],
    "reason": "was orphaned (F-038): needs a live PostgreSQL \u2014 verified passing against a disposable local cluster. Belongs to the sql lane, not the hermetic default"
  },
  {
    "file": "test-prep-save-fix.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): prep save regression, in-process"
  },
  {
    "file": "test-recovery-route.ts",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): recovery route handler called in-process"
  },
  {
    "file": "test-scorecard-retry.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): scorecard retry/seed behaviour. .mjs importing extensionless .ts specifiers, so it only runs under tsx \u2014 which run-tests.mjs always uses (see its runFile comment). Fails under bare `node`; that is the harness, not the test"
  },
  {
    "file": "test-user-usage.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): usage rollup against mock rows"
  },
  {
    "file": "test-concurrency-hazards.ts",
    "tags": [
      "sql"
    ],
    "reason": "P-C1 concurrency characterisation: exercises nine hazards identified by static analysis in 07-acid-concurrency-recovery.md and fails when measured behaviour diverges from the recorded baseline, in either direction. Deliberately provokes lost updates and duplicate-key aborts, so it refuses any non-loopback host"
  },
  {
    "file": "test-unique-constraint-coverage.ts",
    "tags": [
      "sql"
    ],
    "reason": "roadmap 3.4 (RESCOPED) reachability gate for the twelve unique constraints 07-acid-concurrency-recovery.md §3 claims are named by no ON CONFLICT. §3 conflated 'unnamed' with 'reachable'; this suite tests each constraint INDIVIDUALLY through its real repository write path and records REACHABLE or ABSORBED, failing on divergence in either direction like test-concurrency-hazards.ts. Every REACHABLE verdict also probes a follow-on statement for SQLSTATE 25P02, because the harm is the aborted transaction and not the failed statement. Deliberately provokes duplicate-key aborts, so it refuses any non-loopback host unless --allow-remote; C10 needs the rubric catalog loaded (janus/scripts/load-rubric-catalog.mjs) and SKIPs without it"
  },
  {
    "file": "test-arr-compute.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-batched-hydration.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-canonicalize-sources.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-coach.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-classify-motion.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-company-news.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-consistency-lib.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-contact-enrich-match.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-contact-enrich-schema.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-context-attachments.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-context-field-router.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-cost-control.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-demo-guidance.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-disc-dos-donts-pipeline.ts",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-dispute-notify.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-e2e-http-prep-donts.mjs",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-extract-news.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-firebase-auth.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-frame-image.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-graceful-shutdown.ts",
    "tags": [
      "unit"
    ],
    "reason": "roadmap 3.6 gate: spawns src/node-server.ts as a child on a private loopback port (18991), parks an accepted-but-incomplete POST inside readBody(), sends SIGTERM twice, then completes the body — proves the in-flight request still gets a response, the process exits by its own code 0 rather than the signal's default action, and the repeat signal is a logged no-op. Hermetic: DATABASE_URL is cleared so closePool() takes its no-op path, no Firebase credentials, no external network, no server from run-tests.mjs needed"
  },
  {
    "file": "test-gap-cluster-engine.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gap-research.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gemini-batch.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gemini-gaps-schema.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gemini-prep-schema.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gemini-retry.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gemini-scorecard-schema.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-grounding-parse.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-history-api.mjs",
    "tags": [
      "emulator"
    ],
    "reason": "needs FIREBASE_PROJECT_ID + Firestore Admin SDK (real or emulator)",
    "needsServer": true
  },
  {
    "file": "test-icp-criteria.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-kaia-media-probe.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-kaia-prospect-match.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-kaia-share-parse.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-kaia-share.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-lifecycle-uniqueness.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-linkedin-identity.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-linkedin-pdf-match.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-manifest.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-models.mjs",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-node-boot.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-override-lib.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-pass-models.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-pdf-name-fallback.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-arr-compute.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-arr-inputs.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-cache.mjs",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-postcall-commit.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-gaps.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-qualify.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-resolve.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-resolve-dual-source.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-scorecard.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-scorecard-context-containment.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prompt-injection-transcript.ts",
    "tags": [
      "unit"
    ],
    "reason": "P-D2 item 2 / roadmap 4.4 characterisation gate for prompt injection from transcript content (08-security-privacy.md §7 listed it as completely untested). Hermetic: globalThis.fetch is stubbed and THROWS on any URL it does not recognise, so there is no network call, no API key and no provider spend — the only credential is the literal \"stub-key-no-network\". Records a per-pass exposure signature (which message role the transcript lands in, its delimiters, whether responseSchema is pinned, temperature, tools) plus the reachable QIP ceiling, and fails when exposure changes IN EITHER DIRECTION, like test-concurrency-hazards.ts. It cannot prove whether a real model obeys an injected instruction — that needs the live-api lane — so compliant model output is stipulated and what the code does with it is measured"
  },
  {
    "file": "test-postcall-summaries.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-summarise.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-temperature-live.mjs",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-postcall-timeline.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-input-hash.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-grounding.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-normalize.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-payloads.mjs",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-price-book-lookup.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prospect-emails.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-quality-coach-cap.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-quality-score.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-rate-limit.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-recent-news.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-research-orchestrator.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-research-resilience.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-demo-thesis.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-domain-reads-precall.ts",
    "tags": [
      "unit"
    ],
    "reason": "precall staging: export smoke for scoped GET /api/accounts and /api/accounts/:id/deals handlers"
  },
  {
    "file": "test-rivals-context.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-rivals.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-route-reachability.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-rubric-anchors.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-rubric-profiles.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-schema-drift.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-se-context-facts.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-se-discovery-hints.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-se-motion.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-source-table.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-tasks-api.mjs",
    "tags": [
      "emulator"
    ],
    "reason": "needs FIREBASE_PROJECT_ID + Firestore Admin SDK (real or emulator)",
    "needsServer": true
  },
  {
    "file": "test-transcript-infer.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-transcript-speaker-parse.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-kaia-numeric-speaker-regression.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-meeting-room-multi-persona.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deck-validate.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deck-validate-temperature.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-leadership-cap-parity.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-scorecard-verify.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-scorecard-verify-transcript-window.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-scorecard-verify-dual.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-qip-golden-set.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-scorecard-calibrate.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-speaker-attribution-schema.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-video-facts.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-video-pass-live.mjs",
    "tags": [
      "live-api"
    ],
    "reason": "hits a real external API (Gemini/Zoom) — costs money, needs a key"
  },
  {
    "file": "test-video-pass-routing.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-video-sampling.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-zoom-api.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-zoom-share-media.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-zoom-share-network.ts",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-zoom.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "requires a real Zoom share URL + passcode as CLI args — not automatable"
  }
];
