# 08 — Security and privacy

Two evidence classes are kept separate throughout:

- **VERIFIED BY ME** — I read the source or ran the query myself; carries an evidence ID.
- **DELEGATED** — located by a read-only subagent inventory and **not** independently
  re-read. Per the mandate's operating protocol, a delegated summary is not evidence on
  its own. Treated as a lead requiring confirmation before action.

I personally verified the four items that were changed, plus everything in §3–§6.

---

## 1. Route authorization matrix

`AUTHN` = authentication present. `AUTHZ` = authorization beyond authentication.

### Fixed this session (all VERIFIED BY ME, before and after)

| Route | Was | Now | Evidence |
|---|---|---|---|
| `POST /api/calls/:id/offload-payload` | authenticated, context **discarded**, call never loaded → any signed-in user could overwrite **any** call's payload | loads the row, 404s if absent, `assertCanWriteResource` (owner-or-admin) | E-026, E-059 |
| `GET /api/feedback?global=1` | returned **before** the only auth call → unauthenticated read of every user's feedback incl. emails | auth first, then `ctx.role === "admin"` | E-027, E-060 |
| `POST /api/search/rag` | **no auth call at all** | `requireUser` + per-request cost ceilings | E-028, E-060 |
| `POST /api/read-models/schedule` | authenticated, no ownership check on the referenced call | loads the row, owner-or-admin | verified in source |

### Deliberately unauthenticated (VERIFIED BY ME)

| Route | Justification | Residual risk |
|---|---|---|
| `GET /api/health`, `/health/live`, `/health/ready` | probes must not require credentials. Detail is gated: `ctx.role === "admin"` at `routes/health.ts:122` | none material |
| `GET /api/config` | `routes.ts:152` | **discloses provider and model names, and which API keys are set as booleans** (`routes.ts:188-192`). Also rate-limit-exempt (`rate-limit.ts:135`). Low severity, non-zero: it tells an unauthenticated caller which integrations are configured |
| `GET /api/zoom/status` | `routes.ts:128`, rate-limit-exempt (`rate-limit.ts:136`) | discloses whether Zoom is configured |

### Internal cron routes (VERIFIED BY ME)

Six routes under `/api/internal/*` authenticate with a shared secret via
`verifyInternalCronAuth` (`routes/internal-batch.ts:57`), which **returns false when
`INTERNAL_CRON_SECRET` is unset** (`:58-59`) — fail-closed. Correct. Whether the secret is
actually set in the deployment is `RUNTIME-BLOCKED` (B-04); if unset, these 401 rather
than open up, which is the safe failure.

### Authenticated but unscoped — DELEGATED, not re-verified

The route inventory flagged these as authenticating without any resource or tenant check.
**I did not re-read each one.** They are the highest-value follow-up in this document:

`GET /api/accounts`, `GET /api/accounts/:id`, `GET /api/accounts/:id/calls`,
`GET /api/accounts/:id/contacts`, `GET /api/contacts?email=`,
`GET /api/deals/:id/calls`, `GET /api/read-models/:collection/:id`,
`GET /api/org/structure`, `POST /api/product-signal/cluster` (takes `orgId` from the
body, presence-checked only), `POST /api/postcall/summaries`,
`POST /api/fetch-transcript` (fetches a caller-supplied URL → **SSRF candidate**),
`POST /api/disputes/notify` (emails a caller-chosen recipient), `POST /api/tickets`,
and the ~20 post-call/prep pass routes that call `requireUser` and nothing else.

Two deserve specific attention when confirmed:

- **`POST /api/fetch-transcript`** — an authenticated user supplying an arbitrary URL that
  the server fetches is textbook SSRF. On Cloud Run that reaches the metadata server
  unless egress is restricted.
- **`GET /api/contacts?email=`** — lookup by arbitrary email with no scope check would
  expose whether any given person is a contact, and their details.

Neither was changed: both are outside P4's four named targets, and P4's scope was
explicitly the four. They belong in the remediation roadmap.

---

## 2. RLS adversarial results

The mandate asks for an adversarial matrix across eight principals. What I could actually
run, and what I could not:

