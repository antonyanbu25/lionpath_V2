# 13 — Remediation roadmap

Ordered by dependency, not by severity. Several of the worst findings **must not be fixed
first**, because fixing them in isolation converts a silent wrong answer into a loud
outage. Those ordering constraints are the most important content in this document.

---

## Phase 0 — Decisions only. No code. Blocks almost everything.

| # | Decision owed | Why it blocks |
|---|---|---|
| **D1** | **Read the deployed `PERSISTENCE_READ_MODE` and `PERSISTENCE_MODE`, then decide the target.** | **J-028.** If read mode is `firestore`, PostgreSQL is a write-only log and roughly half this roadmap is aimed at data nobody reads. Every priority below shifts depending on the answer. One `gcloud run services describe` settles it |
| **D2** | Which store is authoritative for `POST /api/history`? | **B-08.** The 200 contract and P5's "a 2xx must not imply a commit" are incompatible until this is answered. Decides whether the blob is a projection or the truth |
| **D3** | Apply migration 37 to staging? | **B-09.** Additive and idempotent, verified locally from zero and on re-apply. **Until it lands, P5's telemetry silently fails on staging** — so this gates deploying the P5 work |
| **D4** | Rotate three credentials | Two Zoom recording passcodes (one of which I printed into the session transcript) and at least one database password. Cannot be done from here |
| **D5** | Authorise the push, or allowlist the destination | **B-06.** `.git/hooks/pre-push` blocks it and POSTs a violation webhook. Ten commits are sitting locally |
| **D7** | **Translate the client deal vocabulary to SQL** — `paused`, `archived`, `closed_won_grace` → which `(stage, status)` pair? | New, from 1.6. Only `active` appears in both vocabularies. Writes are now refused with a 422 rather than aborting the transaction, so nothing is silently lost — but those deals do not reach PostgreSQL until this is answered. Do **not** default anything to `lost`: `redact_pii()` destroys analysis for lost deals older than 12 months |
| **D6** | Is a leaderboard over **13% of calls** acceptable? | J-024. 46 of 345 calls are ranked. Either surface the coverage or change eligibility — both are product calls |

---

## Phase 1 — Stop the bleeding. Small, independent, no ordering constraints.

