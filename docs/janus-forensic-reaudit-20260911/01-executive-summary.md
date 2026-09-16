# 01 — Executive summary

**Is Janus correctly wired, safe, fast enough, and ready for wider use?**

**Correctly wired: no.** Safe: materially safer than at the start of this session, with
real gaps remaining. Fast enough: yes, on the evidence available — latency is not the
problem. Ready for wider use: **not until one question is answered and four dormant jobs
are switched on.**

---

## The finding that reframes everything

**PostgreSQL is write-only by default, and Firestore is read-authoritative.** (J-028)

Two defaults compose into it, and neither implies it alone:

| Setting | Default |
|---|---|
| `PERSISTENCE_MODE` | **`sql`** — writes go to PostgreSQL |
| `PERSISTENCE_READ_MODE` | **`firestore`** — reads come from Firestore |

`persistenceReadReady()` is true only for exactly `"pg"`, and every domain read handler
falls back to the Firestore repository when it is false. The `sync_outbox` projector that
would reconcile the two stores is populated **only** in `dual` mode and **is not running**
in any case — 236 pending rows, up from the 107 previously recorded.

So the two stores diverge by construction, in both modes, and nothing reconciles them.

This is why no inherited document is correct about which store is authoritative: one camp
was right about writes, the other about reads, and no document says both.

**It also explains findings that had no explanation:** 283 of 345 post-calls have no
scorecard, and 2812 of 2816 `ai_run` rows cannot be joined to a call — because the product
never reads either, so nobody noticed.

**The single highest-value action available is reading the deployed
`PERSISTENCE_READ_MODE`.** It takes one command and determines whether half the remediation
roadmap is aimed at data anyone consumes.

---

## Findings by severity

| Severity | Count | IDs |
|---|---|---|
| **CRITICAL** | **6** | J-001 (cross-tenant IDOR write), J-010 (1130 refused writes), J-011/J-025 (motion, with root cause), J-019 (0.14% cost attribution), J-020 (82% missing scorecards), J-028 (write-only PostgreSQL) |
| **HIGH** | **17** | J-002, J-003, J-004, J-005, J-007, J-008, J-012, J-014, J-016, J-021, J-022, J-024, J-026, J-029, J-036, **J-043, J-044** |
| **MEDIUM** | 4 | J-006, J-015, J-018, J-023, J-030 |
| **PROCESS** | 1 | J-009 (push blocked by corporate DLP) |

By evidence status: **9 `STAGING-VERIFIED`**, **8 `CODE-PROVEN`**, **5 `TEST-REPRODUCED`**,
**6 `FIXED-AND-VERIFIED`**, 3 `RUNTIME-BLOCKED`.

**Added after the audit closed**, while implementing P9 and P11:

- **J-019 is fixed, and the audit's diagnosis of it was wrong.** Attribution failed because
  the `activity` row does not exist yet when the LLM passes run — not because the call id
  was missing. Migration 38 resolves attribution at read time.
- **J-036 (new, HIGH, fixed):** `redact_pii()` — `SECURITY DEFINER`, owned by `postgres`,
  irreversible — was executable by `PUBLIC` and by `janus_app`, the role the web worker
  connects as. Migration 06 appears to restrict it to `janus_redactor`; `07_grants.sql`
  re-widens it afterwards. Revoked in migration 39.
- **J-021/J-023 are partly fixed.** The claim that all four dormant mechanisms "need a
  Cloud Scheduler entry, not new code" was wrong for two of them: an unread queue cannot be
  alerted on, and a CLI cannot be scheduled over HTTP.
- **J-031 and J-035 are fixed** (the history lost update and the participant-set wipe).
  **J-034 is not** — `id_registry` is 1:1 by construction, so a fix needs a migration and an
  identity decision; the remap is now logged instead of silent.
- **J-015 was mostly a misdiagnosis.** 11 of the 13 failing e2e specs failed because
  `firebase-config.local.js` was PRESENT, so real Firebase auth discarded the injected
  session ~700ms into boot. `networkidle` accounts for 4 specs and is intermittent. Web is
  now **157/157** from a cold start.
