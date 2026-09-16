# 05 — Critical journey ledgers

The mandate asks for a write ledger and a read-back ledger for 18 journeys, with the
strongest acceptance check being: *complete the operation, close the tab, clear local
cache, open a fresh authenticated session, and reconstruct the result from
PostgreSQL-backed APIs alone.*

**That check could not be run for any journey, and the reason is structural rather than
incidental.** It is stated up front so nothing below reads as stronger than it is.

---

## Why the fresh-session check is blocked

Three independent blockers, each sufficient on its own:

1. **No `janus_app` staging credential** (B-07). The only credential available is the
   `postgres` superuser, which `postgres-pool.ts:49` *hard-rejects* — so the worker cannot
   be pointed at staging at all from here, and the runtime read path cannot be exercised
   against real data.
2. **No live authenticated session against staging.** Driving the real UI needs Google
   SSO; the local dev path works only with `web/firebase-config.local.js` removed, which
   puts the app in dummy-auth mode against a **local** database. A dummy session cannot
   read staging rows.
3. **Zoom, Gemini and Firebase Admin credentials are absent** on this machine
   (`GOOGLE_APPLICATION_CREDENTIALS` unset, no `ZOOM_ACCOUNT_ID`/`CLIENT_ID`/`CLIENT_SECRET`),
   so the journeys that acquire a transcript or generate analysis cannot complete end to
   end even locally.

What this means honestly: **I traced write paths in code and measured their durable
outcomes in aggregate on staging, but I did not complete a single journey from gesture to
fresh-session read-back.** Where a journey is marked `PARTIAL` below, the write path is
`CODE-PROVEN` and the durable state is `STAGING-VERIFIED` in aggregate; the round trip is
not proven.

---

## Journey status summary

| # | Journey | Status |
|---|---|---|
| 1 | sign-in and identity/session provisioning | **PARTIAL** |
| 2 | New Business SE pre-call | **PARTIAL** |
| 3 | Expansion SE pre-call | **RUNTIME-BLOCKED** |
| 4 | New Business SE post-call | **PARTIAL** |
| 5 | Expansion SE post-call | **PROVEN ABSENT** — no Expansion post-call exists in 345 rows (J-011, J-025) |
| 6 | manager/admin proxy post-call | **RUNTIME-BLOCKED** |
| 7 | Zoom transcript available | **RUNTIME-BLOCKED** (no Zoom credentials) |
| 8 | Zoom transcript processing/polling | **CODE-PROVEN only** |
| 9 | Zoom hard error / revoked OAuth | **TEST-REPRODUCED** (fixture 400) |
| 10 | re-analysis of the same call | **PARTIAL** |
| 11 | page refresh during analysis | **PROVEN LOSSY** — see §4 |
| 12 | two tabs processing the same call | **UNPROVEN** |
| 13 | retry after partial provider failure | **UNPROVEN** |
| 14 | account/deal/contact creation and linking | **PARTIAL** |
| 15 | scorecard and leaderboard appearance | **PROVEN BROKEN** — 82% of calls never get a scorecard (J-020) |
| 16 | weekly usage and zero-adopter reporting | **PROVEN BROKEN** — rollup has 2 rows (J-023) |
| 17 | recovery/import and replay | **PROVEN STOPPED** — outbox 236 pending (J-021) |
| 18 | hard refresh + second device read | **RUNTIME-BLOCKED** |

---

## 1. Post-call intake — the one journey traced at the gesture level

This is the only journey where I observed real browser behaviour, instrumented per
request. It covers the mandate's "capture request counts, dependency order, retries and
false-success sites" for the intake segment.

**Request ledger, one Analyse click, measured** (E-044, E-045):

| # | t | call site | endpoint | outcome |
|---|---|---|---|---|
| 1 | 2783ms | `runZoomPreResolve` | `POST /api/postcall/resolve` | warm-up, result discarded by design |
| 2 | 6233ms | `runZoomPreResolve` | `POST /api/postcall/resolve` | warm-up re-armed by a link edit |
| 3 | 7277ms | `resolveWithZoomPendingRetry` | `POST /api/postcall/resolve` | the submit |

**Invariant proven:** one gesture → at most one submit-path request, across five
scenarios including rapid double-click and a hard Zoom OAuth 400.