| # | Item | Finding | Why now |
|---|---|---|---|
| 1.1 | ~~Schedule the four built-but-never-invoked mechanisms~~ — **CODE DONE (P11), schedules still owed** | J-021, J-023, **J-036** | **The framing "each needs a Cloud Scheduler entry, not new code" was wrong for two of the four.** `sync_outbox` had no reader but the projector itself, so a dead letter or a stalled backlog was unobservable — you cannot alert on a queue nothing reads, and the reaper lives *inside* the projector so a stopped projector cannot report itself. The rollup existed only as a CLI, and its own docstring said "not on a schedule". Added `GET /api/internal/outbox/health` and `POST /api/internal/usage/rollup`. **`redact_pii()` is deliberately NOT scheduled** — see 1.1b. Remaining: create the schedules, per [`docs/scheduled-jobs.md`](../scheduled-jobs.md) |
| **1.1b** | **Decide PII retention before scheduling `redact_pii()`** | **J-036** | New. Migration 39 revokes the `PUBLIC`/`janus_app` EXECUTE grant that made it reachable from the web role. It remains unscheduled on purpose: it is irreversible, has no dry-run, and returns only a count. Turning it on is a retention decision with a legal dimension, not a wiring task. Needs an owner and a `janus_redactor` credential |
| 1.2 | ~~Add `activity_id` to the `ai_run` insert~~ — **DONE (P9)** | **J-019** | **"One field" was the wrong diagnosis.** The call id was already passed; the *activity row does not exist yet* when the passes run, because `handleAnalyzeCall` writes no activity and `POST /api/history` creates it later. Migration 38 records the raw call id and resolves attribution at read time through `v_ai_run_attributed`. Also fixed: `handleAnalyzeCall` discarded `requireUser`'s result and trusted a body-supplied `userId` — an attribution-spoofing hole and most of the 16.5% |
| 1.3 | Deploy the branch's P4 auth fixes | J-001/2/3 | Already written and tested; they are only unshipped because of D5 |
| 1.4 | ~~Convert the 16 `networkidle` e2e specs~~ — **DONE, wrong diagnosis** | **J-015** | The cause was not `networkidle` for 11 of the 13 failures: `firebase-config.local.js` being PRESENT made real Firebase auth discard the injected session ~700ms into boot. J-015 is real for **4** specs and is intermittent. Web is now **157/157** from a cold start. See the correction in `14` |
| 1.5 | ~~Add the motion parity test~~ — **DONE** | §10.3.2 | `web/scripts/test-se-motion-parity.mjs`. The duplication is **wider than §10.3.2 said** — not just the eight team ids but the NB/expansion bucket membership, `SE_MOTION_LABELS`, the segment→motion mapping and its fallback, the post-call precedence chain, and the `asRecord`/`nestedRecord` helpers. The two sources **agree today**, so this prevents a future defect. Differential, not expectational, so 2.2 can change the mapping as long as it changes in both places. **Found in passing:** `canonicalizeSeMotion` is a third copy, and the same `team_*` literals appear again in `21_identity_relationships.sql` and `provision-identity.mjs` — a fourth and fifth copy in the data layer, which matters for Phase 2 |
| 1.6 | ~~Fix `deal.status` enum violations~~ — **VALIDATED, translation still owed** | §04 hunt 10 | Measured: worse than a 500. `22P02` on the enum then **`25P02` on every sibling statement** — one bad status takes down every other write in the same transaction, and a `catch` cannot recover because the connection is unusable until rollback. `assertDealStatus` now refuses it in JS with a 422 before SQL sees it, so the transaction survives. **Not mapped on purpose:** `redact_pii()` irreversibly NULLs analysis/detail for `status='lost'` deals >12 months, so mis-mapping to `lost` would destroy call analysis. `chk_deal_stage_status` also ties stage to status, so the translation owed spans **both** columns — there is no stage for `paused`/`archived`/`closed_won_grace` either. **New decision owed (D7)** |

---

## Phase 2 — The ordering trap. Identity before motion.

**This is the part most likely to be got wrong.**

| # | Item | Finding | Constraint |
|---|---|---|---|
| **2.1** | **Provision `org_unit_id` for the 16 users who lack it, and `user_identity` for the 24 who lack it** | J-022, J-029 | **MUST come first** |
| 2.2 | Resolve `post_call.se_motion` server-side from `resolve_se_motion_for_user()`, and stamp `se_motion_source` honestly | **J-025** | **Depends on 2.1** |
| 2.3 | Decide and execute a motion backfill for the 9 provably mis-stamped rows | J-025 | Depends on 2.2, and needs separate approval — existing rows must not be altered without it |

**Why the order is counter-intuitive.** Fixing the write path first looks obviously right.
But `resolve_se_motion_for_user()` returns **NULL** for the 112 post-calls whose owner has
no `org_unit_id`. So a motion fix shipped before 2.1 converts a *silently wrong* value
into a *loud failure* for a third of traffic. Provisioning identity first makes the resolver
able to answer; only then is it safe to trust it.

The same trap applies to 2.3: the 9 mis-stamped rows are correctable, the 112 unresolvable
ones are not until 2.1 lands.

---

## Phase 3 — Durability and truthfulness. Needs D1 and D2.

