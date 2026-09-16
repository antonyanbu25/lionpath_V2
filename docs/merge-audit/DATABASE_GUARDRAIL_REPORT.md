# Database Guardrail Report

`main` is the authority for current database behaviour. This records every
database-sensitive difference the Astra branch proposed, what `main` behaviour
was being protected, and the evidence that nothing regressed.

## The strongest guarantee first

**The integration changes no schema and no migration.**

```bash
git diff --name-only a4d5cb7...HEAD -- janus/schema janus/tests
# (empty)
```

So migration immutability holds by construction — there was no applied
migration to reorder, edit or supersede, and no new migration to make
idempotent. The final diff touches 44 files, none of them under
`janus/schema/` or `janus/tests/`.

Independent confirmation by object count, comparing the baseline cluster
against a from-scratch install on the integration branch:

| Database | Built from | Tables/views | RLS policies |
| --- | --- | --- | --- |
| `janus` | baseline `main` | 79 | 46 |
| `janus_verify` | fresh install, integration branch | 79 | 46 |

Identical. No schema drift.

## Database-sensitive source changes

Areas treated as high-risk regardless of how the path looks. Each Astra change
landing in one of them, and its disposition:

| Area | Astra change | `main` behaviour protected | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| `janus/schema/**`, `janus/tests/**` | none | Whole schema, incl. `22_scoring_reshape.sql` (confidence threshold removed from `v_scorecard_rankable`) | untouched | `git diff` empty; AT-4 19/19 |
| `worker/src/data/persistence/**` | none | `postgres-repository.ts`, `read-repository.ts`, `session-context.ts`, `shapes.ts`, `types.ts` — all changed by `main` since the merge base | untouched by Astra | not in the 44-file diff |
| `worker/src/data/read-models/**` | none directly; A-24 makes the rebuild endpoints reachable | Rebuild functions re-read from Firestore | reachability only | see A-24 below |
| SQL repositories, session context, pooling, transactions, RLS | none | fail-closed RLS, no session-context leakage | untouched | grants 18/18, RLS 8/8, view-RLS 4/4 |
| Domain-write / dual-write / fallback / hydration | none | dual-write plus outbox | untouched | dual-write soak passes |
| `web/domain/**` | A-13, A-14 in `web/domain/store.js` | store wiring | readiness helper added, dead function removed; **no write path touched** | zero callers of the removed symbol; full web suite |
| Pre-call / post-call persistence | A-06 (`postcall/resolve.ts`) | `main`'s SQL-mode pre-call and post-call writes | additive telemetry only | see "main's two SQL fixes" below |
| Scorecard / rubric / leaderboard / motion | none | AT-4 semantics | untouched | AT-4 19/19 |
| `user_usage_daily`, `user_usage_logins`, `ai_run`, usage rollups | none | `main`'s login-tracking and pre-call-usage fixes | untouched | `ai_run` gate matches baseline exactly |
| `id_registry`, public IDs, idempotency keys, retries | A-16, A-17 (duplicate-submit fixes) | idempotency | **reduces** duplicate writes | `test-call-view-paint-count.mjs` |
| `sql_fallback_log` and observability | none; A-06 adds console telemetry | fallbacks stay observable | preserved and slightly improved | `logFallback` calls intact |
| Deployment config, `wrangler.toml`, bindings, secrets, package locks | A-07 (`nodejs_compat`), A-12 (`allowScripts`) | deploy surface | integrated, **flagged**; no binding, secret or lockfile changed | no lockfile in the diff |

## main's two SQL fixes in `worker/src/routes.ts`

This is the file that changed on both sides, so it carried the real risk of a
silent loss. Astra's edits land in the imports, `handleZoomStatus`,
`handleConfig`, `handlePostCallResolve` and the route table; `main`'s land in
`trySqlDomainWrite` and `tryPrepSynthesizeSqlWrite`. Disjoint regions, hence
the clean auto-merge. Both were then verified present by content, not by
trusting the merge:

1. **SQL-mode `upsertPostCallWithSummary` writes `callSummaries`** — the
   handler only ever read `args[0]`, so `callSummary` was silently discarded
   for every write since SQL mode went live; `account.calls` came back empty
   and deal/account summaries were never regenerated.
   Verified at `worker/src/routes.ts:2806` (`const callSummary = (args[1] || null)`),
   with the `sumRef.set` write and the `upsertCallSummary` fallback logging
   intact.

