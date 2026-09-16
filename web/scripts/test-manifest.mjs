/**
 * Test manifest for web/scripts/run-tests.mjs.
 *
 * Built by classifying every web/scripts/test-*.mjs file (2026-08-09, against
 * branch v2/2.1): files importing "playwright" that only ever navigate to
 * 127.0.0.1:8788 are tagged "e2e" (need a dev server — most expect one already
 * running, "test-org-hierarchy-e2e.mjs" spawns/tears down its own, flagged via
 * `server: "self-managed"`); files that navigate to a live
 * *.benjaminsquare.com host are tagged "manual-only" and are never run by any
 * automated runner (CI, deploy gate, or otherwise) — run them by hand only.
 * Everything else is a plain Node script with no browser/network dependency,
 * tagged "unit".
 *
 * Re-run `node scripts/gen-manifest-helper.mjs` (see repo docs) after adding
 * a new test-*.mjs file, or add an entry here by hand — an untagged file is
 * NOT covered by `npm test`, so silently forgetting this file is exactly the
 * failure mode this manifest exists to prevent.
 *
 * @typedef {{ file: string, tags: string[], server?: "self-managed"|"shared", reason?: string }} ManifestEntry
 * @type {ManifestEntry[]}
 */
export const manifest = [
  {
    "file": "test-account-arr-module.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-account-assignment.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-account-contact-dedupe.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-account-deal-fixes.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-account-list-dedupe.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-account-slug.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-account-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-accounts-ui-build.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-acting-owner.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-activities-feed-dedupe.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-activity-deal-association.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-api-store-admin-writes.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-arr-persist.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-auth-firebase-guards.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-auth-login-f5acac.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-briefs-list-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-cache-accounts-contacts-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-call-notes-bullets.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-product-signal.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-record-refresh-schedule.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-tabs-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-tc-merge.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-timeline-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-view-animate-progressive.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-view-animate.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-view-attendee-reconcile.mjs",
    "tags": [
      "unit"
    ],
    "reason": "UAT-008 gate (2026-09-11 staging: \"missed attendee\"). A person the user explicitly confirmed on the postcall confirm-step roster (record.confirmedIdentities.attendees) could silently vanish from every downstream view because call-view.js read the LLM's own analysis.callHeader.attendees directly, with no reconciliation. Proves resolveCallAttendees additively unions in a confirmed-but-LLM-missed attendee (never removing/overriding an existing LLM entry), that resolveMinutesViewModel's MoM greeting uses the confirmed customer's name instead of falling through to the text-scraping fallback that grabs the wrong name, and that records with no confirmedIdentities at all degrade to the exact pre-fix behavior."
  },
  {
    "file": "test-call-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-calls-list-account-batch.mjs",
    "tags": [
      "unit"
    ],
    "reason": "UAT-007: proves enrichDealsAndAccounts resolves K unique account ids with exactly ONE /api/accounts request instead of one-per-account (the read-models fallback it replaces still fires K, reproduced here for comparison), and that the batched result is identical to what per-id resolution via the working single-account endpoint would have produced -- i.e. no accounts silently added or dropped."
  },
  {
    "file": "test-calls-list-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-coach.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-coaching-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-contact-deal-mapping.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-contact-service.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-linkedin-title-contact.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-context-attach-wiring.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-crayons-ui.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-cross-team-proxy.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-customer-reference-links.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-dashboard-bad-nextsteps.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dashboard-browser.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "targets live production URL — never run automatically"
  },
  {
    "file": "test-dashboard-history-sync.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dashboard-launchpad-sync.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-dashboard-mobile.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "targets live production URL — never run automatically"
  },
  {
    "file": "test-dashboard-nav.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dashboard-refresh.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dashboard-scenarios.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "targets live production URL — never run automatically"
  },
  {
    "file": "test-dashboard-seeded.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dashboard-subscribe-fb-db-gate.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-dashboard.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-arr-module.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-call-linking.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-contacts-store.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-domain.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-e2e.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-meddpicc.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-motion-grace.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-motion-nb-expansion.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-motion.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-product-signal-rollup.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-traction.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deal-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-dew-theme.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-dispute-facts-modal-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dispute-full-flow-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-dispute-overlay-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-expand-theme-key.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-firebase-session-resolve.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-firebase-user-upsert-guard.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-firestore-read-api-fallback.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-firestore-rules-smoke.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-fish-sizing-buckets.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-fish-sizing-scenarios.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-gap-cluster.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-greeting.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-history-auth-refresh.mjs",
    "tags": [
      "unit"
    ],
    "reason": "UAT-001c gate (2026-09-11 staging: 401 on /api/history). app.js's shared token-getter wiring silently dropped the forceRefresh argument history.js's own 401-retry passes it, so every retry re-sent the identical cached token instead of a genuinely refreshed one. Behavioral half drives history.js's real setHistoryAuthGetter/fetchHistoryFromWorker against a fake Firebase user distinguishing forceRefresh; static half regression-guards app.js's actual source text, since app.js has zero exports and no precedent for being imported directly in a test."
  },
  {
    "file": "test-history-persistence.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-history-stub-firestore-guards.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-identity-merge.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-launchpad-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-load-budget.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-load-call-analyses.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-manager-dashboard.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-manager-firestore-fallback.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-manager-team-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-manager-ux-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-meddpicc-qualify.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-naming-conventions.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-nav-back-precall-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    file: "test-nav-back-record-e2e.mjs",
    tags: ["e2e"],
    server: "shared",
    reason:
      "UAT-009: entering a call/deal record from its list must history.pushState so browser " +
      "Back returns to the list instead of exiting the SPA. Needs real history.pushState/" +
      "popstate/page.goBack() semantics, which a jsdom-style history stub can't faithfully " +
      "reproduce — hence a full Playwright e2e rather than a unit test.",
  },
  {
    "file": "test-nav-perf.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-nextsteps-shape.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-no-await-in-loop.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-no-dev-seed-in-prod-bundle.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-org-hierarchy-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "self-managed"
  },
  {
    "file": "test-org-service.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-org-structure.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-person-dedupe.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-pipeline-progress.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-pipeline-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-plan2-browser-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-postcall-confirm.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-confirm-kaia-roster.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-room-attribution.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-contact-resolve.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-hydration-sequencing.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-intake-preview.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    file: "test-postcall-intake-invariants.mjs",
    tags: ["e2e"],
    reason:
      "Phase 2/3 invariants: one gesture -> at most one submit-path /api/postcall/resolve, "
      + "and #analyze-call never enabled while required fields are empty. Fixtures only, "
      + "no Zoom/Gemini/Firebase credentials. Avoids networkidle (login-bg.webm never settles).",
  },
  {
    "file": "test-postcall-intake-e2e.mjs",
    "tags": [
      "e2e"
    ],
    "server": "shared"
  },
  {
    "file": "test-postcall-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-deck-shape-gate.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-summary-only-chip.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-leadership-badge-gate.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-resolve-context.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-postcall-write-scope.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-brief-storage.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-bug-fixes-eval.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-design-tokens.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-dual-write-e2e.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-input.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-precall-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-contact-enrich.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-context-attachments.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-context-files.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-crm-domain-writeback.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-crm-preview.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-apply-account-deals.mjs",
    "tags": [
      "unit"
    ],
    "reason": "precall staging: prefetched deal rows reused in applyAccount path"
  },
  {
    "file": "test-prep-disputes.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-domain.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-enrich-gate.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-form-validation.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-generation-overlay.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-input-hash.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-linkedin-pdf.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-postcall-crm-parity.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-se-context.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-source-canon.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prep-v9-animate.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-prod-blank.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "targets live production URL — never run automatically"
  },
  {
    "file": "test-prod-reload.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "targets live production URL — never run automatically"
  },
  {
    "file": "test-prod-timing.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "targets live production URL — never run automatically"
  },
  {
    "file": "test-product-signal-view.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-profile-settings.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-qc-render.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-qip-insight-na.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-qip-normalize-parity.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-qip-radar.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-quality-coach-cap.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-quality-score.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-rbac-parity.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-realtime-persist.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-history-merge-precedence.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-view-tab-pending.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-view-paint-count.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-call-view-deal-field-flicker.mjs",
    "tags": [
      "unit"
    ],
    "reason": "UAT-005 (2026-09-11 staging report): pins the fix for score/deal-field flicker on cold open of a deal-linked call. Reproduces the bug directly — with call-view.js's `dealUnconfirmed` gating reverted, this test fails because the local-bundle paint commits to this call's own local ARR/MEDDPICC figures, which then visibly change once the real deal record loads."
  },
  {
    "file": "test-sanitize-disc-hints.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-se-detail-drilldown.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-se-motion.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-se-motion-parity.mjs",
    "tags": [
      "unit"
    ],
    "reason": "mirror-drift guard for J-025 (§10.3.2): the team/segment ids and motion labels are duplicated in web/domain/se-motion.js (imported) and worker/src/domain-model/se-motion.ts (hardcoded), and nothing else compares them. Runs both implementations over one fixture matrix — worker TS is type-stripped in-process with esbuild. Drift means browser and server grade the same SE on different rubrics (32 vs 27 credits)"
  },
  {
    "file": "test-search-service.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-sso-popup-no-async-gap.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-summaries-service.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-tasks.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-theme-score-suppression.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-transcript-upload.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-user-menu-signout.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-user-menu.mjs",
    "tags": [
      "unit"
    ]
  },
  {
    "file": "test-adr008-read-contract.mjs",
    "tags": [
      "unit"
    ],
    "reason": "TAUTOLOGY, visibly classified (P15, F-038 cited this file): a pending placeholder that asserts NOTHING until the routes.ts read-first contract lands. Registered so it is visible rather than orphaned; delete it or implement the contract"
  },
  {
    "file": "test-local-recovery.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): local recovery flow, in-process"
  },
  {
    "file": "test-postcall-domain-routing.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): post-call domain routing, in-process"
  },
  {
    "file": "test-writemode-fallback.mjs",
    "tags": [
      "unit"
    ],
    "reason": "was orphaned (F-038): write-mode fallback behaviour, in-process"
  },
  {
    "file": "test-worker-base-url.mjs",
    "tags": [
      "unit"
    ],
    "reason": "hostname -> API base URL routing, pure function, no browser/network"
  },
];
