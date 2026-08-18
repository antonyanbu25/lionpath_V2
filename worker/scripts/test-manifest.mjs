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
    "file": "test-postcall-scorecard.ts",
    "tags": [
      "unit"
    ]
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
    "file": "test-zoom.mjs",
    "tags": [
      "manual-only"
    ],
    "reason": "requires a real Zoom share URL + passcode as CLI args — not automatable"
  }
];