2. **`ensureDealRef` falls back to `lifecycleId`** — the client sends
   `lifecycleId`, not `dealId`, so `dealId`-only resolution left
   `activity.deal_id` null on almost every real synthesize call, and
   `trg_pre_call_deal_required` hard-rejected the write. Pre-call essentially
   never landed.
   Verified at `worker/src/routes.ts:3282`
   (`nullableString(input.dealId) ?? nullableString(input.lifecycleId)`).

## The one conflict, and why the resolution is database-safe

`web/postcall.js` / `computeAnalyzeButtonDisabled` — resolved as a synthesis.

The question that mattered: does removing the `crmPreviewSurfacedOnce` gate
let a write proceed with an unresolved account or deal? No.

- At the merge base the gate was **already present**, so `main` did not add it;
  `main` only added the `PROXY_SE_PICKER_ENABLED` guard. The two deltas are
  independent and both were applied.
- `crmPreviewSurfacedOnce` is a module-local `let` in `web/postcall.js` meaning
  "the CRM preview panel rendered at least once". It carries no account id, no
  deal id, no identity. Removing it removes a **UI gate**, not a data
  dependency.
- Account and deal continue to resolve server-side through `activity`, and the
  write path keeps `main`'s two protections: the `confirmAndGenerate` proxy-SE
  re-check before the dual-write, and the explicit `proxySeUserId` in
  `savePayload`. Both verified present after the merge.

## A-24 — making DB-adjacent endpoints reachable

The genuinely new database-facing surface in this integration is not a code
change to a write path; it is eight routes becoming reachable. Each was checked
individually:

- The five `/api/internal/*` handlers each verify a timing-safe
  `X-Cron-Secret` on their first line and **deny when the secret is unset**.
  That includes the two that mutate — `nightly-rebuild` and
  `deal-grace-sweep`.
- `/api/admin/llm-usage` resolves request context and 403s anything below
  director scope.
- `/api/read-models/schedule` was accepted after confirming its trust model:
  the caller-supplied body is reduced to IDs (`ownerId`, `teamId`, `orgId`,
  `accountId`, `dealId`) and each rebuild function re-reads from Firestore, so
  supplied content cannot be written as derived data. The response carries no
  data. Worst case is an authenticated user triggering recomputation for IDs
  they do not own — a resource and cache-invalidation concern, not exposure or
  poisoning. **Hardening recommendation:** verify the caller owns the
  referenced post-call before scheduling. Noted rather than fixed, because it
  is pre-existing handler behaviour on `main` and outside this merge.
- `/api/analytics/director-summary` was **omitted** — see the change matrix.

## Invariants checked

| Invariant | Status | Evidence |
| --- | --- | --- |
| Canonical ownership: post_call/pre_call to activity to app_user | Preserved | `ai_run` gate: non-activity id rejected by FK |
| Account and deal resolve through `activity` | Preserved | no persistence code changed; routes.ts fix 2 intact |
| No invented columns such as `post_call.owner_email` | Preserved | no schema or query changes |
| RLS fails closed; session context does not leak | Preserved | RLS 8/8, view-RLS 4/4, grants 18/18 |
| Admin context explicit and scoped | Preserved | `admin sees all deals` 2/2; `admin-llm-usage` 403s below director |
| Public IDs / SQL IDs / Firestore IDs / idempotency keys distinct | Preserved | `id_registry` untouched |
| Fallbacks observable; SQL write failures not swallowed | Preserved | `logFallback` intact; `sql_fallback_log` untouched |
| Firestore success not reported as SQL success | Preserved | dual-write soak passes |
| `se_motion` resolves canonically; Expansion never stored as New Business | Preserved | AT-4.2a/4.2b group by (call_type, se_motion); AT-4 19/19 |
| Scorecard motion matches the owning post-call/activity | Preserved | AT-4 19/19 |
| Leaderboard needs current, non-provisional, scored; **not** confidence | Preserved | AT-4.1c excludes provisional; **AT-4.1d confirms the confidence threshold is removed** |
| Usage distinguishes logins / pre-calls / post-calls / AI passes / scorecards | Preserved | usage tables untouched |
| Applied migrations immutable; new behaviour forward-only | Preserved | zero schema files in the diff |

## Not verified here

- **Firestore rules** — `npm run test:rules` is blocked in this environment (no
  Java for the emulator). Not applicable: neither branch touches
  `firestore.rules` or `rules-tests/`.
- **Deployed Cloudflare runtime behaviour of `nodejs_compat`** (A-07) — cannot
  be exercised without a deploy, which was not authorized. Needs a smoke test
  on first deploy.
- **BigQuery-backed analytics** — deliberately left unreachable, so untested by
  design.
