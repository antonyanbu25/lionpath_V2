# Two parallel workstreams for gpt-5.6-sol

## Stream A: Feedback flow improvements
**Files:** web/feedback.js, web/index.html, web/app.js

### Current state
- Feedback button exists in sidebar (id="sidebar-feedback") but is `hidden` in HTML
- Modal exists (id="feedback-modal") with Category dropdown and text area
- Saves to localStorage + Worker POST /api/feedback
- Worker saves to KV but does NOT create Freshdesk tickets

### What to build
1. **Show the feedback button** — remove `hidden` attribute from `#sidebar-feedback` in index.html
2. **Add a "Take a screenshot" option** after submit that opens the browser's Share/Screenshot API or just a note asking user to describe what they see
3. **Make the feedback button always visible** in sidebar
4. **Add subtle pulse animation** on the button after 3 post-call analyses or 5 dashboard visits (using localStorage counter)
5. **Change category dropdown** from 3 options to 4: Bug, Idea, Data quality, Other
6. **Add page-context metadata** to the feedback entry: current call ID if on call view, current deal ID if on deal view

### Files to modify
- `web/feedback.js` — Add localStorage counter for pulse trigger, add page context metadata
- `web/index.html` — Remove `hidden` from feedback button
- `web/styles.css` — Add pulse animation class

## Stream B: Freshdesk ticket creation from feedback

### What to build
The Worker's `/api/feedback` handler (worker/src/feedback.ts) currently only saves to KV. Add a Freshdesk ticket creation step using the API key.

### Freshdesk API notes
- Domain: janus.freshdesk.com
- API key: <REDACTED>
- Auth: Basic with API key as username, "X" as password
- Create ticket endpoint: POST /api/v2/tickets

### Fields to create in Freshdesk ticket
Use the existing ticket_fields. The ticket should include:
- subject: "Portal Feedback: {category}"
- description: Full feedback message + page context + user email
- tags: ["portal-feedback", {category}]
- priority: 2 (medium) 
- status: 2 (open)
- custom_fields: set cf_category to the feedback category

### Files to modify
- `worker/src/feedback.ts` — Add Freshdesk API call after saving to KV
- `worker/src/routes.ts` — May need env vars for FRESHDESK_API_KEY and FRESHDESK_DOMAIN
- Worker env config (deploy/vps/.env or docker-compose) — Add FRESHDESK_API_KEY and FRESHDESK_DOMAIN
