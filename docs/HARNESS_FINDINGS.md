# Eval harness — findings log (2026-08-09)

Working log kept while building the aggregating test runners, schema-drift guard,
Firestore rules coverage, deploy gate, and LLM eval/promotion-gate workflows on
`2.1-eval-harness` (branched from `v2/2.1`). Every item below was caught by a test
that already existed but had never been wired into `npm test` — see the branch's
top commit message for the full rationale, or `docs/AUDIT_RECONCILIATION_2.1.md`
NEW-002/NEW-003 for how the orphaning happened in the first place.

Chronological as written; later entries reference and resolve earlier ones.

---

# Findings surfaced by the new eval harness (web unit tier, first run)

117 unit-tagged tests run, 101 passed, 16 failed.

## Previously "wired" in npm test (already in the old && chain) — fail standalone too, not a runner bug:
- test-account-assignment.mjs — "manager adds secondary SE" assertion throws
- test-call-tabs-render.mjs — rendered text doesn't match /\n\nNext steps\n\n/ (content/template drift)
- test-pipeline-view.mjs
- test-user-menu.mjs — "FAIL: no profile settings in popup" (one assertion among ~50 in the file)

## Previously orphaned (never ran until now) — genuinely new findings:
- test-coaching-render.mjs
- test-cross-team-proxy.mjs
- test-deal-motion-grace.mjs
- test-history-persistence.mjs
- test-nextsteps-shape.mjs
- test-no-await-in-loop.mjs
- test-no-dev-seed-in-prod-bundle.mjs
- test-postcall-render.mjs
- test-postcall-write-scope.mjs
- test-rbac-parity.mjs  <- RBAC UI permission matrix, flagged as important in the plan
- test-summaries-service.mjs — "deal calls collected" assertion throws
- test-theme-score-suppression.mjs — "suppressed keeps coach line" assertion throws

# Worker unit tier (first run, after fixing stale node_modules + runner tsx bug)

68 unit-tagged tests run, 67 passed, 1 failed:
- test-firebase-auth.mjs — assertion `expected: /lookupUserForSession/` doesn't match actual output; file header claims "no live Firebase required" but content looks stale relative to current auth.ts. Orphaned test (never ran before), genuinely new finding.

