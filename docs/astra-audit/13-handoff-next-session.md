# 13 — Handoff: continuing on another machine

**Written:** 2026-09-11. **Branch:** `fix/astra-audit-functional-prompts`, pushed to `origin` (3 commits on top of `main` @ `0dfd6b1`). Not yet merged, no PR opened yet — link is in the push output: `https://github.com/Antony-sagayaraj/SE-Labs/pull/new/fix/astra-audit-functional-prompts`.

**To pick this up on a new machine:** clone/pull `SE-Labs`, `git checkout fix/astra-audit-functional-prompts` (or `main` if it's been merged by then). That branch has everything described below — code and these docs both travel with it. Nothing needs to be copied by hand.

---

## 1. What's done

All **four functional prompts** are implemented and unit-tested:

- **P6** — registered the dead routes (health checks, internal batch/cron, read-models schedule). Added T8 (`worker/scripts/test-route-reachability.ts`) so no handler can go unreachable again.
- **P13** — Zoom transcript acquisition: timeouts on the raw fetches, topic+date fallback matching, a distinct "transcript still processing" outcome the browser polls on instead of hard-failing.
- **P12** — post-call intake: the Analyse button now gates on field completeness alone (not a completed CRM lookup); confirm gate renders from `/resolve` alone before `/classify` returns; ~100 duplicate `fwClick`+native event bindings deduped (including one that double-submitted MoM saves).
- **P14** — post-call render lifecycle: fixed the realtime-subscription leak (async factory returned a Promise where the teardown code expected a function, so it never unsubscribed, and it never even attached in the default read mode); cut redundant repaints; fixed the `updatedAt`-wins merge rule; Technical Commit/Minutes tabs now distinguish a failed read from a proven-empty one.

Commits: `c773b84` (worker), `0d7d011` (web), `d99d82d` (docs — the audit files listed in §4 below, which were untracked before this).

Full detail on scope decisions/deferrals within P14 (items 1–5 were done in scoped-down, lower-risk form — see the commit message and, if you want the blow-by-blow reasoning, the conversation transcript) is in the commit messages themselves; read those before assuming anything was done exhaustively.

**Also fixed, found only by live-testing this branch (not from the original audit):**

1. **Worker process crash on any Firestore error.** No `process.on("unhandledRejection"/"uncaughtException")` handler existed, so a single Firestore credential failure (this sandbox has no GCP service account — see §3) took down the *entire* node server, not just the failing request. Fixed in `worker/src/node-server.ts`. This is a real robustness gap independent of the credentials-missing sandbox — worth keeping even once real credentials are configured everywhere.
2. **The post-call intake button could hang indefinitely.** `crmResolving` (a flag meant to be a "brief spinner", per its own code comment) gates the Analyse button, and a slow/failing CRM lookup could hold it for many seconds — reintroducing exactly the "primary action depends on a round-trip" bug P12 was supposed to fix, just via a different variable than the one P12 removed. Capped at 2.5s in `web/postcall.js` (`CRM_RESOLVING_CAP_MS`) — the lookup still runs and populates the account/deal preview in the background, it just no longer blocks the button past that cap.

## 2. Unresolved — pick this up first

**The user reported "press [Analyse call] twice, that is the issue" with a real Zoom recording URL/passcode.** Live-testing (browser automation, real login) reproduced: one click on Analyse fired **three** `POST /api/postcall/resolve` requests, not one or two. This was **not root-caused**. What's already ruled out, so you don't redo this work:

- `startPipeline`'s `pass0Busy` guard (`web/postcall.js` ~line 5694) looks correct — it's set synchronously before any `await`, closing the same-tick double-invocation window it says it closes.
- `resolveWithZoomPendingRetry` (~line 3140) only retries when `err.zoomTranscriptPending` is true; the error observed was a hard "Zoom OAuth not configured" 400, which isn't that case, so it shouldn't be retrying.
- `runZoomPreResolve`'s dedup key (`zoomPreResolveWarmedKey`) is checked-then-set synchronously with no `await` in between, so it shouldn't double-fire either.

One of the three calls was confirmed (via console warning) to be the pre-resolve warm-up (`runZoomPreResolve`) firing once, correctly. The other two are unexplained — timestamps suggest they fired close together, closer to the click than to the typing, which points at the submit path rather than the pre-warm path, but this needs direct instrumentation (add a `console.trace()` or breakpoint at every call site of `RESOLVE_URL`/`postJson(RESOLVE_URL, ...)` and reproduce) rather than more static reading — that's where I'd start.

Do this **before** starting the non-functional prompts below — it's a real, user-reported bug in code we just shipped.

## 3. Environment gotchas (all discovered this session — will cost you time if you rediscover them)

- **Firebase auth wall for live/e2e testing.** `web/firebase-config.local.js` (gitignored, machine-local) has a real Firebase project configured, so `authMode()` returns `"firebase"`, not `"dummy"` — the localStorage session-injection bypass the e2e tests use doesn't work. Live browser verification needs a real Google SSO login. (We did get logged in — real account `nivedha.natarajan@freshworks.com` — via the in-app browser pane; Claude in Chrome extension was not installed/connected on this machine.)
- **No GCP/Firebase Admin credentials in this worker sandbox.** `GOOGLE_APPLICATION_CREDENTIALS` unset → `/api/accounts`, `/api/contacts`, `/api/history`, `/api/tasks`, `/api/briefs` all 500 with "Could not load the default credentials." Also no Zoom Server-to-Server OAuth configured (`ZOOM_ACCOUNT_ID`/`ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET`), so real Zoom transcript fetching can't be tested end-to-end here either. Both are sandbox-specific, not code bugs — but expect them to fire constantly while testing locally on this box.
- **Stale dev-server processes.** More than once this session, a `node scripts/dev-node.mjs` (worker) or `node dev-server.mjs` (web) process was found running for 24+ hours, serving code from *before* the fixes — making working fixes look broken (404s, missing behavior). Before trusting a "this doesn't work" observation, check the serving process actually started *after* your latest edit: `ps -p <pid> -o lstart`.
- **No git identity configured** (`user.name`/`user.email` unset, global and local). Commits this session used one-off `-c user.name=... -c user.email=...` flags, never persisted to config.
- **No GitHub credential helper configured.** Pushing needs a PAT supplied fresh each time via a one-off `http.https://github.com/.extraheader` flag (never persisted). **The PAT used this session was pasted in chat twice and should be rotated** if that hasn't happened yet.
- **A `pre-push` hook enforces an "approved GitHub organizations" allowlist** and blocked pushing to `Antony-sagayaraj/SE-Labs` (a personal account, not an org). The user explicitly authorized bypassing it with `--no-verify` for this specific push, after confirming they understood what it was blocking. Worth raising with IT/security — either this destination should be on the allowlist, or it's correctly flagging that this repo shouldn't be a push target from a Freshworks-managed machine.

## 4. The audit files (from "the first review") — now committed on this branch

Everything under `docs/astra-audit/` was previously untracked (audit output sitting in the working tree, never committed) and is now part of the `docs:` commit on this branch:

- `00-executive-summary.md` through `12-postcall-ux-zoom-and-loading.md` — the full audit: architecture, the SQL persistence gap, every finding (F-001 through F-039+) ranked by severity, test coverage, remediation plan.
- `11-implementation-prompts.md` — **the canonical source for every P1–P15 prompt.** Read the actual prompt text there before starting any of them; don't rely on the one-line summaries below.
- `_evidence-index.md`, `_audit-state.md` — evidence citations and audit progress tracking.
- `repros/` — two reproduction scripts that proved specific findings live (F-001 dual-writer collision, F-005 destructive UPSERT), plus a post-rebase verification script.

## 5. What's next

You (this user) categorized the 15 prompts into three lists earlier: **functional** (done — §1), **non-functional**, and **SQL/data-storage**. The data-storage ones are explicitly out of scope for you — your teammate (`Antony-sagayaraj`) owns that layer and is fixing it independently on `main`; rebase periodically to pick up their fixes rather than duplicating this work. For reference, those are **P2, P3, P7, P8, P9, P11**.

**Non-functional — this is the actual next batch**, in the order the audit's own dependency graph marks as independent/safe to do in any order:

- **P1 — Purge the committed Zoom recording credential.** Five dead debug scripts (`worker/scripts/debug-zoom*.mjs`) contain a real Freshworks Zoom share URL *and its plaintext passcode*. Delete them, check git history exposure (`git log --all -S'<passcode>'` — don't print the literal), add a secret-scanning CI job. **Escalate the passcode as compromised regardless of what you find in history** — the audit is explicit that deleting the files doesn't remediate already-pushed history.
- **P4 — Close three authorisation holes.** A cross-tenant IDOR write (`handleCallPayloadOffloadPost` never checks resource ownership, unlike its GET sibling), an unauthenticated cross-user read (`handleFeedbackGet`'s `?global=1` branch returns before the auth check), and unauthenticated compute-spend (`handleSearchRag` has no auth call at all, burns embedding-API tokens for free).
- **P5 — Stop the silence around failed durable writes.** A failed post-call SQL write currently vanishes into `console.warn`; six silent skip conditions in `tryHistoryPostCallSqlWrite` log nothing. Ship structured `logFallback` rows to `sql_fallback_log` instead, plus a non-blocking UI indicator. Note: **P5 is meant to ship alongside P3** (teammate's work) so P3's effect becomes measurable — coordinate rather than doing this in isolation.
- **P10 — Timeouts on every provider call; fix pass classification.** Three provider fetches (video transcript inference ×2, embeddings) have no `AbortController`/timeout/retry at all. Separately, 5 pass names (`scorecard-verify`, `scorecard-calibrate`, `deck-validate`, `speaker-attribution`, `linkedin-identity`) are missing from `POSTCALL_PASS_NAMES` and silently fall through to the wrong timeout budget.
- **P15 — CI foundation.** No PostgreSQL in CI (blocks 12+ tests), `tsc --noEmit` never runs anywhere, three test gates silently pass with `DATABASE_URL` unset instead of hard-failing, 13 test files exist in no manifest. This one "unlocks verification for every other prompt," per the audit's own framing — worth doing early rather than last, even though it's listed last here.

Read each prompt's full text in `11-implementation-prompts.md` before starting — the summaries above are just enough to remind you which is which, not enough to implement from.

## 6. Suggested order for the new session

1. Root-cause and fix the "press twice" triple-resolve bug (§2) — it's live, reported, and unresolved.
2. P1 (credential purge — small, urgent, has a real compromised secret sitting in it).
3. P15 (CI foundation — unlocks trustworthy verification for everything after it).
4. P4, P5, P10 in whatever order suits — all independent of each other and of the data-layer chain.
5. Rebase onto `Antony-sagayaraj/main` periodically to pick up teammate's P2/P3/P7/P8/P9/P11 progress; nothing here depends on waiting for that, but conflicts are cheaper to resolve early.
