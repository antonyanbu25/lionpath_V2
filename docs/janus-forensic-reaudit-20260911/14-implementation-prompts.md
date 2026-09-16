# 14 — Implementation prompts for the next session

Each prompt is independently executable. **Do not execute any of these in the session that
produced them** — audit-only mode. They are ordered by the dependency chain in
`13-remediation-roadmap.md`, and the ordering constraints are repeated inside each prompt
because they are the thing most likely to be lost.

---

## P-A1 — Read the deployed persistence mode and record the answer

**Findings:** J-028, and it reframes J-019, J-020, J-021, J-026 and the whole of `04`.
**Impact:** decides whether PostgreSQL is the system of record or a write-only log.
**Invariant to establish:** the deployed values of `PERSISTENCE_MODE`,
`PERSISTENCE_READ_MODE`, `HISTORY_BACKEND_MODE`, `HISTORY_FILE_DIR` and
`FIREBASE_AUTH_ENFORCED` are recorded in the repository, for every deployed target.

**Do:** read the Cloud Run service configuration for each deployed revision and the VPS
environment. Record the values in `docs/janus-forensic-reaudit-20260911/` alongside the
date and the revision id.

**Must remain unchanged:** do **not** change any of them. This is a read.
**Non-goals:** no code, no deploy.
**Stop and ask if:** the values differ between revisions, or `PERSISTENCE_READ_MODE` is
unset — both mean the answer is "Firestore is authoritative for reads", which is an
architectural decision, not a bug to fix unilaterally.
**Acceptance:** a file in the audit package stating, per target, what each variable is.

---

## P-A2 — Rotate three credentials

**Findings:** P1 §disclosure, J-016.
**Impact:** two Zoom recording passcodes and at least one database password are exposed.
**Do:**
1. Rotate the Zoom recording passcode present in 4 commits of git history
   (`12dbbc6`, `807f071`, `9cfd4bd`, `b31f2cd`). **Treat as urgent** — it was also printed
   into a session transcript.
2. Rotate the **second, different** passcode in `worker/scripts/test-zoom-share-media.ts:117`,
   then move that URL to an env var or sanitise it, and remove its `ACCEPTED` entry from
   `scripts/scan-secrets.mjs`.
3. Rotate the staging `postgres` password pasted in chat, and — separately — provision a
   `janus_app` credential so RLS can be verified as the mandate requires (B-07).

**Must remain unchanged:** do not rewrite git history. Deleting files does not remediate
an already-pushed secret; rotation is the remediation.
**Acceptance:** each credential demonstrably invalid; `node scripts/scan-secrets.mjs`
still exits 0 with a shorter `ACCEPTED` list.

---

## P-B1 — Schedule the four dormant mechanisms — **CODE DONE (P11); schedules still owed**

> **Correction.** This prompt and roadmap 1.1 both say the four "exist and are correct; each
> needs a Cloud Scheduler entry, not new code". That held for the projector, but **not** for
> two of the four:
>
> - `sync_outbox` had **no reader** but the projector itself, so a permanently failed row or
>   a stalled backlog was unobservable. Added `GET /api/internal/outbox/health`, which also
>   reports `enqueueActive` — without it a pending-backlog alert fires forever in `sql` mode,
>   because nothing enqueues and the backlog can neither drain nor grow.
> - The rollup existed only as a CLI and its own docstring said it was "meant to be run
>   manually ... not on a schedule". Added `POST /api/internal/usage/rollup`, reusing the
>   script's exported function so the two paths cannot drift.
> - **`redact_pii()` is deliberately left unwired.** Wiring it surfaced **J-036**: EXECUTE
>   was held by `PUBLIC` and `janus_app` despite 06 appearing to grant it only to
>   `janus_redactor`. Revoked in migration 39. It stays unscheduled because it is
>   irreversible and has no dry-run — a retention decision, not a wiring task.
>
> Remaining work is the `gcloud` calls, written out in [`docs/scheduled-jobs.md`](../scheduled-jobs.md).
> Gate: `worker/scripts/test-dormant-jobs.ts`.

## P-B1 (original text)

**Findings:** J-021, J-023, `11` §7. **Highest value per unit of effort in the roadmap.**
**Impact:** 236 pending outbox rows and growing; the usage rollup has 2 rows against 172
login events; PII retention is unenforced; `audit_log` is written and never read.
**Invariant:** every mechanism the system relies on is invoked by something.

**Do:** add scheduled invocations for
`POST /api/internal/outbox/project`, `worker/scripts/rollup-user-usage.mjs`, and
`redact_pii()`. Add a dead-letter reader/alert for `sync_outbox` rows at `status='failed'`.