| Principal | Status |
|---|---|
| unauthenticated | **VERIFIED** — `current_org_path()` is fail-closed (`08_rls_hardening.sql:18`); reading `post_call` with no session context returned **0 rows** on staging even as `postgres`, because `FORCE ROW LEVEL SECURITY` applies and Cloud SQL's `postgres` is not a true superuser |
| ordinary SE | **VERIFIED on the local cluster** — `janus_app` with a session context sees only its own rows (`rls_fails_closed.test.mjs`, 5 cases, passing) |
| manager within subtree | **VERIFIED at the predicate layer** — `canReadResource` grants same-team; 20-assertion matrix in `test-route-authorization.ts` |
| manager outside subtree | **VERIFIED** — denied for both read and write |
| admin / director | **VERIFIED** — `is_admin()` grants; `assertDirectorOnly` additionally checks `org.directorId` |
| two users in different org paths | **VERIFIED** — denied both directions |
| unknown / deleted user | **PARTIAL** — `resolveSqlSession` returns null for a user with no `app_user` row, and callers treat that as "no SQL session". Not adversarially tested against a *deleted* user |
| proxy action, actor ≠ owner | **`RUNTIME-BLOCKED`** — needs a live manager session; no `janus_app` staging credential (B-07) and no browser proxy flow available |

**The central gap: no RLS claim about *staging* meets the mandate's bar.** The only staging
credential available was `postgres`, which the mandate explicitly says is insufficient
("RLS and grants must operate as `janus_app`, not only as a superuser"). All positive RLS
evidence here comes from the local disposable cluster.

**Two staging-only RLS policies exist that the repo does not declare** (J-004):
`activity_admin_write`, `post_call_admin_write`, `pre_call_admin_write`, each
`FOR ALL TO public USING is_admin() WITH CHECK is_admin()`. They grant admin write on the
three core call tables, were applied by hand, and are **in no migration** — so a fresh
environment behaves differently, and nobody reviewing the repo would know they exist.

---

## 3. Secrets

| Item | Status |
|---|---|
| Five `debug-zoom*.mjs` with a real Zoom recording URL + plaintext passcode | **deleted** from the working tree after proving them dead. **Literal remains in 4 commits** (`12dbbc6`, `807f071`, `9cfd4bd`, `b31f2cd`) — history not rewritten, per instruction |
| A **second** real Zoom passcode, 32 chars, in `worker/scripts/test-zoom-share-media.ts:117` | **NOT deleted** — manifest-registered live test; P1 forbids deleting legitimate Zoom tooling. Tracked in the scanner's `ACCEPTED` list so it prints every run (J-016) |
| `worker/.dev.vars`, `web/firebase-config.local.js`, `deploy/vps/.env` | **not tracked** — verified |
| Firebase Web API key in `web/firebase-config.js` | **safe by design** — public, scoped by security rules, ships in the browser bundle |
| `access_token` literals in `test-zoom-api.ts` | **safe** — 7–10 chars, mock OAuth shapes; real Zoom tokens are JWTs |
| A database password pasted into chat this session | **rotation owed** — and `RUN_LOG.md:238` records the same thing happening before |
| A Zoom passcode printed into this session's transcript by my own redaction pattern | **rotation owed, urgent.** My pattern matched `passcode`-prefixed forms and missed `pwd = "…"`. The value was already in git history, so the requirement is unchanged, but the transcript is an additional disclosure surface |
| A PAT pasted in chat in a prior session | **rotation owed** if not already done (`13-handoff-next-session.md:45`) |

**Three rotations are owed:** two Zoom recording passcodes and at least one database
password. None can be performed from here.

**New control:** `scripts/scan-secrets.mjs`, wired as a required CI job. Five rules,
masked output, an explicit `ACCEPTED` baseline with per-item reasons. Proven
failing-before/passing-after: 5 blocking findings before the purge, 0 after.

**Known limitation of the scanner, stated rather than hidden:** it skips `*.example`,
`*.sample` and `*.template` paths, so a real secret committed into `worker/.dev.vars.example`
would be missed. That exclusion exists because those files legitimately carry
`CHANGEME`-style placeholders that otherwise produced constant false positives.

---

## 4. PII