- **J-037: the SSRF finding is REFUTED.** `POST /api/fetch-transcript` rejected all seven
  SSRF payloads with zero outbound requests. `08` §7 had ranked it the top security gap.
- **J-043 (new, HIGH, fixed):** a 2026-09-11 UAT report's "401 on `/api/history`" had its
  mechanism confirmed but not its trigger. Found from code alone, no live session needed:
  `app.js`'s shared token-getter wiring silently dropped the `forceRefresh` argument
  `history.js`'s own 401-retry passes it, so the retry always re-sent the identical cached
  token — a no-op mechanism, wired into 7 other consumers besides `history.js` from the
  same one function.
- **J-044 (new, HIGH, fixed):** the same UAT report's "missed attendee" — a person confirmed
  on `postcall.js`'s confirm-step roster never resurfaced in `call-view.js`, which read only
  the LLM's own (sometimes incomplete) `analysis.callHeader.attendees`, with no reconciliation
  against the roster the user had already confirmed. Worst case: the auto-drafted
  Minutes-of-Meeting email greeted the wrong person by name. Fixed by additively unioning the
  confirmed roster into the LLM's list at every read site, never removing an existing entry.

---

## Is PostgreSQL-only behaviour proven?

**No — the opposite is proven.** PostgreSQL is not the only store, and by default it is not
even a read store. The as-built system has **four durable write targets** for application
data: PostgreSQL, Firestore, the `user_kv` blob (39 rows, actively serving the product's
history and tasks), and flat files on VPS.

Measured against the mandate's own settled decisions:

| Settled decision | Reality |
|---|---|
| PostgreSQL is the **only** authoritative application store | false — write-only by default |
| Firebase is **only** for authentication | false — Firestore holds `users.role/teamId/orgId`, the basis of **every authorization decision** |
| Firestore must not be a primary, fallback, mirror, recovery, analytics, history or hidden write target | it is currently **all seven** |
| localStorage must not be the sole durable source for any user-visible artefact | violated — score overrides live only in localStorage; `score_override` has **0 rows** |

None of this is a regression from this branch. It is the as-built state, and the gap between
it and the settled decisions is the true remaining size of the cutover.

---

## Is Expansion / New Business motion proven end to end?

**No — it is proven broken, and root-caused.**

- `post_call`: **345 / 345** are `new_business`, with `se_motion_source` **NULL on every
  row**.
- `scorecard`: **62 / 62** are `new_business`, all asserting `se_motion_source = 'resolved'`
  — a positive claim that motion *was* derived from canonical data.
- Two org units are configured `expansion`.

**Root cause (J-025):** motion is computed in the **browser** against a hardcoded set of
five team ids, sent in the payload, and read straight back out of the client document by
the server. `org_unit.default_se_motion` is never consulted on the `post_call` path, even
though the schema ships `resolve_se_motion_for_user()` for exactly this and the `scorecard`
path already calls it.

Running the database's own resolver read-only shows it already returns the right answer:
`team_akshita` (6 calls), `team_varun` (2) and `team_mary` (1) all resolve to **expansion**
and are all stored `new_business`. **Nine mis-stamped rows — independently reproducing the
exact figure the mandate cited as a historical lead.**

Business impact: an Expansion SE is scored on a 32-credit New Business rubric instead of 27.
**A scoring-fairness defect, not a data-hygiene one.** The scorecard side is worse than the
post_call side: a NULL provenance is recoverable, a false `'resolved'` is not.

---

## The five highest-risk remaining issues

1. **`PERSISTENCE_READ_MODE` is probably `firestore`** (J-028). Everything else is judged
   against the wrong baseline until this is read.
2. **Motion is wrong for Expansion SEs** (J-011/J-025). Scoring fairness, nine provable
   rows, 112 more unresolvable until identity is provisioned.
3. **1015 lost writes and still accruing** (J-008/J-010). The fix is in this branch and
   undeployed; `sql_fallback_log` grew 1280 → 1341 during this session.
