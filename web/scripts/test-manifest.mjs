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
    "file": "test-call-view.mjs",
    "tags": [
      "unit"
    ]
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
  }
];