**Note, and do not miss this:** the outbox **reaper already exists** — it is the first
statement of `claim_outbox_batch`, re-queuing rows stuck in `processing` for >10 minutes.
It only runs when the projector runs. **Scheduling the projector also restores crash
recovery**, so this one change closes two findings.

**Before scheduling the projector, check `PERSISTENCE_MODE`:** `enqueueOutbox` is only
called from `DualWriteRepository`, so in `sql` mode the queue is never written and the
projector has nothing to do. If P-A1 says `sql`, the 236 rows are a *historical* backlog
and draining them is a one-off, not a steady-state need.

**Tests:** a gate asserting `sync_outbox` pending does not exceed a threshold; a gate
asserting `user_usage_daily` has rows for the last complete day.
**Stop and ask if:** draining the 236-row backlog would write to Firestore in a way that
conflicts with P-A1's answer.

---

## P-B2 — Make `ai_run` attributable — **DONE (P9). The diagnosis below was wrong; kept for the record.**

> **Correction.** This prompt says "make the call id available at every `recordLlmUsage`
> site". The call id was **already** available and already passed — `postcall/*.ts` set it
> on the `LlmRequest` and `providers/index.ts` forwards `req.callId`. The real cause is an
> ordering constraint: `handleAnalyzeCall` runs every pass and writes **no** activity row,
> and `POST /api/history` creates `act_<callId>` only later. So the resolver was resolving
> against a row that did not exist yet, every time, and the 4 rows that did resolve are
> re-analyses of an already-saved call. `janus/tests/ai_run_insert.test.mjs` passes 15/15
> because it seeds the activity **first** — an ordering production never uses.
>
> Fixed by `38_ai_run_call_attribution.sql` (record the raw call id, resolve attribution at
> read time via `v_ai_run_attributed`) rather than a back-stamping trigger, because
> `18_ai_run_rls.sql` makes `ai_run` append-only on purpose. Gate:
> `worker/scripts/test-ai-run-attribution.ts`.
>
> The `user_id` half was a separate defect: `handleAnalyzeCall` called `requireUser` and
> **discarded the result**, then passed the body's `userId` through. Now stamped from the
> verified session (`stampVerifiedUsageIdentity`). Residual coverage is blocked on identity
> provisioning (J-029, roadmap 2.1), not plumbing.
>
> The 756 tokens-but-NULL-`cost_usd` rows are **historical**: there is one production insert
> path, it always computes cost, and `resolveModelRate` falls back to `DEFAULT_RATE` rather
> than returning null. Backfilling them is a hard stop pending approval.

## P-B2 (original text)

**Findings:** **J-019** (0.14% attribution), and it unblocks most of `09`.
**Impact:** 2816 rows, 16.7M input tokens, and no answer to "what did this call cost".
**Invariant:** every provider invocation is attributable to the verified user and the final
`activity`.

**Do:** populate `ai_run.activity_id` on insert. The resolution path already exists —
`ai-run.ts` resolves `act_${callId}` best-effort. Establish why it yields a value on only 4
of 2816 rows, and make the call id available at every `recordLlmUsage` site.
Also populate `user_id` from the verified session rather than leaving it at 16.5%, and fix
the 756 rows with tokens but NULL `cost_usd`.

**What must remain unchanged:** do not let a telemetry failure break the request —
`insertAiRun` correctly swallows and returns false today. Keep that.
**Tests:** fail if a completed post-call produces an `ai_run` row with a NULL
`activity_id`. Do **not** assert on the historical rows.
**Telemetry:** after this, per-call and per-account cost become queryable with no new
instrumentation — `latency_ms` and `retry_count` are already 100% populated.
**Non-goals:** no backfill of the 2812 existing orphans without separate approval.

---

## P-C1 — The concurrency and failure-injection suite

**Findings:** the largest unclaimed piece of this audit. §07.10.
**Impact:** no test anywhere exercises two writers, a retry after commit, or a partial
failure. Every concurrency conclusion in `07` is static analysis.
**Invariant:** each concurrency hazard identified in `07` either has a passing test or a
recorded, accepted risk.

**Do:** against a **disposable local PostgreSQL only** — the harness works today
(`worker/scripts/start-local-postgres.mjs` via `embedded-postgres`; 42 files apply from
zero, idempotent). Write tests for:

1. lost update on `user_kv.history` — two concurrent `POST /api/history` for one email
2. `upsertPostCall` racing a `upsertDetailItem` — does `detail` survive? (**J-026**)
3. two writers on one `public_id` via different idempotency keys
4. `registerId` remapping — prove the old `public_id` stops resolving (§07.3)
5. a retry after a timeout where the server already committed
6. `scorecard` header rewrite deleting themes mid-sequence
7. `replaceCallParticipants` with a duplicate person — does the SAVEPOINT discard all?
8. outbox claim under two concurrent projectors
9. the twelve unhandled unique constraints — assert each raises a *handled* error

**Must remain unchanged:** **never run these against staging.** The mandate forbids it and
several are destructive. Guard on a loopback host, as
`test-account-writable-session.ts` and `test-fallback-telemetry.ts` already do.
**Tests that fail before and pass after:** most will **fail on first write** — that is the
point. Record which hazards are real before fixing any.
**Stop and ask if:** a test proves data loss on a path currently believed safe.

---

## P-C2 — Provision identity, THEN fix motion

**Findings:** J-022, J-029, then **J-025**.
**Impact:** 9 post-calls provably mis-stamped; 112 unresolvable; Expansion SEs scored on a
32-credit New Business rubric instead of 27.

**THE ORDERING CONSTRAINT — do not invert it:**

> `resolve_se_motion_for_user()` returns **NULL** for the 112 post-calls whose owner has no
> `org_unit_id`. Fixing the motion write path **first** converts a silently-wrong value into
> a **loud failure for a third of traffic**. Provision identity first.

**Step 1 (must be first):** give `org_unit_id` to the 16 users lacking it and
`user_identity` rows to the 24 lacking them. `janus/scripts/provision-identity.mjs` exists.
Verify with: `SELECT count(*) FROM app_user WHERE org_unit_id IS NULL` → 0.

**Step 2:** change `post_call.se_motion` to be resolved **server-side** from
`resolve_se_motion_for_user(session.userId)` — the same call the `scorecard` path already
makes — and stamp `se_motion_source` as `resolved` / `override` / `defaulted` honestly.
Stop deriving motion from `seMotionFromPostCallDoc(doc)`; a client-supplied motion must not
be authority.

**Step 3:** add the **parity test** for the duplicated team-id constants
(`web/domain/se-motion.js` imports them; `worker/src/domain-model/se-motion.ts` hardcodes
the same eight literals). Follow the existing `test-qip-normalize-parity.mjs` pattern.

**Step 4 — separate approval required:** backfill the **9** correctable rows. Do **not**
touch the 112 until step 1 lands. Do **not** alter any row a user has since overridden.

**Must remain unchanged:** historical motion must not change merely because a profile
changed — motion is a stored snapshot, and that property is currently correct.
**Tests:** a configured Expansion owner produces an Expansion `post_call` **and** an
Expansion-rubric scorecard; a missing configuration is loudly distinguishable, never
silently New Business; client-supplied motion is ignored.

---

## P-C3 — Make `post_call.detail` a merge, not a replace

**Findings:** **J-026**, F-005/P2.
**Impact:** mechanism confirmed; 21 of 345 rows NULL; **15 of 62 scored calls have no
`detail`** despite having completed scoring.
**Depends on:** **D2** — which writer owns `detail`.

**Do:** either make `upsertPostCall` treat an absent `detail` as "leave unchanged"
(`COALESCE(EXCLUDED.detail, post_call.detail)`), or stop the history caller sending the
field at all. `upsertDetailItem` already demonstrates the correct single-statement
`jsonb_set` merge — copy that shape.

**Why a merge and not just a null-guard:** the impact is **order-dependent** (324 of 345
rows do have `detail`). A null-guard alone leaves last-writer-wins and just moves the race.

**Tests:** write `detail` items, then run the history path, then assert every item
survives. This will fail before the change.
**Non-goals:** no backfill of the 21 NULL rows without separate approval; they may be
legitimately detail-free.

---

## P-D1 — Convert the 16 `networkidle` e2e specs — **DONE, and the diagnosis was mostly wrong**

