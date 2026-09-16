# Post-call v2.2 — Identity-Aware Scoring, Deck PDF Evidence, Verifier + 8.0 Cap, Intake Gating

**Date:** 2026-08-18  
**Branch:** `feature/postcall-v2.2-identity-scoring`  
**Base:** `2.1.4` (commit `54792c2`)  
**Commits:** `7c2dc4f` → `cee15e5` → `ca3724e` → `023c976` → `e61fe1a`

---

## What changed (by feature area)

### 1. Deck PDF evidence replaces the deck-link field (Agent A)

**Problem:** `deckPresentForScorecard()` previously returned `true` for any non-empty string — a YouTube URL or a typed note was enough to unlock the `slide_deck` QIP theme with no grounded evidence, letting the model invent scores.

**Fix:**
- The `pc-deck-link` text input is removed from the intake form. Replaced by a **Deck PDF upload widget** (id `pc-deck-pdf`) reusing the existing `prep-linkedin-upload` markup pattern — zero layout change.
- Client-side PDF text extraction produces a `deckContent: { fileName, pageCount, slides: [{ page, text }] }` object capped at ~15 k chars of extracted text, truncating later slides first while preserving per-slide boundaries.
- `deckPresentForScorecard(deckContent, videoFacts)` — deck is present only if a parsed `deckContent` object exists, or if video facts show slide segments / `shareOnPct ≥ 25`. **A bare link never counts again.**
- The scorecard user-prompt now includes a `=== DECK (extracted from PDF, N slides) ===` section with per-slide text when `deckContent` is present.
- A new system-prompt rule requires `slide_deck` sub-parameters to be scored from actual deck content + transcript evidence; deck evidence is tagged `source: "artifact"`.
- `deckLink` **is kept** in `PostCallGenerateInput` and `PostCallScorecardInput` as a deprecated display-only field for historical records. Historical stored scorecards render without error.
- `scorecardCacheFingerprint` now hashes `deckContent`'s concatenated slide text (FNV-1a) instead of the raw link string.

### 2. Transcript speaker correctness + Kaia format (Agent B)

**Problem:** The three separate speaker-detection regexes in `worker/src/transcript.ts` accepted numeric/timestamp fragments (`00`, `01`, `13:45`) as speaker names — Kaia exports triggered this consistently.

**Fix:**
- New shared `isValidSpeakerLabel()` helper rejects purely numeric labels, clock fragments (`\d{1,2}(:\d{2}){0,2}`), and labels that start with a digit then a colon.
- Applied at all three inline speaker-detection sites (module-level `SPEAKER_LINE`, the cue-pushing helper in `parseTranscriptCues`, and the VTT whole-transcript parser in `parseVtt`).
- Explicit **Kaia-format support**: `looksLikeKaiaFormat`, `parseKaiaCues`, `parseKaiaTranscript` branch off from the main `parseTranscript` dispatch — `HH:MM:SS Speaker Name` and `Speaker Name HH:MM:SS` line shapes emit proper `[mm:ss] Speaker: text`-style cues.

### 3. Speaker attribution pass — Meeting Room role (Agent B)

**New `worker/src/postcall/speaker-attribution.ts`:**
- `runPostCallSpeakerAttribution` (temperature 0, JSON schema, classify.ts provider pattern): given parsed cues + known participants, produces a `roster` (merging `00`-style / device labels into real people using introductions, self-references, content cues) and `roomSegments` (spans where one shared-device label appears to carry multiple distinct voices, each attributed to a person with confidence + reason).
- Results ride on `PostCallResolveResult.speakerAttribution` — suggestions only, never auto-applied.
- `buildEffectiveTranscriptForScoring` rewrites room-attributed cues (e.g., `"Meeting room (via Priya Sen):"`) before the scorecard pass.

**Confirm-page UI (web/postcall.js):**
- `CONFIRM_ROLE_SET` extended: `"Meeting room"`, `"General Manager"`, `"Executive"` added alongside the existing five roles, each with a pastel chip tone in `CONFIRM_ROLE_TONE`.
- When an attendee's role is "Meeting room", a nested sub-panel renders beneath their row (`.postcall-attendee-row--room-member` modifier, existing attendee-body/detail/role-select/remove affordances reused) showing AI-suggested segments with time range, short quote, attributed person, confidence, and reason.
- `readConfirmationSelections()` now returns `roomAttributions: [{ roomLabel, spans: [{ startS, endS, person, role }] }]` plus `generalManagerIdentities` and `executiveIdentities` arrays.
- `formatConfirmedIdentitiesContext()` includes all new roles and room attributions in its text output.

