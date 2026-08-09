# Coming Soon UI — Entry Points Before Login

Client: portal.benjaminsquare.com (Freshworks SE Portal)
Target launch: Aug 16, 5:30 PM IST
Commit: f7c9431 (2.1)

## Entry points to patch

### 1. Login Screen — hide dark mode toggle
- Moon icon (dark mode toggle) on the login screen — hide it
- Currently shows before login — remove it

### 2. Post-login Nav — hide theme from profile menu
- Profile submenu shows "Theme" option — Dark/Light" — remove that option
- Do NOT remove theme persistence from localStorage (keep current preference)

### 3. Dashboard tabs — show Coming Soon pages
Tabs that need Coming Soon overlay:
- Accounts → "My Deals" tab
- Accounts → "My Contacts" tab
- "My Coaching" tab (if exists, check nav)
- "Live" tab

For each:
- Replace the data canvas/content area with a coming-soon page
- The coming-soon page uses this extracted design:
  - Layout from: https://deadlinedemo.vercel.app/seven/
  - Hero/icon image: REPLACE the food-cutting image with https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQzqZF9fmoOKnnC88QNQk7vJLSYcZ6mPmffHIj9PDmpnqXvUWwt3NLqMJ3T&s=10 (Janus/Freshworks logo)
  - Timer: countdown to Aug 16, 2026 5:30 PM IST (5:00 UTC)
  - Copyright: "Copyright Freshworks. All rights reserved."
  - Remove: demo button (right), social media icons, chat widget
  - Remove the food image entirely, replace with the Freshworks icon above
  - The timer shows: DAYS : HOURS : MINUTES : SECONDS (like the original: 12 days 00 hours etc)

### Design Requirements
- Use dembrandt skills for design fidelity
- Seamlessly fit into the existing canvas — no double load (don't show real data first then coming-soon)
- Route detection: for these tabs/views, show coming-soon instead of rendering the real component
- The coming-soon page MUST be inline in the canvas area — not a full page redirect
- Use Freshworks design tokens (from portal's existing CSS)

### Implementation Approach (Option A recommended by GLM)
- Patch the tab rendering in app.js/calls-list-view.js/account-service.js
- When tab matches "my-deals", "my-contacts", "my-coaching", return a ComingSoon component
- ComingSoon is a self-contained HTML component rendered into the canvas div
- Timer uses client-side JavaScript (setInterval, countdown to Aug 16 17:30 IST)

### Files to modify
- web/app.js (tab routing)
- web/components/ (new ComingSoon component)
- Actual file discovery needed — let Codex explore the codebase first

### Do NOT
- Break existing auth/login flow
- Remove theme persistence (keep localStorage value, just hide the UI toggle)
- Remove the real data rendering — just gate it behind the coming-soon check
- Load both real data AND coming-soon in the same frame