Also found and fixed two runner-design bugs during validation (not app bugs):
1. Running .mjs test files via plain `node` instead of `tsx` broke on files that import .ts modules using TS-only syntax (constructor parameter properties) — fixed by always using tsx for worker tests.
2. Misclassified test-api-store-parity.ts as unit (it needs FIREBASE_PROJECT_ID + Admin SDK) and test-zoom.mjs as unit (it's an interactive CLI script needing a real Zoom share URL + passcode as args, not an automated test at all) — reclassified to emulator and manual-only respectively.

Note: could not fully validate the `emulator` and `live-api` tags execute end-to-end in this sandbox — the local machine's Java isn't actually functional (macOS stub only, discovered earlier this session), so the Firestore emulator can't boot here. Manifest tagging is verified correct by content inspection; full CI-like execution needs a machine with a real JDK.

# Schema-drift test (item 2) — found a REAL, currently-live bug, not a hypothetical

worker/scripts/test-schema-drift.ts (new) confirms, by reading the actual current code:
- `dealQualification` IS defined in the Gemini JSON schema (worker/src/postcall-schema.ts:180)
- `dealQualification` is NOT on the `PostCallAnalysis` TS interface at all (postcall-schema.ts:261+)
- `dealQualification` IS read downstream by web/domain/contact-service.js:589 (`analysis?.dealQualification`)
- `dealQualification` is NOT in normalizePostCallOutput's return object (worker/src/word-limits.ts:790-869) — silently dropped

This exactly matches the "five-file rule" bug docs/BUILD_ALIGNMENT.md documented as a known issue —
confirmed STILL UNFIXED on the current 2.1 branch. The new test-schema-drift.ts fails (red) right now
because of this real bug, not a test bug — verified by running it directly.

The fixture (postcall-scorecard.demo.snapshot.json) is a HAND-BUILT placeholder, not a live capture —
no GEMINI_API_KEY was available in this session. Clearly labeled in the fixture's own _note field and
the capture script's usage instructions. Should be replaced with a real capture ASAP.

# Firestore rules coverage (item 4)

Added: rules-tests/lifecycles.test.mjs, prepBriefs.test.mjs, postCalls.test.mjs,
scorecards.test.mjs (also covers scorecardLines + scoreOverrides append-only rule),
priceBooks.test.mjs (representative for priceBooks/addonPriceBooks/assumptionsBooks).
Updated run-all.mjs to auto-discover *.test.mjs instead of a hardcoded chain (now 9 files,
confirmed via readdirSync test).

VALIDATION LIMITATION: could not run these against the real Firestore emulator in this
sandbox — same Java-runtime issue discovered earlier in the session (macOS java stub only,
no real JDK). Only did `node --check` syntax validation on all 5 new files + run-all.mjs —
all clean. These need a full `npm test` run in rules-tests/ on a machine with a real JDK
(or in CI, where ubuntu-latest runners have Java preinstalled) before being trusted as
passing, not just syntactically valid.

# VPS deploy gate (item 5)

Added deploy/vps/Dockerfile.worker-test, modified deploy/vps/update.sh to insert a test
gate (worker + web, fast/free tier only) before the Docker rebuild, with SKIP_TEST_GATE=1
opt-out. Caught and fixed one real bug myself before it shipped: the web test-gate step
originally mounted web/ read-only then tried `npm ci` in place, which would fail (npm
needs write access) — fixed by copying to a writable path inside the container first,
which also avoids leaking Alpine-built native binaries (esbuild/playwright) back into the
host's web/node_modules.

VALIDATION LIMITATION: Docker isn't available in this sandbox at all — could not build or
run either test-gate image end-to-end. Verified `bash -n` syntax on update.sh (clean) and
confirmed every file path Dockerfile.worker-test references actually exists in the repo.
This needs a real Docker build + run on the actual VPS (or any machine with Docker) before
being trusted as working, not just plausible.

# dealQualification — resolved (2026-08-09)

Deeper trace showed this wasn't a live bug needing a passthrough fix: it was vestigial.
Pass 4 (worker/src/postcall/qualify.ts -> POST /api/postcall/qualify -> analysis.qualification)
already does MEDDPICC extraction properly and is fully wired end-to-end (client call in
web/postcall.js:4008, route in routes.ts:1662). contact-service.js's own comment already said
"legacy. prefer Pass 4 qualification" for the dealQualification fallback.

Chosen resolution: remove dealQualification from POSTCALL_SCHEMA entirely
(worker/src/postcall-schema.ts), rather than wire it up. Updated in lockstep:
- worker/src/postcall-schema.ts — field removed, comment left explaining why + pointing to Pass 4
- worker/testdata/schema-snapshots/postcall-scorecard.demo.snapshot.json — fixture updated to match
- worker/scripts/test-schema-drift.ts — expected-field list updated, comment added

Verified: test-schema-drift.ts now PASSES. Full worker unit suite re-run: 68/69 (only the
pre-existing, unrelated test-firebase-auth.mjs finding remained at that point).
`npx tsc --noEmit` shows no dangling type references to the removed field.

Left untouched (in scope for a future pass, not requested): web/domain/contact-service.js's
dealQualification fallback branch is now permanently dead code (safe — guarded by
`if (dq && typeof dq === "object")`) since the field can never be present again. Also left
docs/BUILD_ALIGNMENT.md's original finding text as historical record rather than editing it.

# test-firebase-auth.mjs — resolved (2026-08-09)

Two layers of drift, both because the file was orphaned and never ran:
1. Asserted `lookupUserForSession` lives in web/domain/seed-dev.js — it was moved to
   web/domain/user-resolve.js in commit 38b1380 ("dev-seed split"). Function and its
   authIndex-before-session-id ordering guarantee both confirmed still correct, just
   relocated. Fixed by pointing the test at the new file.
2. Asserted a literal cache-bust string "auth-fix-v3" on the firebase-config.js script tag
   in web/index.html — that mechanism no longer exists anywhere in the repo. Replaced by a
   dynamic AUTH_BUILD_ID/MODULE_BUILD export (web/firebase-config.js) applied to app.js's
   import at boot. Rewrote the assertion to check the mechanism structurally instead of a
   hardcoded version string, so it won't go stale on the next release the same way.

Verified: `npx tsx scripts/test-firebase-auth.mjs` passes standalone. Full worker unit
suite: 69/69 (100%).

# test-pipeline-view.mjs — DEFERRED, not fixed (user decision 2026-08-09)

Root cause traced fully: web/domain/user-resolve.js's resolveEffectiveOwnerId() returns
null for dummy-mode sessions (e.g. org director vipin.thomas@freshworks.com,
id usr_dummy_vipin_thomas_freshworks_com) because it always prefers Firebase-authIndex
resolution over the dummy id it already has, and that path structurally can't succeed
without a live `fb` helper (not available in local/dummy-store mode). This cascades:
resolveEffectiveOwnerId -> listLifecyclesForSession -> listAccountsForSession/
listDealsForSession all return empty for dummy-mode org directors/managers, so the
Pipeline view (and likely other scope-resolution-dependent views) shows nothing for them.

Likely fix (not applied): when isDummy is true AND no `fb` was provided, fall back to the
dummy `raw` id instead of null, rather than only falling back to `raw` when `!isDummy`.

NOT fixed — Tony is checking with the team that built this before changing shared
identity-resolution code (resolveEffectiveOwnerId is used well beyond pipeline-view).

# test-nextsteps-shape.mjs — resolved, real regression restored (2026-08-09)

Confirmed via git archaeology: stepsFromNextSteps() was added in commit 543949d
("Fix blank dashboard/coaching when nextSteps is an object" - a real production crash
fix for historical analyses with legacy object-shaped nextSteps: {seActions, aeActions}).
It was silently lost in a later commit c16bccd ("Apply V2 source snapshot and migrate to
portal domains") that appears to have reverted follow-ups.js/dashboard.js to a pre-fix
state - reintroducing the exact crash the original commit fixed. Confirmed dashboard.js
still had the unguarded .find() pattern at two call sites, plus an unguarded
missedOpportunities array access.

Restored: follow-ups.js's stepsFromNextSteps() export + normalizeSteps() wiring;
dashboard.js's two call sites + the missedOpportunities Array.isArray guard.
Verified: test-nextsteps-shape.mjs passes; full suite 106/117, no regressions.

# test-no-await-in-loop.mjs — resolved (2026-08-09)

Code-quality lint check (no await-in-loop in org-service.js/write-scope.js/dual-write.js/
user-resolve.js without a serial-ok: justification). 4 flagged sites, all genuinely
independent per-iteration lookups (team/user/contact fetches with no cross-iteration
dependency) - parallelized with Promise.all instead of suppressing with a comment:
- org-service.js: listSeEmailsForTeamIds (nested team+member loop), mapEmailToTeamName
- user-resolve.js: listTeamMemberEmails
- dual-write.js: contact-by-email lookup loop
Directly relevant to the segment-leader fix below, since listSeEmailsForTeamIds is now
hit by segment leaders too (not just org directors) via listVisibleSeEmails.
Verified: test-no-await-in-loop.mjs passes; full suite unaffected, no regressions.

# test-deal-motion-grace.mjs — resolved, test rewritten + real minor bug fixed (2026-08-09)

Test called a completely stale API: shouldUseWonNbDeal changed from options-object
{wonNbDeal, now} returning {useWonNb} to positional args (account, wonNbDeal, asOfMs)
returning null|dealId; resolveEngagementDealInput's field names changed
(wonNbDeal->wonNbDealInGrace, now->asOfMs); deal fixture shape changed
({wonAt,status}->{closedWonAt/metadata.closedWonAt, stage:"closed_won"}); NB_GRACE_DAYS
export removed (NB_GRACE_PERIOD_MS remains, still 90 days - business logic unchanged).
Rewrote the test against the real current API.

While rewriting, found a real (if low-severity) bug: resolveEngagementDealInput has two
branches returning source:"won_grace" - one for "still in grace, reusing the NB deal"
and one for "grace just expired, routing to expansion instead" - both used the same
label. Confirmed zero current callers branch on this specific string (grepped), so no
behavior change, but the labels were indistinguishable. Split into "won_grace" vs new
"won_grace_expired", added to the DealMotionSource typedef.

Verified: test-deal-motion-grace.mjs passes; no regressions.

# test-summaries-service.mjs — resolved, test fixture gap (2026-08-09)

buildSummariesContext reads from a derived `callSummaries` collection, not postCalls
directly. Production populates it via dual-write.js's buildCallSummaryFromPostCall() as
part of linkPostCallToLifecycle; this test wrote directly via store.upsertPostCall(),
bypassing that derivation entirely, so buildSummariesContext saw zero calls. Also: the
digest's callNotes field reads call.aiShortForm (a separately-generated short-form
summary), not analysis.callNotes directly. Fixed by having the test derive+persist
callSummaries rows itself (mirroring the real write path) and set aiShortForm to
simulate the summary-generation step. Verified: passes; no regressions.

# test-theme-score-suppression.mjs — resolved after deep trace (2026-08-09)

Real wiring bug confirmed and kept: renderQipSubParameter() never passed line.coachingNote
through to resolveSubParameterCoachText() at all (missing 7th arg) - dead code path.
Fixed the wiring (now a real fallback for themes/sub-params without curated content).

BUT: initially reordered priority to put lineCoachingNote before insightfulCoachTip's
bucketed tips, assuming those were generic filler. Traced actual runtime behavior with
temporary debug instrumentation and found: (1) coach/index.js's COACH_TIPS_BY_THEME is
hand-curated, high-quality per-theme/sub-parameter/score-bucket content, not filler;
(2) more importantly, coachTextForSubParameter (checked FIRST, unchanged) is satisfied via
an internally-generated coachOutput (buildCoachOutput) in the real render path, so it
ALREADY wins before either lineCoachingNote or insightfulCoachTip are ever reached in
practice. Reverted the reordering (no real evidence it was correct, and it wasn't even
the operative fix). Kept the wiring fix as a fallback-only improvement.

Rewrote the test assertion to check structurally (a real, non-generic coach line renders)
instead of matching hardcoded exact wording that assumed the old priority order.
Verified: passes; no regressions.

# test-call-tabs-render.mjs — resolved, REGRESSION FIXED (2026-08-09)
# *** CHANGES CUSTOMER-FACING EMAIL CONTENT — worth a human review ***

resolveMinutesViewModel (web/call-view.js) filtered minutes-of-meeting action items to
SE-owned only, in BOTH the structured path and the followUps fallback. Effect: the
customer-facing MoM recap email omitted every AE-owned and customer-owned next step —
including the customer's own commitments, arguably the most important thing to restate
in writing.

Evidence it's a regression, not intent (multiple independent sources agree):
1. shared/mom-email-draft.js OWNER_LABEL covers se/ae/customer and formatActionLine
   renders exactly "• Send trial link (AE, by Friday)" — unreachable under an SE-only filter.
2. call-view.js momOwnerChip renders .mom-owner--ae / .mom-owner--customer, and both are
   styled in call-view.css:1264/1269 — also unreachable.
3. TWO separate test cases in the file expect it: testEmailDraftFormatting (AE item in
   email) and testResolveFallsBackToFollowUps (customer-owned follow-up in actionItems).
4. Timeline: the AE assertion landed in e943701; the SE-only filter was added later in
   68383ec (Release 2.1.29). Test was orphaned, so the break went unnoticed.

Fix: removed SE-only filtering from the MoM/email path only. Deliberately LEFT the
SE-only filter on `pendingRows` (call-view.js:2213) — that's the SE's own pending-actions
list and is legitimately SE-scoped.
Verified: passes; no regressions.

# test-postcall-write-scope.mjs — resolved, DATA-INTEGRITY BUG FIXED (2026-08-09)
# *** Highest-impact fix of the session — affects Firestore RBAC on new accounts ***

upsertAccountFromPrep (web/domain/account-service.js) accepted input.orgId and
input.teamId and silently ignored BOTH — grep-confirmed they were never read anywhere in
the function. Its create branch stamped only name/domain/slug/metadata: no orgId, no
seTeam, no seTeamUserIds/seTeamTeamIds. Worse, the production caller
(engagement-entities.js — the shared prep+post-call CRM path) never passed orgId at all.

Impact: every account created through prep or post-call had orgId: null permanently.
Nothing backfills it — buildAccountScopeDenorm only propagates account.orgId, so null
stays null. Those denormalized fields (orgId, seTeamUserIds, seTeamTeamIds) are exactly
what firestore.rules reads for account membership checks (canReadAccountData ->
onAccountSeTeam / managerSharesSeTeam), so freshly created accounts landed without the
scope fields the rules depend on.

Corroborating evidence it's a bug, not intent: engagement-entities.js:180/194 already
writes `orgId || account?.orgId || null` for deals/lifecycles — i.e. the code expects
accounts to carry an orgId to fall back to.

Fix (both sides):
- account-service.js create branch: stamp orgId, seTeam (actor as primary),
  primarySeUserId, seTeamUserIds, seTeamTeamIds. Idempotent with the
  ensureSeTeamForPrepActor() call that follows — it early-returns when the actor is
  already seated (verified).
- engagement-entities.js: pass the already-resolved orgId/teamId through.

Verified: passes; no regressions — notable because this is the shared write path for
BOTH prep and post-call.

# test-postcall-render.mjs — resolved, stale test (2026-08-09)
Assertion expected the button "Override a score". That affordance was deliberately
replaced by "Dispute a score" (score-dispute-trigger -> Freshdesk POST /api/tickets) in
783b623 "Release 2.1.2: activities feed, disputes notify, Freshdesk tickets". Product
rename, not a regression. Updated the assertion. Verified: passes.

# test-user-menu.mjs — DEFERRED, needs a product decision (2026-08-09)

One assertion of ~50 fails: ["no profile settings in popup",
!html.includes('id="user-menu-profile"')]. index.html DOES still contain that button.

Root cause is a cross-branch inconsistency, not a simple regression:
- Commit 68383ec ("Release 2.1.29: org hierarchy, CRM parity, and contact dedupe")
  BOTH removed <button id="user-menu-profile"> from index.html AND added this test
  assertion — a coherent, deliberate change (de-duplicate: profile settings stays
  reachable via the nav item at index.html:219, data-view="profile", title="Settings").
- BUT 68383ec lives on refs/remotes/v2/2.1-org-hierarchy, a DIFFERENT branch. On 2.1
  (our base) the test assertion arrived but the index.html removal did not.

So the branches disagree about whether "Profile settings" belongs in the user popup.
Two valid resolutions, both UI-visible:
 (a) remove the popup item from index.html (adopt 2.1-org-hierarchy's intent), or
 (b) drop/relax the test assertion on 2.1 (keep the popup entry).
NOT fixed — this is a product/UX call and removing a menu entry users may rely on
shouldn't be guessed at. Profile IS reachable via the settings nav item either way.

# test-history-persistence.mjs — resolved, THREE stacked stale issues (2026-08-09)
Each masked the next (the file exits on first failure), so fixing one revealed another:
1. Title assertion `title === "Call A"`: titles are derived/structured now
   (resolveCallTitleFromRecord builds "{Account} · {Call type} - {headline}"), and the
   fixture was an un-normalized legacy blob. Made the fixture realistic (added
   callHeader, which is what the worker's normalizePostCallOutput actually emits) and
   matched on containment — the assertion's real purpose is record identity, not
   title formatting.
2. loginDummy() became async in e3ea859 (same "stage-2 dev-seed split" refactor that
   broke test-firebase-auth.mjs). Test called it synchronously, so no session was ever
   established. Added await.
3. Dummy auth now validates against a fixed roster (web/dummy-users.js); the fabricated
   se1@/se2@freshworks.com logins silently returned {ok:false}. Repointed at two real
   roster SEs (saketh.poruri@, balaji.ramkumar@).
Verified: passes.

# test-coaching-render.mjs — real coaching bug FIXED; one item deferred (2026-08-09)

*** REAL BUG: dashboard best/worst coaching theme was ALPHABETICAL, not score-based ***
rankDimensions (web/dashboard.js) sorted by `avgScore / maxScore`, but themeAverage()
stopped returning maxScore in QIP v2.1 (all grades share a 0-10 scale now). So the
comparator evaluated NaN - NaN for every pair; a NaN comparator leaves Array#sort order
untouched, and dimensions arrive alphabetically sorted — so worstDimension was simply the
last theme by NAME. Confirmed empirically: with cta at 4.9 (lowest) and objections at 7.0,
worstDimension came back "objections". This drives collectWeakestThemeReceipts, i.e. the
"your weakest theme" coaching receipts shown to SEs — so the theme being coached was
effectively arbitrary. Fixed to rank on avgScore, keeping maxScore normalisation only for
legacy rows that still carry it. This single fix resolved 4 of the 5 remaining failures
(weakest receipts, receipt quote, html receipts section, html evidence blocks).

Fixture also updated for the QIP v2.1 scoring model: profileAverage() now reads ONLY a
model-authored `overall` (0-10) instead of re-deriving a weighted composite from lines, so
the fixture needed `overall` values; and the per-type average renders on the 0-10 scale, so
the legacy ">73<" (weighted /100) expectation became a precise markup-anchored match on 7.

DEFERRED (needs a product decision): ["spine composite present"] still fails.
quality-score.js's spineComposite() is a no-arg stub returning a hardcoded
{score: null, themeCount: 0, callCount: 0, coverage: 0}, with `@deprecated v2.1` on the
adjacent function — yet dashboard.js:1073 still renders the "Shared themes (core four)"
UI note. So either the spine feature should be reimplemented, or the stub + dead UI +
this assertion should all be removed. Not guessing at that. This is the ONLY remaining
red test in web; it must be resolved before the VPS deploy gate is flipped from
SKIP_TEST_GATE opt-out to a hard block.

---

## Final state

- Worker: 69/69 unit tests passing.
- Web: 114/117 unit tests passing. The 3 remaining are the deliberate deferrals above
  (`test-pipeline-view.mjs`, `test-user-menu.mjs`, `test-coaching-render.mjs`'s spine
  assertion) — not unfinished work, product/architecture calls for the team.
