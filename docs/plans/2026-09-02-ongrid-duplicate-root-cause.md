# Root Cause: Ongrid Duplicate History Entries

## Summary

The post-call confirm path persists a completed history record before the lifecycle/domain write is required to succeed. A second confirm/retry can therefore create a second completed history entry for the same Zoom recording because `savePostCallHistory` generates a fresh `postCall_*` id every time. If the later lifecycle/domain write fails, is skipped, or is only best-effort through `/api/history`, the history blob remains the user-facing source of truth and can show orphaned calls that have no `post_call`, `activity`, or `sync_outbox` rows.

## Exact Flow

1. Confirm button wiring:
   - `web/postcall.js:3896` binds `#postcall-confirm-btn` to `confirmAndGenerate`.
   - `web/crayons-ui.js:221-235` dedupes the Crayons `fwClick` + native `click` pair for only 400 ms. This is event-pair protection, not request idempotency.

2. Double-submit window:
   - `web/postcall.js:4141-4144` enters `confirmAndGenerate`; it returns only if module-level `generating` is already true.
   - The request guard is set at `web/postcall.js:4222`, after all validation, confirmation state mutation, and customer-contact writes at `web/postcall.js:4174-4207`.
   - Because `bindActionOnce` reopens after 400 ms (`web/crayons-ui.js:223-231`) and there is no stable per-call idempotency key on confirm, any second confirm/retry that reaches `savePostCallHistory` writes a new history id.
   - The new id is created in `web/history.js:358-360` via `newId("postCall")`.
   - The new record is unconditionally prepended to local history at `web/history.js:388-391`; history dedupe is by id only (`web/history.js:133-143`), so two ids for the same Zoom link survive.

3. History is saved before the required domain write:
   - `web/postcall.js:4427-4476` receives `/api/postcall/generate` output and calls `savePostCallHistory`.
   - Only after that succeeds does `web/postcall.js:4477-4487` call `onAnalysisSaved`.
   - `web/app.js:3223-3236` implements `onAnalysisSaved` and calls `linkPostCallToLifecycle`; any thrown lifecycle/domain-write failure is caught and only logged at `web/app.js:3233-3236`.
   - The sidebar/dashboard are still refreshed from history after that at `web/app.js:3267-3275`.

4. Domain write path:
   - `web/domain/dual-write.js:165-275` builds the domain post-call draft and calls `attachPostCall`.
   - `web/domain/lifecycle-service.js:181-220` dedupes domain writes by `callIdentityKey` when it can read an existing domain row, then uses `store.upsertPostCallWithSummary`.
   - `web/domain/store.js:246-255` selects API writes in non-localhost hosted mode.
   - `web/domain/api-store.js:142-163` includes `upsertPostCallWithSummary` in `ADMIN_WRITE_METHODS`.
   - `web/domain/api-store.js:786-796` routes that method to `adminWrite`.
   - `web/domain/api-store.js:261-267` posts it to `/api/domain-write`.

## Silent Fallback Paths

Primary silent client fallback:

- `web/history.js:391-405` keeps and returns the completed local history record even if the remote `/api/history` write fails. The catch at `web/history.js:402-404` logs only `remote save failed (local copy kept)` and does not fail the post-call flow.
- `web/app.js:3231-3236` catches `linkPostCallToLifecycle` failures and continues; there is no rollback of the already-saved history entry.

Server-side history fallback:

- `worker/src/routes.ts:1385-1393` saves the history blob first, then attempts best-effort SQL shredding.
- `worker/src/routes.ts:1394-1402` explicitly catches SQL shred failures and still preserves the already-successful history response.
- `worker/src/routes.ts:2090-2105` documents the contract: `/api/history` writes the JSON blob and Postgres shredding must never change the response; missing id/account/analysis means the Firestore/blob remains source of truth.
- `worker/src/routes.ts:2120-2128` quietly skips SQL when `id`, `accountId`, `analysis`, or SQL session are missing.
- `worker/src/routes.ts:2155-2166` quietly skips SQL on JSON shape validation failure.

Login/background replay fallback:

- `web/history.js:277-326` runs `syncHistoryOnLogin`, merging local and remote history and pushing merged entries back to the server blob.
- `web/history.js:303-308` checks only remote ids, not PG existence or `callIdentityKey`, before `pushRemoteEntries`.
- `web/recovery/local-recovery.js:117-120` also diffs local-vs-remote by id only.
- `web/recovery/local-recovery.js:288-313` bulk-uploads local-only ids to `/api/history` before attempting any domain backfill.
- `web/recovery/local-recovery.js:354-363` then attempts Firestore/domain backfill, but failures are counted and do not undo the history upload.
- `web/recovery/local-recovery.js:383-399` runs this silently on login.
- `web/app.js:2543-2545` loads persisted history, then starts forced silent `autoSyncOnLogin`.

## Why Shamron's Observed State Fits

The two "Ongrid · Use case discussion" rows can be produced by two successful history saves for the same Zoom URL with two generated ids. The domain-write requirement is downstream/best-effort from the history save. If the lifecycle/domain write did not reach `/api/domain-write`, or if `/api/history` accepted the blob but the best-effort SQL shred skipped/failed, those entries remain in `user_kv.history` while `post_call`, `activity`, and `sync_outbox` have no matching rows.

The Q&A row having a PG row is consistent with a later attempt where the domain-write/shred path succeeded. The history and recovery paths do not reconcile completed history entries against PG by `callIdentityKey`, so orphan blob entries continue to render in Activity after relogin.

## Reproduction

1. Start from a resolved post-call confirm page for one Zoom recording.
2. Trigger confirm/generate twice far enough apart to bypass the 400 ms event-pair dedupe, or retry after a generate success before the downstream lifecycle write completes.
3. Stub or interrupt `linkPostCallToLifecycle` or `/api/domain-write` after `savePostCallHistory` returns.
4. Observe two local/server history records with different `postCall_*` ids and the same Zoom URL, while PG has zero or one `post_call` rows depending on whether any downstream domain write succeeded.

## Fix Direction For Lane B

Use a stable idempotency key for the confirm save, derived from call identity such as normalized Zoom URL plus owner and meeting timestamp/type. Gate the confirm action with an in-flight map that covers the whole save and domain-write path. Persist a completed history entry only after the domain write succeeds, or write a clearly pending entry that is reconciled through the same domain-write path. Login sync must not upload completed history-only entries without checking PG/domain existence by `callIdentityKey`.