4. **82% of post-calls have no scorecard, invisibly** (J-020 + J-012). `pipeline_state`
   reads `analysis_done` on all 345 rows, so the state model reports the failure as success.
5. **Four mechanisms are built, correct, and invoked by nothing** (J-021, J-023) — outbox
   projector, usage rollup, PII redaction, audit-log reader. Each needs a scheduler entry,
   not code. **The cheapest fix on the board, and it closes four findings.**

---

## What this session fixed, with tests

Ten commits, each with a failing-before / passing-after demonstration:

| Fix | Verification |
|---|---|
| **J-010** — the predicate ran with a NULL user; **60/60 denials** measured pre-fix | 5-assertion gate |
| **J-014** — submit button enabled-and-visible for ~87ms with empty fields | first-frame rAF trace, reverting re-fails it |
| **Phase 2** — the "triple resolve" root-caused as two warm-ups + one submit; invariant holds across 5 scenarios | 10-assertion request-count gate |
| **P1** — five credential files purged after proving them dead; CI secret scanner added | 5 blocking findings → 0 |
| **P4** — four authorization holes closed, write scope narrowed to owner-or-admin, 404 not 403 | 20-assertion matrix |
| **P5** — 7 silent skips instrumented, a stack-trace leak removed, correlation id and owner added | 18-assertion gate |
| **P10** — ten unguarded provider calls bounded; 31 pass names classified | 21-assertion gate against a real hung socket |
| **P15** — 13 orphan tests registered, e2e no longer suppressed by unit failures, PostgreSQL in CI | `ai_run_insert` 13/15 → **15/15** |
| **J-004 / J-017** — schema drift closed; a latent non-idempotency the drift was hiding, fixed | 42 files, from zero, drift=none |

Bundle byte-identical at 373.4 KB. Worker 100/103 and web 140/140, both up by exactly the
newly-registered tests; the three worker failures are the same environmental ones present
at baseline.

---

## Where I was wrong

Recorded because an audit that only corrects other people's claims is not trustworthy:

- I called J-010 non-deterministic. It is deterministic — **60/60** denials. What varies is
  only whether a separately-positioned column sees the setter.
- I attributed the e2e failures to a live Firebase socket. Wrong: a **looping background
  video** holds a media request open, so `networkidle` never settles (J-015).
- I listed per-pass latency as blocked. It was not — `ai_run.latency_ms` is 100% populated,
  and §1a of `09` now reports real measurements.
- I wrote a manifest reason claiming `worker/src/history-pg.ts` "does not exist". It does,
  and is imported twice (J-027). I took the claim from the test's own stale docstring
  without checking the filesystem — in a document about other people's stale claims.
- I printed a Zoom passcode into the session transcript through an under-specified
  redaction pattern. It was already in git history, so the rotation requirement is
  unchanged, but treat it as urgent rather than routine.
- A delegated inventory concluded every `POST /api/history` nulls `post_call.detail`.
  Staging refutes that — `detail` is present on 324 of 345 rows. The mechanism is real; the
  claim was too strong, and the distinction changes the fix from a null-guard to a merge.

---

## What this audit did not cover

Stated so the boundary is explicit rather than implied:

- **Concurrency and failure-injection testing did not run.** The disposable-PostgreSQL
  harness works; the tests were never written. This is the largest unclaimed piece.
- **Not one of the 18 critical journeys was proven end to end.** No `janus_app` credential,
  no live authenticated session, no Zoom credentials.
- **No RLS claim about staging** meets the mandate's bar — the only credential available was
  the superuser the mandate says is insufficient. All positive RLS evidence is from the
  local cluster.
- **Cloud Run configuration, IAM, logs and probes** are unread — no `gcloud`.
- **Firestore security rules** unverified — no JDK for the emulator.
- **Security areas untouched:** SQL-injection sweep, CORS/CSRF/XSS, upload handling, OAuth
  lifecycle, and **prompt injection from transcript content** — the last being a real gap
  for a product whose core input is customer call transcripts.