**Button state ledger** (E-046, E-047): before the fix `#analyze-call` was
`disabled=false, visible=true` at t=482ms with empty fields — an ~87ms window in which an
empty intake was submittable. After: disabled before it is ever visible.

**Where this journey stops being proven:** after `/resolve` returns, the pipeline requires
Gemini to generate, which needs credentials absent here. So the *durable* half of journey
4 is measured only in aggregate (§3).

---

## 2. Sign-in and identity provisioning — PARTIAL

Write path, `CODE-PROVEN`: Firebase ID token → `requireUser` (`auth.ts:81`) →
`resolveSqlSession` (`session-context.ts:239`) resolves Firebase UID → `user_identity` →
`app_user` → `org_unit.path`, with a 5s per-process cache.

Durable state, `STAGING-VERIFIED`: 37 `app_user` rows, all `active`. **16 (43%) have no
`org_unit_id`** (J-022), which is the field every org-scoped RLS policy matches on. For
those users `current_org_path()` returns NULL and org-scoped reads return nothing.

`user_usage_logins` has 172 rows, so login events *are* being captured — but
`user_usage_daily` has 2, so nothing aggregates them (J-023).

**Unproven:** whether a *new* user's first login provisions an `app_user` row correctly.
`RUN_LOG.md:111-114` recorded 25 of 46 unprovisioned; the roster now has rows, so
provisioning evidently happens — but the `org_unit_id` half does not.

---

## 3. Post-call durable outcome — measured in aggregate

Not a round trip, but the strongest durable evidence available:

| Artefact | Rows | Verdict |
|---|---|---|
| `activity` (type `call`) | 345 | consistent with `post_call` |
| `post_call` | 345 | 1:1 with call activities |
| `post_call.detail` populated | not individually sampled | `UNVERIFIED` |
| `scorecard` | 62 | **283 calls have none (82%)** — J-020 |
| `scorecard_line` | 3900, **0 orphans** | child integrity sound where the parent exists |
| `pipeline_state` | `analysis_done` on **345/345** | carries no information — J-012 |
| `ai_run` | 2816, **4 joinable to a call** | 0.14% attribution — J-019 |

**The false-success surface the mandate asks about is concrete here:** a user completes a
post-call, the UI shows it saved, `POST /api/history` returns 200, the Firestore blob is
written — and for four calls in five no scorecard is ever produced, while
`pipeline_state` reports `analysis_done`. Nothing in the response, the UI, or the state
model distinguishes the 62 complete calls from the 283 incomplete ones.

---

## 4. Journey 11 — page refresh during analysis is lossy, and this is CODE-PROVEN

`docs/astra-audit/01-system-architecture.md:244` describes `pipelineState` as a **module
global** whose loss on reload is "irrecoverable", and F-008 records that the browser is
the only job runner, with the transcript held in a module-level variable.

Nothing in this branch changed that. Combined with `post_call.pipeline_state` carrying a
single value for every row, there is **no durable resumable state**: a refresh mid-pipeline
loses the in-flight work, and the database cannot say which stage was reached.

That is the mechanism behind journeys 11, 12 and 13 all being unproven-or-broken: they all
depend on resumable state that does not exist.

---

## 5. Journey 17 — recovery and replay is stopped

`sync_outbox`: **236 pending, 51 completed** (J-021). `claim_outbox_batch` exists
(`06_phase6_outbox_integrations_pii.sql:140`) and `/api/internal/outbox/project` is
registered, but nothing schedules it, and `SQL_QA_VALIDATION.md:44-46` records that no
reaper exists for rows stranded in `processing`.

The backlog has grown from the 107 previously recorded, so this is not a historical
artefact — it is an active, widening divergence between the two primary stores.

---

## 6. What a future session must do to close this document

The blockers are specific and small:

1. **A `janus_app` staging credential** unblocks every read-back check. Without it, none
   of the 18 journeys can be completed as specified.
2. **A real authenticated session** (a human signing in through the UI once, as the
   mandate explicitly permits) unblocks journeys 1–6, 10, 14, 15, 18.
3. **Zoom S2S credentials** unblock 7 and 8.
4. Journeys 11, 12, 13 cannot be closed by credentials alone — they need durable
   resumable state to exist first, which is design work, not verification work.

Until then the honest summary is: **the write paths are traced, the aggregate durable
outcomes are measured and three of them are badly wrong, and not one journey has been
proven end to end.**