| # | Item | Finding | Depends on |
|---|---|---|---|
| 3.1 | Make `post_call.detail` a **merge**, not a replace | **J-026** | D2 — decides which writer owns `detail`. `upsertDetailItem` already demonstrates the correct single-statement `jsonb_set` shape |
| 3.2 | Make `pipeline_state` derived from real artefact presence, and monotonic | J-012 | D1. Until then it is one value on 345/345 rows and nothing can detect the 283 incomplete calls |
| 3.3 | Investigate the 283 missing scorecards | **J-020** | D1 — if reads come from Firestore, the missing PG scorecard may be a *projection* failure rather than a scoring failure, and the fix is entirely different |
| 3.4 | ~~Test each of the twelve constraints~~ — **DONE (J-041)** | §07.3, H9 | **7 of 12 were already absorbed** — §3 grepped `ON CONFLICT` targets without reading the surrounding statement. **And its implied one-line fix is impossible:** PostgreSQL allows one `ON CONFLICT` target per INSERT and each statement already spends it on `(public_id)`. The 5 reachable ones are fixed with pre-emptive `FOR UPDATE`/extra `existing` predicates/demote-first. `post_call.activity_id` is reachable in **two sequential writes**, not just under concurrency. Two NEW reachable cases (rename onto a taken slug/email) left open as identity decisions. **Residue:** fixed on the sequential path only — H3 stays `HAZARD`. Surfaced **J-042**, a silent wrong-row update that §3's method could not find |
| 3.5 | **2 of 5 DONE** — ARR overrides and contact events | §07.3 | The `ON CONFLICT (public_id) DO NOTHING` guards were already correct; the **caller** minted `aov_${dealId}_${Date.now()}`, so there was never a conflict to do nothing about. Ids now derive from content plus a 5-minute window (`deterministicAppendId`), so a retry dedupes but a genuine later repeat still appends. **Remaining 3 need different designs:** `POST /api/tickets` and `POST /api/disputes/notify` have external side effects (Freshdesk, email) and need a dedupe record written *before* the call out; `POST /api/deals` uses a Firestore `.add()` auto-id, and making that idempotent would entrench a write path the settled decisions say should not exist — the fix there is the cutover |
| 3.6 | ~~Add a graceful-shutdown handler~~ — **DONE** | §07.6 | 8s budget, 2s under Cloud Run's 10s. **§07.6's "ZERO SIGTERM handlers anywhere" is overstated** (`start-local-postgres.mjs` has them; dev tooling, so the substance holds for the request path). **And the implied fix was insufficient:** `server.close()` does not resolve on an *idle* keep-alive socket, so a first version ran the full drain and force-closed a connection that had finished in under a second — correct-looking code that never drained. Surfaced a pre-existing hazard too: EPIPE on the log pipe kept the `uncaughtException` handler logging down a broken pipe forever (two orphans at 100% CPU) |

---

## Phase 4 — Close the audit's own gaps.

