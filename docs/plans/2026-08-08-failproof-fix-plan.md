# FAILPROOF Fix Plan — Deterministic commit retry + permission cascade (GLM-5.2 directive)

Branch: 2.1 | Repo: /root/lionpath_V2 | Implementer: Codex (gpt-5.5)

## Context
The realtime refactor (store.js read/write split, firestore-store onSnapshot subscriptions,
wired into dashboard/deal-view/call-view) is DONE and pushed (commits 620f491..4c253f8).
Integrate with it — do NOT fork or conflict.

Two CRITICAL production bugs remain, from a live portal log:

## BUG A — Deterministic commit retry (commit 500 persists)
The retry is mathematically guaranteed to reproduce the same truncation:
- `worker/src/providers/index.ts:110` `postcallSeedFromPrompt(passName, user)` → stable seed
- `index.ts:132` `temperature = req.temperature ?? 0`
- `commit.ts:349` retry passes `maxTokens: 6000` but SAME seed + SAME temp + SAME prompt

Position 1489 is a CHARACTER position (~350 tokens) — the model stops early (finish_reason:
stop), NOT a token limit. Raising maxTokens alone cannot help.

### Fix (COMBINE: seed variation + temp bump + conciseness hint + JSON repair fallback)

**A1 — worker/src/providers/index.ts**
1. Add `retryAttempt?: number` to the request options type.
2. After `baseSeed = postcallSeedFromPrompt(passName, user)`, compute
   `seed = retryAttempt > 0 ? baseSeed + retryAttempt * 7919 : baseSeed`.
3. Temperature: if `retryAttempt > 0`, `temperature = Math.max(0.15, req.temperature ?? 0)`;
   else keep `req.temperature ?? 0`.
4. Thread `retryAttempt` through the call chain (commit.ts → provider call → request builder →
   Gemini config). Default 0 so non-retry calls are unaffected.

**A2 — worker/src/postcall/commit.ts**
1. On parse failure, capture the FULL raw output into `partialJson` (not just preview).
2. Retry (line ~349) with: `retryAttempt: 1`, `maxTokens: 6000`, and a conciseness directive
   appended to the prompt: "Your previous response was truncated. Produce the COMPLETE JSON in
   a single response. Keep the justification field under 150 words. Do not include any text
   outside the JSON object." Do NOT use "continue from partial JSON" as primary (causes prefix
   repetition).
3. Add a JSON repair fallback: a `safeParseJson` that tries JSON.parse, then a repair pass
   (close unterminated strings/objects). Install `jsonrepair` in worker/ if needed.
4. If retry 1 still fails, do a THIRD attempt (retryAttempt: 2, maxTokens: 8000, temp 0.2) with
   a continuation prompt. Concatenate raw + continuation, safeParseJson again.
5. Cap total attempts at 3 (initial + 2 retries). After 3, return soft-fail with raw output
   attached for debugging. Log seed, temp, finishReason, token count on every retry.

## BUG B — Permission-denied cascade
Log shows: `Missing or insufficient permissions` on technical commit, call detail, deal reads,
post-call dual-write, and `hist_*` stub IDs reaching Firestore.

### B(a) — Filter hist_* stub IDs before Firestore queries
`isHistoryStubId()` exists in api-store but isn't applied at every Firestore entry point.
1. Export `isHistoryStubId` from api-store and use it in firestore-store too.
2. Apply the guard at the FIRST line of every Firestore-touching function:
   - `listDealsByAccount` — filter hist_* IDs before querying Firestore.
   - `getTechnicalCommitByDeal` — return null for hist_* (no Firestore call).
   - `getCall` / `getPostCall` — return local-history call for hist_* (no Firestore call).
   - `search-service` account row index — skip hist_* account IDs.
   - firestore-store onSnapshot subscriptions — do NOT subscribe for hist_* IDs (critical for
     the realtime refactor).

### B(b) — Technical commit / call detail / deal reads failing on permissions
The realtime refactor switches reads to the browser Firestore SDK. Ensure:
1. The browser reads use the correct auth context (ownerId/teamId/orgId match the rules).
2. Add a worker API fallback: if a browser Firestore read throws permission-denied, fall back
   to the worker API (api-store) so the UI still loads. This is the safety net.

### B(c) — Post-call dual-write permission failure
The post-call dual-write writes to Firestore client-side and is denied.
1. Route the dual-write through the worker admin SDK (like the deal-create fix we already did).
   The worker writes with admin privileges; the client does NOT write directly.
2. Ensure `ensure customer contact` and `prior technical commit lookup` use the admin SDK or
   the isHistoryStubId guard.

## Ordering
1. BUG A (isolated to worker) — unblocks commits immediately.
2. BUG B(a) (quick guard layer).
3. BUG B(c) (dual-write through worker).
4. BUG B(b) (read fallback — integrates with realtime refactor).

## Constraints
- Do NOT change first-attempt behavior (seed=0, temp=0) — only the retry path changes.
- Do NOT add client-side Firestore writes anywhere. ALL writes go through the worker admin SDK.
- Do NOT loosen firestore.rules. The rules are correct.
- Do NOT increase maxTokens beyond 6000 without checking finishReason first.
- Commit after each bug. Push to origin/2.1 when done.

## Verification
- BUG A: mock Gemini returning truncated JSON on attempt 0, valid on attempt 1 → commit succeeds.
  After deploy, no more "position 1489" errors; retry log shows different seed + temp 0.2.
- BUG B(a): listDealsByAccount("hist_healthydietqa") → [], no Firestore call. No hist_* +
  permissions in logs.
- BUG B(b): deal-view for real deal → technical commit loads and stays, timeline loads and
  stays, deal stage displays. No "skipped (permissions)" in logs.
- BUG B(c): post-call commit → dual-write succeeds, ensure customer contact succeeds, prior
  technical commit lookup succeeds. No "dual-write failed" in logs.
- Full regression: existing test suite passes; portal smoke test (dashboard → deal-view →
  call-view → post-call commit) shows no permission errors.
