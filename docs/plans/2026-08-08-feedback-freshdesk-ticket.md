# IMPLEMENTATION PLAN — Feedback → Freshdesk (janus) ticket flow (branch 2.1)

SOURCE OF TRUTH FOR CODEX. Field ids, option values, status ids, custom-field names MUST be exact.

## Context
- Repo: /root/lionpath_V2, branch 2.1. Live portal portal.benjaminsquare.com, API portalapi.benjaminsquare.com (Node worker on VPS via docker-compose, file-based HISTORY_BACKEND).
- Freshdesk: janus.freshdesk.com, API key <REDACTED> (Basic auth username=key, password="X").
- Status id 2 = Open. HARDCODE status:2 on every ticket. Never from form/env.
- Ticket email = SSO email resolved server-side via resolveHistoryEmail (worker authoritative), NOT raw client value.
- SEs see Feedback in sidebar; pick category + dropdowns + description; Submit → ticket created Open for managers.

## INVARIANTS
- status ALWAYS literal 2 (Open).
- If FRESHDESK_API_KEY or FRESHDESK_DOMAIN unset → still save feedback to KV; skip ticket (graceful), log ticketError. UI never blocks on Freshdesk.
- localStorage queue (lionpath_feedback) written FIRST; /api/feedback POST fire-and-forget; modal closes on "saved" regardless of ticket outcome.
- All animations pure CSS transform/opacity/box-shadow, gated behind prefers-reduced-motion. No JS animation libs.
- Do NOT chase pre-existing worker typecheck errors (contact/enrich, call-payload-storage, org-structure, rivals-context, frame-image, vision, etc.) — worker runs via tsx, no strict build gate. Only avoid introducing NEW typecheck errors in files you touch.

## CUSTOM FIELD NAME CORRECTION (IMPORTANT)
Freshdesk auto-generates internal `name` for custom fields from the label at create time (snake_case), and the exact generated `name` is what `custom_fields` must key by on ticket create. Do NOT hardcode guessed `cf_` keys. Instead:
1. seed script posts the fields to janus admin API (POST /api/v2/admin/ticket_fields).
2. seed script then GETs /api/v2/admin/ticket_fields, finds each field by its label, reads its real generated `name` (e.g. cf_type_severity), and prints/records the mapping.
3. worker/src/freshdesk.ts uses those real `name` keys for custom_fields on ticket create. Provide the real names as constants (fill from the seed script output before finalizing).

Proposed labels (label → expected type):
- "Type / Severity" → custom_dropdown, choices: ["Critical — blocking work","High — workable but painful","General — improvement","Minor — nice to have"]
- "Area of the product" → custom_dropdown, choices: ["Pre-call prep","Post-call analysis","Dashboard","Accounts & deals","Coaching / scorecards","Search","UI / visual","Performance / speed","Other"]
- "Call ID" → custom_text
- "Deal ID" → custom_text
- "Account ID" → custom_text
- "Page context (hash)" → custom_paragraph

## FILES TO CHANGE

1. web/index.html
   - Line ~282: remove `hidden` from #sidebar-feedback.
   - Lines ~705-723: replace feedback-form contents with 5 fields (feedback-category [bug/idea/data/other], feedback-severity, feedback-area, feedback-priority, feedback-text). Keep #feedback-modal, #feedback-close, #feedback-submit, #feedback-status.
   - Bump portal-build meta + cache-bust query strings per existing convention (portal-build content e.g. 2.1.x-feedback; app.js?v=..., styles.css?v=...).

