# One-Time Boss Decision UI — Architecture Plan Request

## Context
Portal.benjaminsquare.com (freshworks SE tool). The user (Tony/Antony) wants a one-time popup to choose how unfinished tabs appear.

## What We Have Right Now
- All tabs show Coming Soon with countdown timer to Aug 16 5:30 PM IST
- Sidebar buttons showing: Dashboard, Accounts, My Coaching, Activities, Feedback (some hidden)

## What The Boss Wants
A **one-time popup** that shows ONCE when the boss logs in. It asks:

### Popup 1: "How do you want the unfinished tabs to look?"
Two buttons:
- **"See with coming soon timer"** — keeps current Coming Soon pages
- **"See with icons hidden"** — hides sidebar buttons for unfinished sections, shows only feedback after activities

### Popup 2 (after clicking a button):
A confirmation drop-down saying: "This will trigger a push and redeploy (~X seconds). Continue?"
- If yes → we patch the VPS with the chosen option and redeploy
- A toast shows: "Updates are being applied. Estimated time: X seconds"
- After the redeploy completes, toast shows "Done!"

### Constraints
- Showed exactly ONCE. After counter is decremented to 0, purge the flag. Never show again.
- Before every push, check if that counter is 0.
- The popup must appear BEFORE the first page renders (on login), not after data loads.

### Design
- Use open-design (nexu-io/open-design) for the popup UI styling
- Match the portal's existing theme (dark/light aware)

## Deliverables
1. **Architecture** — exact files to modify, code-level design
2. **State persistence** — localStorage/sessionStorage flag + counter
3. **Popup component** — DOM-based, no framework
4. **Toast notification** — timer + auto-dismiss
5. **Redeploy trigger** — how we detect the choice and patch VPS

## For GLM-5.2
Analyze and provide exact code. Route to Codex for implementation.

## Implementation Order
1. Install open-design design tokens
2. Create popup component
3. Create toast component  
4. Wire into app.js login flow
5. Add listener mechanism for decision
6. Test locally
7. Push, build, deploy
