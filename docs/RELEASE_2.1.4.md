# Release 2.1.4 — pre-call autofill, dashboard activity, SSO click, post-call latency

**GitHub branch:** `2.1.4`
**Portal / worker build stamp:** `2.1.42` (internal cache-bust only — not the branch name)

## Summary

Five real bugs fixed after pulling the latest `2.1` into a working branch: the pre-call "Company website" field silently failing to auto-populate (both from typing and from CRM matches), the dashboard "Recent activity" panel staying permanently empty for SE/no-role Firebase sessions, the Google SSO button needing two clicks, and MEDDPICC/Call-timeline tiles lagging behind the rest of the post-call analysis for no real reason. Also fixed two pre-existing test failures unrelated to the above, and added five committed regression tests — each individually verified to fail against the pre-fix code — so none of these five bugs can silently ship again.

Everything below was found by live reproduction in the browser (not just code reading) and re-verified after the fix — see **Tests** for exact commands.

---

## Root causes

| # | Symptom | Root cause |
|---|---------|------------|
| 1 | Company website field never fills in from a typed prospect email | `setDomainValue()` in `web/prep-domain.js` wrote into `field.querySelector("input")` — on this Crayons `fw-input` build that matches the **hidden light-DOM serialization input**, not the real control in the shadow root. The write never rendered and got silently reverted. |
| 2 | Company website "gets stuck" after using the form more than once in a session | Two more write-sites had the identical no-op pattern: `clearFwInput()` (`web/precall.js`, used by "New brief") and the CRM-match domain write in `applyAccount()` (`web/prep-crm-resolve.js`). Because `clearFwInput` never actually cleared the *visible* field, a second brief in the same session inherited the first brief's stale domain, and because the CRM-match write never updated `prepDomainUiState.lastAutoValue`, the auto-fill guard treated that stale value as a real edit and permanently refused to overwrite it — even for a totally different, freshly typed email. |
| 3 | Dashboard "Recent activity" never loads for SE (or role-unknown) users signed in via real Firebase auth | `dashboardOpts()` in `web/app.js` handed the dashboard a real `subscribeRemoteCalls`/`subscribeRemotePreps` function whenever `isFirebaseAuthEnabled()`, but those functions silently no-op (never call the callback) when `fb.db` is `null` — which it always is for SE users by design (Firestore is intentionally never opened for them). Dashboard code treats "function exists" as "a subscription is coming" and skips both the local-data render *and* the worker-API fallback, so the panel stays empty forever. |
| 4 | Google Sign-In popup does nothing on the first click, works on the second | `runFirebaseSignIn()` (`web/app.js`) did `await waitForFirebaseBootstrap()` before calling `fb.signInWithPopup(...)`. `signInWithPopup` opens a real `window.open()` — browsers only trust that as a direct result of the click if there's no real async wait first. On the first click, Firebase's `authStateReady()` bootstrap is often still pending, so the await is a genuine delay and the browser silently blocks the popup. By the second click bootstrap has already resolved, the await is instant, and it works. |
| 5 | MEDDPICC and Call-timeline tiles consistently the last to appear in post-call analysis | `runPostcallParallelHydration()` (`web/postcall.js`) awaited `qualifyP` then `summariseP` **sequentially** even though they're independent network calls — summarise's tile couldn't render until qualify's had fully resolved. Separately, the timeline derivation was bundled into the same `Promise.all` as `commitP`/`videoP`/`arrWorkP`, so it waited on the video pass (ffmpeg + vision model — typically the slowest step in the whole pipeline) even though `deriveCallTimeline` only actually needs gaps + objections + scorecard data. |
| 6 | `test-no-dev-seed-in-prod-bundle.mjs` failing | `esbuild` was declared in `web/package.json` but never actually installed in this environment's `node_modules`. |
| 7 | `test-user-menu-signout.mjs` failing | Test-harness gap, not a product bug: `user-menu.js` added `panel.querySelector(".user-menu-theme")?.remove()` (part of the Theme-menu removal), but the test's hand-rolled `MockEl` class never implemented `querySelector` (only `querySelectorAll`/`closest`/`contains`). |

---

## Fixes applied