> **Correction.** The acceptance criterion below — "all 16 pass locally with
> `web/firebase-config.local.js` present" — is **backwards**. Present is the condition
> that BREAKS them.
>
> The specs sign in by injecting a session into localStorage and reloading, which only
> works in dummy-auth mode. `firebase-config.js` selects that mode by whether
> `firebase-config.local.js` is importable. With the file present, real Firebase auth
> resolves signed-out ~700ms into boot and discards the injected session. Measured
> `#app-shell` `hidden` timeline: `t=0 hidden`, `t=171ms NOT hidden`,
> `t=701ms hidden`. A `waitForSelector("#app-shell:not([hidden])")` lands inside that
> ~530ms window and PASSES, so each spec appeared to clear its own boot assertion; the
> next `page.click` then failed with "element is not visible", pointing at a nav item
> that was never the problem.
>
> Two clues said so before any change: **six of the 13 failing specs never call
> `networkidle` at all**, and `test-postcall-intake-invariants.mjs` — this prompt's own
> worked example, which deliberately avoids `networkidle` — was itself failing.
>
> Fixed with `web/scripts/lib/e2e-dummy-auth.mjs` (`forceDummyAuth` aborts the request
> for `firebase-config.local.js`, so the mode no longer depends on machine-local state).
>
> **J-015 is real but accounts for 4 specs, not 16**, and it is INTERMITTENT — it depends
> on whether the video request is still open, which is why `test-dashboard-seeded` passed
> once and then failed three times running. Converted in those four. The remaining 12
> `networkidle` call sites are capture/debug scripts, not tests.
>
> Result: **web 157/157 from a cold start**, with no worker API running and
> `firebase-config.local.js` present.

## P-D1 (original text)

**Findings:** **J-015**. Unblocks `05`'s journey coverage.
**Impact:** 16 specs cannot pass on any machine where the login background video loads.
**Root cause:** `web/index.html:90` renders `<video autoplay muted loop preload="auto">`,
which holds a media request open, so `waitUntil: "networkidle"` has no settling point.

**Do:** replace `networkidle` with `domcontentloaded` plus explicit element-state waits.
`web/scripts/test-postcall-intake-invariants.mjs` is the worked example and documents why.
**Must remain unchanged:** do not add arbitrary sleeps, and do not weaken assertions —
these tests failing was an environment artefact, not a signal to lower the bar.
**Acceptance:** all 16 pass locally with `web/firebase-config.local.js` present.

---

## P-D2 — Close the security areas `08` did not cover

**Findings:** `08` §7, plus the ~20 authenticated-but-unscoped routes in `08` §1.
**Priority order:**

1. **The unscoped routes** — re-verify each in source (they are DELEGATED, not verified).
   **`POST /api/fetch-transcript` is NOT SSRF — that claim is refuted.** Measured with a
   `fetch` spy: seven payloads (GCP metadata server, loopback PostgreSQL, the worker's own
   internal API, an arbitrary external host, `file://`, `zoom.us` as a domain *prefix*, and
   the userinfo `@` trick) were **all rejected with zero outbound requests**.
   `parseShareUrl`/`SHARE_URL_RE` require the host to be `zoom.us`/`zoomgov.com` **and** be
   followed immediately by `/rec/` or `/recording/` — and that `/rec/` anchor, not the host
   pattern, is what defeats `freshworks.zoom.us.evil.example.com`. The finding was reasoned
   from the handler, which does pass `body.recordingUrl` straight through, without checking
   what the callee does with it. Now locked in by
   `test-route-authorization.ts` §7, because the protection is load-bearing and invisible
   at the call site: loosen that regex and this route becomes the SSRF it was thought to be.
   `GET /api/contacts?email=` (contact-existence oracle) is **still unverified**.
2. **Prompt injection** from transcript content reaching model instructions. Untested, and
   the product's core input is customer call transcripts.
3. SQL-injection sweep, CORS/CSRF/clickjacking headers, XSS in the `innerHTML` render
   paths, upload/archive/path-traversal handling, OAuth state and token lifecycle.
4. The three staging-only RLS policies (`activity_admin_write`, `post_call_admin_write`,
   `pre_call_admin_write`) — declare them in a migration or remove them from staging. A
   grant that exists in no migration is invisible to review.

**Stop and ask before:** changing any RLS policy on staging (DDL, hard stop).

---

## P-E1 — Deletion groups G1–G8

**Findings:** `10`. **Deliberately last** — none of it changes behaviour.
**Order:** G3 → G1 → G2 → G7 → G4 → G5 → G6 → G8, each its own commit, suite between.
**Pull G2 forward if convenient:** `worker/src/postcall.ts` is a **diverged** duplicate
missing the `temperature: 0` determinism pin and all cost attribution, so leaving it invites
reviving the wrong copy.
**Two traps:** do **not** co-delete `web/lifecycle.css` with `lifecycle-view.js`; do **not**
delete `web/crayons-head.js` (version-drift anchor asserted by `test-dew-theme.mjs`).
**Also:** G1 must remove the `KNOWN_UNAPPLIED` entry in
`worker/scripts/test-ci-foundation.mjs` in the same commit, or that entry goes stale.