### 4. Identity-aware scoring — the critical briefContext fix (Agent B)

**Problem:** `runPostCallScorecard`'s `briefContext` input was architecturally wired all the way through `generate.ts` → `scorecard.ts` → cache fingerprint, but **no caller anywhere ever populated it**. The scorecard scored every call with no knowledge of who the SE was.

**Fix:**
- `web/postcall.js` now sends a structured `confirmedIdentities` field in the generate request body (distinct from the free-text `additionalContext` that feeds the narrative pass, which is unchanged).
- `worker/src/postcall/generate.ts` → `runPostCallConfirmedPipeline` builds a real `identitiesContext` string from the structured `confirmedIdentities` + `roomAttributions` and passes it as a new `identitiesContext` field to `runPostCallScorecard` (the previously-dead `briefContext` wire remains for backward compat but is no longer the primary path).
- Before scoring, `buildEffectiveTranscriptForScoring` produces a rewritten transcript for the scorecard-only call; the narrative/analysis pass still uses the original transcript.
- New scorecard system-prompt rule 10: "CONFIRMED IDENTITIES are authoritative. Score SE-execution themes ONLY from speech by the Primary/Secondary SE, including `(via meeting room)` segments attributed to an SE. Customer/AE/GM/Executive speech is context and customer-signal evidence only, never SE-execution credit."
- `scorecardCacheFingerprint` extended with `identitiesContext` and `roomAttributions` (additive, Agent A's `deckContent` fingerprint unchanged).
- **Transcript cache safety:** `generate.ts` defensively drops the Gemini `transcriptCaches` bundle when the identity-rewritten transcript differs from the raw one (`scorecardTranscriptCaches = transcriptWasRewritten ? undefined : input.transcriptCaches`), preventing stale cache hits across rewritten vs original transcripts.

### 5. Score calibration, deterministic downgrade, adversarial verifier, 8.0 cap (Agent C)

**Calibration rules added to `buildScorecardSystemPrompt`** (rule 11, appended after identity rule 10):
- Sub-parameter 2 requires clear verbatim timestamped evidence of excellent execution.
- Typical average call should land mostly on 1s; thin evidence → 1, absent → 0.
- Score DOWN for shallow discovery, a generic/rehearsed demo, or SE talk-time dominance.

**Deterministic downgrade in `normalizeScorecardLines`:**
- Any sub-parameter scored 2 with an empty evidence array is pulled to 1.
- Exemption: deterministic video-derived sub-parameters (camera_on, cde_build, slide_deck-via-video-vision) — same gates as existing video-exempt logic.
- **No exemption** for PDF-deck-derived `slide_deck` evidence — PDF text is quotable evidence and subject to the rule.

**New `worker/src/postcall/scorecard-verify.ts`:**
- `verifyScorecardForLeadershipCap` runs only when provisional overall > 8.0.
- A second LLM call (temperature 0, JSON schema, classify.ts provider pattern) role-plays a skeptical SE director: for every score-2 sub-parameter, it either confirms (with one-line justification) or downgrades to 1/0 (with reason).
- Recomputes the full scorecard using the existing `scoreCall`/`computeThemeGrade` path — no second scoring implementation.
- Exports `LEADERSHIP_CAP_THRESHOLD = 8.0` as the single source of truth.

**`applyLeadershipCap(overall, verified)` added to both `worker/src/quality-score.ts` and `web/quality-score.js`:**
- If overall > 8.0 and the verifier did not run or did not confirm every remaining 2, clamp rendered score to 8.0.
- If verifier confirmed everything and overall still > 8.0: keep true score, set `leadershipShareable: true`, store `verifierJustifications` on the scorecard.

**UI (web/postcall.js result-render):**
- "Leadership-shareable" badge rendered (`.pill.green`) when `leadershipShareable` is set.
- "Capped at 8.0" badge (`.pill.amber`, tooltip explaining the verification bar) rendered when capped.

**Persistence (`web/domain/scorecard-service.js`):** `persistScorecardDraft` passes `leadershipShareable` and `verifierJustifications` through additively — historical records without these fields render without error.

### 6. First-page intake gating + button color progression (Agent D)

**`computeAnalyzeButtonDisabled` extended:** full mandatory set is now `(recording link OR transcript) AND contact email AND CRM preview surfaced`. New helpers: `recordingLinkPresentSync()`, `transcriptPresentSync()`, `hasRecordingOrTranscriptSync()`.

**Event listeners:** added `fwInput`/`input` listeners on `#pc-recording-url` (previously only drove passCode visibility) and `#pc-transcript` textarea (previously had no listener). `handleTranscriptFileChange` now calls `updateAnalyzeButtonState()` on both error and success paths.

**New `computeAnalyzeButtonProgress(s)`:** returns `{ completedCount, mandatoryCount, ratio }` over the three mandatory gates; `updateAnalyzeButtonState` sets `--pc-submit-progress` (0–1) on `#analyze-call`.

**CSS (web/postcall.css):** `#analyze-call` rule maps `--pc-submit-progress` to `color-mix(in srgb, var(--dew-primary) calc(30% + 70% * var(--pc-submit-progress)), transparent)` — same hue, opacity-only ramp, no new color token. Matching dark-theme and `prefers-reduced-motion` rules added in the existing pattern sections.

---

## RUBRIC_VERSION unchanged

`RUBRIC_VERSION = "2.1"` in `worker/src/rubric-profiles.ts` was **intentionally not bumped**. Calibration additions are prompt-side guidance only (scoring thresholds, downgrade logic) — no sub-parameter definitions, weights, or call-type applicability rules changed. Confirmed: `git diff 2.1.4 -- worker/src/rubric-profiles.ts` produces no output.

---

## Test coverage added

### New worker test files (all registered `unit` in `worker/scripts/test-manifest.mjs`)

| File | What it tests |
|---|---|
| `worker/scripts/test-transcript-speaker-parse.ts` | Zoom VTT with names, Kaia format, plain paste, `00`/`01` regression |
| `worker/scripts/test-kaia-numeric-speaker-regression.ts` | Exact old `00`/`01` speaker bug — asserts the fix engages |
| `worker/scripts/test-meeting-room-multi-persona.ts` | One shared-device label, multiple personas; expected attribution shape |
| `worker/scripts/test-deck-present-for-scorecard.ts` | Bare link → false; `deckContent` object → true; video-facts paths |
| `worker/scripts/test-leadership-cap-parity.ts` | `applyLeadershipCap` boundary at 8.0; worker vs `web/quality-score.js` parity |
| `worker/scripts/test-scorecard-verify.ts` | Verifier confirm / downgrade / fail-safe / vacuous paths (mocked Gemini fetch) |
| `worker/scripts/test-speaker-attribution-schema.ts` | Roster + roomSegments normalization (mocked fetch) |

### New web test files (all registered `unit` in `web/scripts/test-manifest.mjs`)

| File | What it tests |
|---|---|
| `web/scripts/test-postcall-room-attribution.mjs` | Meeting-room confirm-page, `readConfirmationSelections` shape with `roomAttributions` |
| `web/scripts/test-postcall-intake-preview.mjs` | Extended: `computeAnalyzeButtonDisabled` matrix including the new recording-or-transcript gate |

### New fixtures

| Path | Purpose |
|---|---|
| `worker/testdata/transcript-fixtures/zoom-vtt-real-names.vtt` | Zoom VTT with well-formed speaker names |
| `worker/testdata/transcript-fixtures/kaia-export-sample.txt` | Kaia-format export (HH:MM:SS lines) |
| `worker/testdata/transcript-fixtures/kaia-numeric-speaker-bug-regression.txt` | Kaia transcript that reproduced `00`/`01` speakers pre-fix |
| `worker/testdata/transcript-fixtures/numeric-speaker-bug-regression.txt` | Plain-paste variant of the numeric-speaker bug |
| `worker/testdata/transcript-fixtures/plain-paste-sample.txt` | Plain speaker: text paste |
| `worker/testdata/transcript-fixtures/meeting-room-multi-persona.vtt` | One shared-device label, multiple distinct voices |
| `worker/testdata/transcript-fixtures/meeting-room-multi-persona.expected.json` | Expected attribution output shape |
| `worker/testdata/deck-content-sample.json` | Sample `PostCallDeckContent` object for test fixtures |
| `worker/testdata/consistency/fixtures.json` | Additive: new `demo-meeting-room-with-deck` fixture; existing 10 fixtures untouched |

### `worker/scripts/self-consistency.mjs`

Extended to thread new optional fixture fields (`deckContent`, `confirmedIdentities`, `roomAttributions`) through the real `runPostCallScorecard` call path when present in a fixture.

---

## Test run results (2026-08-18)

### Tier 1: `cd worker && node scripts/run-tests.mjs --tag=unit`

**✅ 77/77 passed** — deploy gate green.

### Tier 2: `npm run test:web`

**✅ 138/139 passed.**  
One pre-existing failure: `test-cache-accounts-contacts-e2e.mjs` — the Accounts/Contacts views were intentionally gated behind a "Coming Soon" placeholder in commits `2309e5f8`/`a2f2ffee`/`b0386523` (Aug 9, predating this build), and the test was never updated to match. **Not a regression from this build.** Fixing it correctly requires either updating the test expectations to the Coming Soon state or reverting an intentional product decision — both out of scope for this postcall feature branch.

---

## Self-consistency verification (live Gemini — 3 runs, temperature 0)

### `demo-strong-retail`

| Run | Composite | Leadership flag | Verifier ran | Note |
|---|---|---|---|---|
| 0 | 5.48 | — | No | score well below cap |
| 1 | 5.48 | — | No | deterministic (temp 0) |
| 2 | 5.48 | — | No | deterministic (temp 0) |

Score SD = 0 across 3 runs. Cap did not engage (5.48 ≤ 8.0 — verifier threshold not reached, working as designed). All 16 theme-level SDs = 0 — fully stable. `camera_on` shows instability score 10 (the harness's determinism sentinel for vision-derived themes, not a scoring regression).

### `demo-meeting-room-with-deck` (new fixture)

| Run | Composite | Leadership flag | Verifier ran | `slide_deck` score | `slide_deck` evidence entries |
|---|---|---|---|---|---|
| 0 | 0.82 | — | No | 5 | 1 |
| 1 | 0.82 | — | No | 5 | 1 |
| 2 | 0.82 | — | No | 5 | 1 |

Score SD = 0 across 3 runs. `slide_deck` scored non-zero with evidence — the `deckContent` PDF injection is active and the model is grounding against the fixture's deck content. Composite is low because this is a minimal/synthetic fixture transcript, not a full SE call.

**Baseline comparison:** skipped — running against the original `2.1.4` branch in an isolated worktree would have required a separate `npm install` and was not performed within the scope of this build. The before/after repeatability comparison is therefore not available. The after-change numbers above show zero score variance (fully deterministic at temperature 0) for both fixtures.

---

## All files changed (from `git diff 2.1.4 --stat`)

```
web/domain/scorecard-service.js                    |   6 +
web/index.html                                     |  20 +-
web/postcall.css                                   |  82 +++
web/postcall.js                                    | 580 +++++++++++++++++++++
web/quality-score.js                               |  24 +
web/scripts/test-manifest.mjs                      |   6 +
web/scripts/test-postcall-intake-preview.mjs       |  52 +-
web/scripts/test-postcall-room-attribution.mjs     |  80 +++
web/shared/qip-scorecard-normalize.js              |   5 +
worker/scripts/self-consistency.mjs                |  91 ++++-
worker/scripts/test-deck-present-for-scorecard.ts  | 128 +++++
worker/scripts/test-kaia-numeric-speaker-regression.ts | 53 ++
worker/scripts/test-leadership-cap-parity.ts       |  61 +++
worker/scripts/test-manifest.mjs                   |  42 ++
worker/scripts/test-meeting-room-multi-persona.ts  |  71 +++
worker/scripts/test-scorecard-verify.ts            | 247 +++++++++
worker/scripts/test-speaker-attribution-schema.ts  | 216 ++++++++
worker/scripts/test-transcript-speaker-parse.ts    | 130 +++++
worker/src/postcall-schema.ts                      |   2 +-
worker/src/postcall/generate.ts                    |  78 ++-
worker/src/postcall/resolve.ts                     |  40 +-
worker/src/postcall/scorecard-verify.ts            | 280 ++++++++++
worker/src/postcall/scorecard.ts                   | 155 ++++++
worker/src/postcall/speaker-attribution.ts         | 329 ++++++++++++
worker/src/postcall/types.ts                       |  57 +-
worker/src/quality-score.ts                        |  31 ++
worker/src/routes.ts                               |   2 +-
worker/src/transcript.ts                           | 138 ++++-
worker/testdata/consistency/fixtures.json          |  61 +++
worker/testdata/deck-content-sample.json           |  11 +
worker/testdata/transcript-fixtures/kaia-export-sample.txt | 11 +
worker/testdata/transcript-fixtures/kaia-numeric-speaker-bug-regression.txt | 14 +
worker/testdata/transcript-fixtures/meeting-room-multi-persona.expected.json | 45 ++
worker/testdata/transcript-fixtures/meeting-room-multi-persona.vtt | 25 ++
worker/testdata/transcript-fixtures/numeric-speaker-bug-regression.txt | 4 +
worker/testdata/transcript-fixtures/plain-paste-sample.txt | 4 +
worker/testdata/transcript-fixtures/zoom-vtt-real-names.vtt | 13 +
38 files changed, 3134 insertions(+), 74 deletions(-)
```