| # | Item | Why it is here, not earlier |
|---|---|---|
| 4.1 | ~~Write the concurrency and failure-injection suite~~ — **DONE (P-C1)** | `worker/scripts/test-concurrency-hazards.ts`. Nine hazards exercised: **6 measured HAZARD, 3 SAFE**. Characterisation, not pass/fail — the suite fails on divergence in either direction, so a fix must flip its `EXPECTED` entry in the same commit. **The six hazards are NOT fixed** — see 4.1b |
| **4.1b** | Fix the confirmed hazards — **H1 and H7 DONE; H2, H3, H4, H6 open** | **H1** (J-031) fixed: `saveHistoryEntry` now prefers an atomic single-statement upsert in the PG backend. **H7** (J-035) fixed: participant dedup moved into `add`, keyed on the resolved internal id. **H6** was SKIPped and is now MEASURED (themes 1→0) — but its `DELETE` is deliberate and the browser depends on it (`types.ts:233-239`); the defect is that clear-then-append is not atomic, which is P3. **H4** (J-034) left open on purpose: `id_registry` is 1:1 by construction (`uq_id_registry_internal`), so an alias needs a migration, and choosing between orphaning the old id and rejecting the new one is an identity decision — it now LOGS the remap instead of being silent. **H2**/**H3** are P2/P3 and out of scope |
| 4.2 | Complete the 18 journey ledgers with a real authenticated session | Needs a `janus_app` credential and one human sign-in. Everything else is ready |
| 4.3 | Re-measure the three F-029/F-018 performance findings | Needs 4.2 |
| 4.4 | Audit what `08` did not: SQL-injection sweep, CORS/CSRF/XSS, upload handling, OAuth lifecycle, **prompt injection from transcript content** | Out of scope for a correctness-led audit. Prompt injection is the notable one for a product whose core input is customer call transcripts |
| 4.5 | ~~Re-measure the 2358ms handshake~~ — **DONE, and deflated (J-040)** | **2358ms is not reproducible**: median cold connect is 442ms over 20 samples, ~7.5x TCP rather than ~36x. It IS per-connection, but a warm pool pays **1.04x TCP** — so the exposure is connection CHURN, not steady-state auth latency, and this was not "the likeliest bottleneck". Absolute numbers do not transfer: `SELECT 1` ≈ TCP ≈ one RTT from this host, so they measure distance to the instance. **Auth Proxy half NOT done** — not installed here; still the right next experiment, and a security requirement regardless |

---

## Phase 5 — Cleanup. Deliberately last.

~~Deletion groups G1–G8~~ — **ALL EIGHT DONE (P-E1).** 26 files, 1749 lines removed, one
commit per group in the order given (G3 → G1 → G2 → G7 → G4 → G5 → G6 → G8), suite run
between each. Both documented traps held (`lifecycle.css` and `crayons-head.js` survive)
and a **third, undocumented one** surfaced: G6 broke `test-dew-theme.mjs`, which asserted
on `<fw-skeleton>` in `index.html` where the deleted cards held the only static instances —
the component is live in `call-view.js`, so the assertion was redirected rather than
dropped. See §6 of the inventory.

**Two traps, repeated because they are easy to hit:** do not co-delete `web/lifecycle.css`
with `lifecycle-view.js`; do not delete `web/crayons-head.js` (it is a version-drift anchor
asserted by a test).

**Last, not first, on purpose.** None of it changes behaviour, and every deletion is a
diff reviewers must read during a period when the real changes above need that attention.
The one exception worth pulling forward is **G2** (`worker/src/postcall.ts`), because it is
a *diverged* duplicate — missing the `temperature: 0` determinism pin and all cost
attribution — so leaving it is a standing invitation to revive the wrong copy.

---

## What I would do in the first day

1. `gcloud run services describe` → read `PERSISTENCE_READ_MODE`. **(D1 — 5 minutes, reframes everything.)**
2. Rotate the three credentials. **(D4 — one is in a session transcript.)**
3. ~~Schedule the four dormant jobs~~ → **create the three schedules** in
   [`docs/scheduled-jobs.md`](../scheduled-jobs.md). The code landed in P11; only the
   `gcloud` calls remain, and the projector one is conditional on D1's answer.
   **(1.1 — and read 1.1b before touching `redact_pii()`.)**
4. ~~Add `activity_id` to the `ai_run` insert~~ — **done (P9)**, but it needed a migration,
   not a field. Apply **38** with 37.
5. Apply migrations **37, 38 and 39** to staging, then deploy the branch.
   **(D3 + D5 — P5's telemetry is inert without 37, P9's attribution without 38, and 39 is
   the J-036 revoke.)**

That sequence closes or de-risks J-019, J-021, J-023, J-036, J-008 and the P4 holes, and it
answers the one question that determines whether the rest of this roadmap is aimed at the
right target.

**What is still open after it:** the six concurrency hazards (4.1b), the Phase 2 identity →
motion chain, Phase 3's durability items, the 13 `networkidle` e2e specs, the security areas
`08` did not cover, and Phase 5 cleanup. The database prompts P2, P3, P7 and P8 were
re-verified as STILL-OPEN and are **not** implemented.