2. web/feedback.js
   - Add SEVERITY_MAP, AREA_MAP, PULSE_COUNT_KEY ("lionpath_feedback_pulse_count").
   - Add capturePageContext() (parse hash for #accounts/{id}, #deals/{dealId}, #accounts/{id}/deals/{dealId}, #calls/{callId}; return {hash, callId, dealId, accountId, view}); store lastPageContext on open().
   - Add exported bumpFeedbackPulse() (increment counter; >=3 → add class sidebar-feedback-pulse; on modal open reset counter + remove class).
   - Extend submitFeedback: read all 5 fields via readFieldValueAsync; build entry {id, category, severity, area, priority(string "1".."4"), message, page(hash), context, email, createdAt, synced:false}; save to localStorage queue first; POST /api/feedback; on success mark synced=true + store ticketId; add feedback-submit-success class; on failure keep unsynced.
   - Add exported syncPendingFeedback() to retry unsynced entries (called from app.js after init).
   - Toggle feedback-open class on modal open/close for transition.
   - Extend CATEGORY_MAP with other: "Other".

3. web/styles.css
   - Append: .sidebar-feedback-pulse + @keyframes lionpath-fb-pulse (box-shadow ripple, rgba(42,123,108,...)).
   - Append: #feedback-modal.feedback-open #feedback-form + @keyframes lionpath-fb-modal-in (opacity + translateY + scale, 0.3s).
   - Append: .feedback-submit-success + @keyframes lionpath-fb-success (scale bump 0.5s).
   - Append prefers-reduced-motion guard for the 3 new animation classes.

4. web/app.js
   - Import bumpFeedbackPulse from feedback.js (line 14).
   - After initFeedback, call syncPendingFeedback().
   - After successful post-call analysis completion, call bumpFeedbackPulse().

5. worker/src/feedback.ts
   - Add optional fields to FeedbackEntry: ticketId?, ticketError?.
   - Add createJanusTicket(env, entry): reads FRESHDESK_API_KEY/FRESHDESK_DOMAIN; if missing → return {ticketId:null, error:"not configured"} (no throw). Build ticket body per mapping below; POST https://{domain}/api/v2/tickets with Basic auth; return {ticketId, error}. NEVER throws into KV-save path.
   - Modify appendFeedback: after appendGlobal, call createJanusTicket, store result on entry.

6. worker/src/freshdesk.ts (NEW)
   - createTicket(env, payload): fetch POST to https://FRESHDESK_DOMAIN/api/v2/tickets, Authorization: Basic base64(key:X), Content-Type application/json. Return parsed {id, ...} or throw.

7. worker/src/routes.ts
   - handleFeedbackPost (~895): extend body type with severity?, area?, priority?, context?. Pass enriched entry through to appendFeedback. Return { email, entry, count, ticketId: entry.ticketId ?? null, ticketError: entry.ticketError ?? null }.

8. worker/src/env.ts
   - Add FRESHDESK_API_KEY?: string; FRESHDESK_DOMAIN?: string; to Env interface.

9. worker/src/node-server.ts
   - Add to NodeEnv interface: FRESHDESK_API_KEY?: string; FRESHDESK_DOMAIN?: string;
   - buildEnv(): add FRESHDESK_API_KEY: process.env.FRESHDESK_API_KEY, FRESHDESK_DOMAIN: process.env.FRESHDESK_DOMAIN || "janus.freshdesk.com".

10. deploy/vps/.env.example
    - Append:
      # Freshdesk (janus) feedback ticket creation
      FRESHDESK_API_KEY=<REDACTED>
      FRESHDESK_DOMAIN=janus.freshdesk.com

11. worker/scripts/seed-freshdesk-fields.mjs (NEW)
    - POSTs the 6 custom fields (labels above) to janus admin API, then GETs back real generated names, prints the mapping. Run once before deploy.

## TICKET MAPPING (createJanusTicket body)
{
  "subject": "Portal Feedback: <Category>",
  "description": "Category: <cat>\nType/Severity: <sev>\nArea: <area>\nPriority: <prio label>\nSE: <email>\n\n--- Feedback ---\n<message>\n\n--- Page context ---\nView: <view>\nHash: <hash>\nCall ID: <callId|—>\nDeal ID: <dealId|—>\nAccount ID: <accountId|—>",
  "email": "<resolved SSO email>",
  "priority": <int from priority, default 2>,
  "status": 2,
  "tags": ["portal-feedback", "<severity-key>", "<area-key>"],
  "custom_fields": { "<real cf_severity name>": "<severity label>", "<real cf_area name>": "<area label>", "<real cf_call_id name>": "<callId>", "<real cf_deal_id name>": "<dealId>", "<real cf_account_id name>": "<accountId>", "<real cf_page_context name>": "<hash>" }
}

## IMPLEMENTATION ORDER
1. seed-freshdesk-fields.mjs: create fields, GET real names, record mapping.
2. env.ts + node-server.ts + .env.example env wiring.
3. freshdesk.ts + feedback.ts createJanusTicket/appendFeedback.
4. routes.ts enriched entry pass-through.
5. index.html: unhide button + 5-field modal.
6. feedback.js: maps, page context, pulse, optimistic queue, syncPendingFeedback.
7. styles.css animations.
8. app.js: bumpFeedbackPulse + syncPendingFeedback wiring.
9. Verify: worker tsc --noEmit shows NO NEW errors in touched files vs baseline; web build works.

## VERIFICATION
- POST /api/feedback with a test entry (after deploy) → 200 + ticket Open in janus with correct email + custom fields.
- UI: hard refresh portal → Feedback button visible → submit → success → ticket appears Open.