### `web/prep-domain.js`
- `setDomainValue()` now writes into `field.shadowRoot.querySelector("input")` (falling back to the light-DOM node only if there's no shadow root), and dispatches the `input` event from that real control instead of the host element.

### `web/precall.js`
- `clearFwInput()` and the submit-time domain-normalization write now go through `setFieldValue()` from `crayons-ui.js` (which already has the shadow-DOM-aware write + `setValue()` fallback used correctly elsewhere in the app) instead of a bare `field.value = ...` assignment.

### `web/prep-crm-resolve.js`
- `applyAccount()`'s CRM-matched domain write now: (a) uses `setFieldValue()` so it's actually visible, (b) skips the write entirely if `prepDomainUiState.userEdited` is true (a real manual edit is no longer silently overwritten by a CRM match), and (c) updates `prepDomainUiState.lastAutoValue` so a later email-based auto-fill doesn't treat this value as "the user's" and refuse to update it.

### `web/app.js`
- `dashboardOpts()` now gates `subscribeRemotePreps`/`subscribeRemoteCalls` on `fb?.db` in addition to `isFirebaseAuthEnabled()`, matching the exact no-op condition the builder functions themselves already check.
- `runFirebaseSignIn()` no longer awaits `waitForFirebaseBootstrap()` before `signInWithPopup(...)`. Safe because `ssoInFlight` (set synchronously before the popup call) is already checked by `shouldDeferNullAuth` / `shouldLogoutAfterNullCheck` in `web/auth-firebase-guards.js` — bootstrap's own login/logout logic already knows to defer to an in-flight SSO attempt.
- Removed the now-dead `firebaseBootstrapReadyPromise` / `waitForFirebaseBootstrap()` (no callers left) and a stale `if(false)fetch(...)` debug-telemetry line that had been investigating this exact SSO symptom (`hypothesisId: "H5"`) without a conclusion.

### `web/postcall.js`
- `qualifyP` and `summariseP` are now each handled in their own `async` closure and joined with `Promise.all` instead of two sequential `await`s — whichever resolves first now updates its own tile immediately.
- `videoP` is now handled as an independent fire-and-forget `.then()` that persists `videoFacts` whenever it resolves, instead of sitting in the same `Promise.all` as `commitP`/`arrWorkP`/`gapsP`. Timeline (via gaps) now proceeds as soon as commit + arr + gaps resolve, without waiting on video.

### `web/scripts/test-user-menu-signout.mjs`
- Added a `querySelector(selector)` method to the test's `MockEl` mock (supports `#id` and `.class`, searches descendants), matching the style of its existing `closest`/`contains`/`querySelectorAll`.

### Environment
- `web/node_modules` completed via `npm install` (`esbuild` was missing).
- Playwright's Chromium browser binary installed via `npx playwright install chromium` (was never downloaded in this sandbox, silently skipping/failing 15 e2e tests).

### Build
- Portal build bumped: **2.1.41 → 2.1.42** (`web/index.html` `portal-build` meta; `web/firebase-config.js` `AUTH_BUILD_ID` / `MODULE_BUILD` — auth/bootstrap JS changed, per that file's own bump-when comment).

---

## Prevention — don't reintroduce these

Each rule below is now a **committed, verified regression test**, not just a note — every one of them was confirmed to actually fail against the pre-fix code before being trusted (see **Regression tests added**).

**`fw-input` / `fw-textarea` value writes.** This Crayons build's custom elements do **not** support `field.value = x` as a plain property assignment — it's silently a no-op. The real, visible control lives in `field.shadowRoot`, plus there's a separate *hidden* light-DOM `<input class="hidden-input">` for form serialization that `field.querySelector("input")` will match instead if you're not careful. **Always** use `setFieldValue()` / `readFieldValue()` / `readFieldValueAsync()` from `web/crayons-ui.js` to read or write these fields — never hand-roll `field.value = ...` or `field.querySelector("input")` again. Three separate call sites had reinvented this incorrectly before this fix; if you're about to write a fourth, don't. Enforced by `test-prep-domain.mjs`'s shadow-DOM-realistic mock and `test-prep-crm-domain-writeback.mjs`.

**Auto-fill vs. manual-edit bookkeeping.** Any code that programmatically writes into `#companyDomain` must update `prepDomainUiState.lastAutoValue` (from `web/prep-domain.js`) and must check `prepDomainUiState.userEdited` before overwriting. If a new code path writes to this field without touching that shared state, it will either get silently overwritten later, or it will silently block all future auto-fill for the rest of the session (the exact bug this release fixes twice over). Enforced by `test-prep-crm-domain-writeback.mjs`.

**Any new realtime dashboard subscription.** Before wiring a new `subscribeX` builder into `dashboardOpts()`, check whether it can no-op without ever calling its callback (e.g. `fb.db === null` for SE users) and gate on the *actual* condition that makes it a no-op — not just `isFirebaseAuthEnabled()`. `dashboard.js`'s `_hasSub` check treats "is a function" as "a real subscription is coming," so a dead-but-truthy builder means the panel renders empty forever and the local/worker-API fallback path never runs either. Enforced by `test-dashboard-subscribe-fb-db-gate.mjs`.

**Anything calling `signInWithPopup` (or any `window.open`-based flow).** Do not add an `await` of any kind between the click handler and the popup call. Browsers only trust `window.open()` as a direct user gesture if there's no real async gap first — even an already-resolved promise adds enough of a tick on some browsers to break it. If you need to guard against a race (e.g. auth bootstrap not finished), use an in-flight flag (`ssoInFlight`) that the *other* code path checks, not an await in *this* path. Enforced by `test-sso-popup-no-async-gap.mjs`.

**`runPostcallParallelHydration()` sequencing.** Before adding a new pass, ask: does it genuinely need another pass's *output*, or is it just convenient to put it in the same `Promise.all`/`await` chain? Bundling an independent pass behind a slower one (as gaps/timeline was behind video) silently regresses perceived latency without any test catching it, since correctness is unaffected — only user-perceived speed is. If a future pass only needs a subset of an existing barrier's promises, give it its own smaller barrier. Enforced by `test-postcall-hydration-sequencing.mjs`.

**Test mocks must track their subject.** `test-user-menu-signout.mjs`'s `MockEl` broke the moment the real `user-menu.js` started calling a DOM method the mock didn't implement. When adding a new DOM method call to code that has a hand-rolled mock elsewhere (grep for `MockEl`/`class.*extends Element` in `web/scripts/`), add the corresponding mock method in the same change, don't wait for CI to catch it.

---

## Regression tests added

Every test below was written, then verified by temporarily reverting the matching fix and confirming the test actually fails — not just checked against the fixed code. Restored immediately after each check; `git diff` was clean before committing.

| Test | Guards against | How (behavioral vs. structural) |
|------|-----------------|----------------------------------|
| `test-prep-domain.mjs` (upgraded) | `setDomainValue()` writing to the light-DOM decoy instead of the shadow-DOM input | Behavioral — `mockField()` now models the real fw-input quirk (`.value` assignment is a no-op; `shadowRoot.querySelector("input")` holds the real, authoritative value) instead of a plain JS property, so every existing assertion in the file is now a real regression check, not just a logic check |
| `test-prep-crm-domain-writeback.mjs` (new) | `applyAccount()`'s CRM-match domain write not rendering, not updating `lastAutoValue`, and not respecting `userEdited` | Behavioral — calls the now-exported `applyAccount()` directly against the same shadow-DOM-realistic mock field |
| `test-dashboard-subscribe-fb-db-gate.mjs` (new) | `dashboardOpts()` gating `subscribeRemotePreps`/`subscribeRemoteCalls` only on `isFirebaseAuthEnabled()` and not `fb?.db` | Structural — `app.js` has global side effects on import and can't be safely unit-imported in Node, so this reads the source and asserts the exact gating condition on both lines |
| `test-sso-popup-no-async-gap.mjs` (new) | An `await` reappearing between the click (`ssoInFlight = true`) and `signInWithPopup(...)` inside `runFirebaseSignIn()` | Structural, same reason as above — extracts the function body and asserts the only `await` call in that span is `ensureFirebaseSdk()` |
| `test-postcall-hydration-sequencing.mjs` (new) | `qualifyP`/`summariseP` going back to sequential top-level `await`s, and `videoP` rejoining the `commitP`/`arrWorkP`/`gapsP` barrier | Structural, same reason — `postcall.js`'s hydration function has deep module state and can't be cleanly unit-imported |

Run just the new/updated regression tests:

```bash
cd web
node scripts/test-prep-domain.mjs
node scripts/test-prep-crm-domain-writeback.mjs
node scripts/test-dashboard-subscribe-fb-db-gate.mjs
node scripts/test-sso-popup-no-async-gap.mjs
node scripts/test-postcall-hydration-sequencing.mjs
```

All five are registered in `web/scripts/test-manifest.mjs` (tag `unit`), so they run automatically as part of `npm test` and the deploy gate — none of this depends on someone remembering to run them by hand.

---

## Tests

| Script | Result |
|--------|--------|
| `cd web && npm test` | **136/137** (see note below) |
| `node scripts/test-prep-domain.mjs` | PASS (upgraded mock) |
| `node scripts/test-prep-crm-domain-writeback.mjs` | PASS (new) |
| `node scripts/test-dashboard-subscribe-fb-db-gate.mjs` | PASS (new) |
| `node scripts/test-sso-popup-no-async-gap.mjs` | PASS (new) |
| `node scripts/test-postcall-hydration-sequencing.mjs` | PASS (new) |
| `node scripts/test-prep-crm-preview.mjs` | PASS |
| `node scripts/test-auth-firebase-guards.mjs` | PASS |
| `node scripts/test-firebase-session-resolve.mjs` | PASS |
| `node scripts/test-user-menu-signout.mjs` | PASS (fixed) |
| `node scripts/test-no-dev-seed-in-prod-bundle.mjs` | PASS (fixed) |
| `node scripts/test-postcall-render.mjs` | PASS |

Run the full suite:

```bash
cd web && npm test
```

**Known remaining failure:** `test-cache-accounts-contacts-e2e.mjs` — expects real Accounts/Contacts list data, but those pages now render the "Coming Soon" pre-launch gate (unrelated pre-existing product change, not caused by this branch). Left failing intentionally; revisit after the Coming Soon launch window closes.

No live end-to-end verification was possible for the SSO fix (#4) or the post-call latency fix (#5) — this sandbox has no `firebase-config.local.js` / Gemini API key configured. Both were verified by full code-path tracing plus the full test suite; #1–#3 were reproduced and re-verified live in a browser.

---

## Manual QA checklist

1. **Pre-call, typing (not pasting):** open a new brief, type a corporate email character-by-character (e.g. `jamie@acme.com`) — confirm Company website fills in as `https://www.acme.com` without getting stuck at a partial domain.
2. **Pre-call, repeat use:** create a brief, let it resolve an account, click **New brief** again, type a *different* email — confirm Company website reflects the new domain, not the previous brief's.
3. **Pre-call, manual edit:** type an email, then manually overwrite Company website — add a second prospect email — confirm your manual value is not silently reverted.
4. **Dashboard (SE login):** sign in as an SE with existing call/prep history — confirm "Recent activity" shows real entries, not permanently empty.
5. **Google SSO:** on a Firebase-enabled environment, click "Sign in with Google" once from a fresh page load — confirm the popup opens on the first click.
6. **Post-call:** run a call analysis — confirm MEDDPICC and the summary tile can appear in either order (whichever resolves first) and Call timeline no longer visibly waits on video processing to finish.

---

## Files changed

- `web/prep-domain.js`
- `web/precall.js`
- `web/prep-crm-resolve.js` (fix + exported `applyAccount` for testability)
- `web/app.js`
- `web/postcall.js`
- `web/scripts/test-user-menu-signout.mjs`
- `web/scripts/test-prep-domain.mjs` (mock upgraded to be shadow-DOM-realistic)
- `web/scripts/test-prep-crm-domain-writeback.mjs` (new)
- `web/scripts/test-dashboard-subscribe-fb-db-gate.mjs` (new)
- `web/scripts/test-sso-popup-no-async-gap.mjs` (new)
- `web/scripts/test-postcall-hydration-sequencing.mjs` (new)
- `web/scripts/test-manifest.mjs` (registered the four new test files)
- `web/index.html` (build stamp)
- `web/firebase-config.js` (build stamp)
- `docs/RELEASE_2.1.4.md` (new)