| Surface | Finding |
|---|---|
| `GET /api/feedback?global=1` | returned submitter **emails** to unauthenticated callers until this session |
| `_sqlDualWriteError` response field | returned a **full stack trace** to the client, labelled TEMP DEBUG. Removed — no consumer existed anywhere |
| `v_se_score_leaderboard` | selects `u.email` into a ranking view. Exists on staging, read by no product code today — but a leaderboard surface consuming it would expose emails by default |
| `contact` table | customer emails, **no RLS** (`01_phase1_crm_core.sql:33`) |
| `sync_outbox.payload` jsonb | arbitrary record payloads, **no RLS**, 236 rows pending indefinitely |
| `sql_fallback_log` | deliberately carries **no payload** — only method, reason, ids. Correct design, and P5's additions (correlation id, owner id) preserve it |
| `redact_pii()` | exists (`06_phase6_…sql:249`), NULLs analysis/detail/transcript refs for 12-month-old lost deals. **Nothing schedules it** — same class as the stopped projector |

---

## 5. Denial of wallet

| Route | Before | After |
|---|---|---|
| `POST /api/search/rag` | unauthenticated, unbounded candidates → embeddings on the server's key | authenticated, ≤200 candidates, ≤4000-char query |
| Ten provider call sites | no timeout → a hung socket held a Cloud Run slot until the service timeout | bounded, 10–120s by class |
| `ai_run` attribution | 0.14% joinable to a call (J-019) | unchanged — **cost anomaly detection reads a table that cannot attribute 99.86% of its rows** |
| Daily token budget | F-028: no-ops when `userId` is absent (`data/token-budget.ts:74-76`) | **not addressed** — outside P10's scope, and 16 of 37 users have no org/identity completeness (J-022), so the absent-userId path is not hypothetical |

---

## 6. Dependency and supply chain

- `npm ci` from lockfiles, all four workspaces, exit 0. No dependency version changed on
  this branch.
- The secret scanner is **deliberately self-contained** — no third-party scanning action,
  no network, so it adds no supply-chain surface to CI.
- `.git/hooks/pre-push` enforces a corporate org allowlist **and POSTs a
  `GIT_PUSH_POLICY_VIOLATION`** to `https://ghc.freshpo.com/ghctest` carrying git user
  name, email and repo path. Pushing this branch to `Antony-sagayaraj/SE-Labs` is either
  blocked or requires bypassing a DLP control — a human decision, not taken here (B-06).
- `graphify-out/` is a **tracked generated artefact** (32 files). It references source
  filenames but does **not** embed file contents — verified by searching it for the Zoom
  literal.

---

## 7. Not covered, and why

| Area | Status |
|---|---|
| SQL injection / unsafe dynamic SQL | **not systematically audited.** Spot checks show parameterised queries throughout the persistence layer, and `session-context.ts:337` explicitly comments that session variables are set via parameterised `set_config` and never interpolated. A full sweep is outstanding |
| CORS / CSRF / clickjacking / security headers | **not audited.** `node-server.ts:210` advertises `"GET, POST, OPTIONS"` in its preflight, which appears to block cross-origin PATCH/DELETE; whether that is intentional is unclear |
| XSS / unsafe HTML rendering | **not audited.** `web/` uses `innerHTML` in the call view (F-029 counted six repaints), so this warrants a pass |
| File upload / archive / path traversal | **not audited** |
| OAuth state / redirect / token lifecycle | **not audited.** Zoom user-OAuth path exists but is unused |
| Prompt injection from transcript content reaching model instructions | **AUDITED AND GATED** — see `prompt-injection-assessment.md`. The framing here is **refuted**: no pass puts transcript text in a model instruction (13/13 use user-role content; caches are user-role too). The concern is confirmed anyway — a compliant model drives the demo QIP to 9.7/10, delimiter breaking works everywhere, `summarise`/`classify` never close their transcript block, the speaker label is echoed outside the delimiters, and the Gemini transcript-cache path demotes the system prompt into the user turn. No egress channel exists (every post-call pass is `research: false`). Gated by `worker/scripts/test-prompt-injection-transcript.ts` (`unit`, hermetic). **Still unverified: whether a real model complies** — that needs the `live-api` lane |
| Cloud Run IAM, service-account privilege, secret delivery | **`RUNTIME-BLOCKED`** (B-04) |
| Firestore security rules | **`RUNTIME-BLOCKED`** (B-03, no JDK) — unchanged from the merge audit, which also could not verify them |

These are listed so the coverage boundary is explicit. **This document is not a complete
security review**; it is the security findings that fell out of a correctness-focused
audit, plus the four holes P4 named and closed.
