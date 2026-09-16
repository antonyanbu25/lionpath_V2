# Fix — Duplicate Freshdesk tickets from one feedback submit

Repo: /root/lionpath_V2 | Branch: 2.1

## Problem
A single feedback submit from the portal creates up to 5 Freshdesk tickets.

## Root cause
`appendFeedback` (worker/src/feedback.ts:184) calls `createJanusTicket`, which creates a
Freshdesk ticket. `appendFeedback` is invoked from THREE different places, and the frontend
fires TWO different endpoints for the same submit:

1. Frontend `submitFeedback` (web/feedback.js:255) → `createSupportTicket` → POST `/api/tickets`
   → `handleTicketsPost` → `createFreshdeskTicket` → ticket #1
2. Same submit also calls `postEntry` (web/feedback.js:275) → POST `/api/feedback`
   → `handleFeedbackPost` → `appendFeedback` → `createJanusTicket` → ticket #2
3. `handleTicketsPost` (worker/src/routes.ts:1274-1288) — when kind==="feedback" it ALSO calls
   `appendFeedback` → `createJanusTicket` → ticket #3 (so /api/tickets alone makes 2 tickets)
4. `syncPendingFeedback` (web/feedback.js:97) — on page load, unsynced queue entries re-post
   to /api/feedback → `createJanusTicket` → ticket #4
5. Retries / double-submits → ticket #5

## Fix (make ticket creation a SINGLE path)
`/api/tickets` is the canonical ticket creator (handles attachments, proper Freshdesk types).
`/api/feedback` should be PURE STORAGE — it must NOT create a ticket.

### Change 1 — worker/src/feedback.ts
In `appendFeedback`, REMOVE the `createJanusTicket` call and the ticketId/ticketError
assignment. `appendFeedback` becomes pure local storage (per-user + global log). Do NOT delete
the `createJanusTicket` function itself (it is exported and may be referenced elsewhere/tests),
just stop calling it from `appendFeedback`.

Current (lines 184-190):
```
  const ticket = await createJanusTicket(env, withEmail);
  withEmail.ticketId = ticket.ticketId;
  withEmail.ticketError = ticket.error;
  entry.ticketId = ticket.ticketId;
  entry.ticketError = ticket.error;
  await backend.put(feedbackKey(email), JSON.stringify(merged));
  await appendGlobal(env, withEmail);
  return merged;
```
Replace with:
```
  await backend.put(feedbackKey(email), JSON.stringify(merged));
  await appendGlobal(env, withEmail);
  return merged;
```
(Keep the earlier `await backend.put(...)` and `await appendGlobal(...)` at lines 182-183 as-is.)

### Change 2 — worker/src/routes.ts (handleTicketsPost mirror, lines ~1274-1288)
The "best-effort mirror" block that calls `appendFeedback` when kind==="feedback" is now
redundant (the frontend already posts to /api/feedback separately for local storage) and was a
source of a duplicate ticket. REMOVE this mirror block entirely (the `if (kind === "feedback" && feedbackStorageAvailable(env)) { ... }` block). This ensures /api/tickets creates exactly ONE ticket and does not trigger a second via appendFeedback.

### Change 3 — web/feedback.js (markSynced, lines ~90-95)
After Change 1, `/api/feedback` returns `ticketId: null`. `markSynced` currently overwrites the
queue entry's real ticketId (set from the /api/tickets response) with null. Fix it to preserve
an existing ticketId when the response has none:
```
function markSynced(id, data) {
  const ticketId = data?.ticketId ?? data?.freshdeskTicketId;
  updateQueuedEntry(id, {
    synced: true,
    ...(ticketId ? { ticketId } : {}),
  });
}
```

## Result
One feedback submit → exactly ONE ticket (from /api/tickets). /api/feedback and
syncPendingFeedback only store locally, never create tickets.

## Verification
- Confirm no other callers of `createJanusTicket` exist (grep). If none, it's now dead code but
  keep it exported (harmless).
- Worker typecheck: `cd worker && npm run typecheck` — ensure NO NEW errors in feedback.ts /
  routes.ts (pre-existing errors in env.ts/org-structure.ts/rivals-context.ts/video/* are NOT
  yours; ignore them).
- Web build: `cd /root/lionpath_V2 && npm run build` (or `hermes verify`) succeeds.
- Manual: submit feedback once → exactly 1 Freshdesk ticket appears.

## Constraints
- Do NOT touch firestore.rules.
- Do NOT change the /api/tickets ticket-creation logic itself (createFreshdeskTicket stays).
- Commit after the changes. Push to origin/2.1.
