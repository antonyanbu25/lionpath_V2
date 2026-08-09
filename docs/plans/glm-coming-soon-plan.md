# GLM-5.2 Architectural Plan — SE Portal Coming Soon Launch

## Pre-Implementation Recon (Codex must run first)

Since I cannot read the repo directly, Codex must locate these anchors before patching. Below are the **discovery commands** and the **assumed file/line map** based on the described architecture (vanilla JS, `#call-panel` / `#account-panel` / `#dash-panel` canvas divs).

```bash
# 1. Find the switchView / tab router
grep -rn "switchView\|function switchView\|window.switchView" web/ --include="*.js" | head -20

# 2. Find login screen moon icon
grep -rn "moon\|dark-mode\|theme-toggle\|toggleTheme" web/ --include="*.html" --include="*.js" --include="*.css" | head -20

# 3. Find profile submenu Theme option
grep -rn "Theme.*Dark\|data-theme-option\|profile.*menu\|profile-dropdown" web/ --include="*.html" --include="*.js" | head -20

# 4. Find tab definitions
grep -rn "my-deals\|my-contacts\|my-coaching\|live" web/ --include="*.js" --include="*.html" | head -30

# 5. Find canvas panels
grep -rn 'id="call-panel"\|id="account-panel"\|id="dash-panel"' web/
```

---

## Part 1 — Hide Dark Mode Moon Icon (Login Screen)

**Target:** `web/index.html` (or `web/login.html` / `web/views/login.html` — Codex to confirm)

**Strategy:** Add a CSS rule scoped to the login view that hides the toggle. This is the safest patch — no JS flow changes.

**Patch (append to `web/styles.css` or the main stylesheet):**

```css
/* === SE Portal Launch Patch: Hide theme toggle pre-login === */
body.login-view .theme-toggle,
body.login-view [data-theme-toggle],
body.login-view .moon-icon,
body.login-view .dark-mode-toggle,
.login-screen .theme-toggle,
.login-screen [data-theme-toggle],
.login-screen .moon-icon {
  display: none !important;
}
/* === End patch === */
```

**If the toggle is rendered by JS into the login view**, also add this guard in the login render function (Codex to find — typically `web/app.js` or `web/login-view.js`):

```javascript
// Inside renderLogin() or showLogin() — AFTER the DOM is built
const loginThemeToggle = document.querySelector('.login-screen .theme-toggle, .login-screen [data-theme-toggle]');
if (loginThemeToggle) loginThemeToggle.style.display = 'none';
```

**Do NOT touch:** `localStorage.getItem('theme')`, `applyTheme()`, or any persistence logic.

---

## Part 2 — Hide Theme Option from Profile Submenu

**Target:** `web/index.html` (profile dropdown markup) or `web/components/profile-menu.js`

**Strategy:** Hide via CSS first (zero JS risk). If the menu is JS-rendered, also short-circuit the render.

**CSS patch (append to main stylesheet):**

```css
/* === SE Portal Launch Patch: Hide Theme option in profile menu === */
.profile-menu [data-action="theme"],
.profile-menu [data-menu-item="theme"],
.profile-dropdown .theme-option,
.profile-dropdown li.theme,
#profile-menu li[data-key="theme"],
#profile-menu .theme-row {
  display: none !important;
}
/* === End patch === */
```

**JS guard (if menu is dynamically rendered)** — find the profile menu builder (likely `web/components/profile-menu.js` or inline in `web/app.js`):

```javascript
// Locate the array/loop that builds profile menu items, e.g.:
// const profileItems = [
//   { key: 'profile', label: 'My Profile' },
//   { key: 'theme', label: 'Theme — Dark/Light' },   <-- filter this
//   { key: 'logout', label: 'Sign Out' }
// ];

// PATCH: filter out the theme item before render
const profileItems = originalProfileItems.filter(item => item.key !== 'theme' && item.label !== 'Theme');
```

**Keep intact:** `localStorage.setItem('theme', ...)`, the `applyTheme()` function, and the body class that toggles `dark` / `light`.

---

## Part 3 — ComingSoon Component (Full Runnable Code)

**New file:** `web/components/coming-soon.js`

```javascript
/**
 * ComingSoon — self-contained vanilla JS component.
 * Renders into any canvas div. Pure DOM API. No deps.
 *
 * Usage:
 *   ComingSoon.mount(document.getElementById('dash-panel'));
 *   ComingSoon.unmount();
 */
(function (global) {
  'use strict';

  // === CONFIG ===
  // Aug 16, 2026, 5:30 PM IST = 12:00 UTC? No — IST is UTC+5:30, so 5:30 PM IST = 12:00 UTC.
  // Use ISO with explicit offset to be safe.
  const TARGET_ISO = '2026-08-16T17:30:00+05:30';
  const TARGET_DATE = new Date(TARGET_ISO).getTime();

  const FRESHWORKS_ICON_URL =
    'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQzqZF9fmoOKnnC88QNQk7vJLSYcZ6mPmffHIj9PDmpnqXvUWwt3NLqMJ3T&s=10';

  const COPYRIGHT_TEXT = 'Copyright Freshworks. All rights reserved.';

  // === STATE ===
  let intervalId = null;
  let rootEl = null;
  let valueEls = {};

  // === HELPERS ===
  function pad(n) {
    return String(Math.max(0, n)).padStart(2, '0');
  }

  function getTimeRemaining() {
    const now = Date.now();
    const diff = TARGET_DATE - now;
    if (diff <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return { days, hours, minutes, seconds, expired: false };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildTimeUnit(unitKey, value, label) {
    const unit = el('div', 'cs-time-unit');
    unit.setAttribute('data-unit', unitKey);

    const valueNode = el('div', 'cs-time-value', pad(value));
    valueNode.setAttribute('data-role', 'value');

    const labelNode = el('div', 'cs-time-label', label);

    unit.appendChild(valueNode);
    unit.appendChild(labelNode);

    // Stash reference for fast updates
    valueEls[unitKey] = valueNode;

    return unit;
  }

  function buildSeparator() {
    return el('div', 'cs-time-sep', ':');
  }

  function build() {
    valueEls = {};

    const container = el('div', 'cs-container');
    container.setAttribute('data-coming-soon', 'true');

    // Ambient glow layer
    const glow = el('div', 'cs-glow');
    container.appendChild(glow);

    const inner = el('div', 'cs-inner');

    // Logo
    const logo = document.createElement('img');
    logo.className = 'cs-logo';
    logo.src = FRESHWORKS_ICON_URL;
    logo.alt = 'Freshworks';
    logo.width = 96;
    logo.height = 96;
    logo.setAttribute('loading', 'eager');
    logo.setAttribute('referrerpolicy', 'no-referrer');
    inner.appendChild(logo);

    // Eyebrow
    const eyebrow = el('div', 'cs-eyebrow', 'Freshworks SE Portal');
    inner.appendChild(eyebrow);

    // Heading
    const heading = el('h1', 'cs-heading', 'Coming Soon');
    inner.appendChild(heading);

    // Sub
    const sub = el('p', 'cs-sub',
      'We\u2019re putting the finishing touches on this experience.');
    inner.appendChild(sub);

    // Timer
    const t = getTimeRemaining();
    const timer = el('div', 'cs-timer');
    timer.appendChild(buildTimeUnit('days', t.days, 'Days'));
    timer.appendChild(buildSeparator());
    timer.appendChild(buildTimeUnit('hours', t.hours, 'Hours'));
    timer.appendChild(buildSeparator());
    timer.appendChild(buildTimeUnit('minutes', t.minutes, 'Minutes'));
    timer.appendChild(buildSeparator());
    timer.appendChild(buildTimeUnit('seconds', t.seconds, 'Seconds'));
    inner.appendChild(timer);

    // Footer
    const footer = el('div', 'cs-footer', COPYRIGHT_TEXT);
    inner.appendChild(footer);

    container.appendChild(inner);
    return container;
  }

  function tick() {
    const t = getTimeRemaining();
    if (valueEls.days) valueEls.days.textContent = pad(t.days);
    if (valueEls.hours) valueEls.hours.textContent = pad(t.hours);
    if (valueEls.minutes) valueEls.minutes.textContent = pad(t.minutes);
    if (valueEls.seconds) valueEls.seconds.textContent = pad(t.seconds);
  }

  function mount(target) {
    if (!target) {
      console.warn('[ComingSoon] mount() called with null target');
      return;
    }
    unmount();
    rootEl = build();
    // Wipe target — no double render
    target.innerHTML = '';
    target.appendChild(rootEl);
    tick();
    intervalId = setInterval(tick, 1000);
  }

  function unmount() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (rootEl && rootEl.parentNode) {
      rootEl.parentNode.removeChild(rootEl);
    }
    rootEl = null;
    valueEls = {};
  }

  global.ComingSoon = { mount, unmount };
})(window);
```

**New file:** `web/components/coming-soon.css`

```css
/* === ComingSoon component — SE Portal === */

.cs-container {
  position: relative;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 24px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  color: #ffffff;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, #1f2440 0%, transparent 60%),
    radial-gradient(ellipse 60% 50% at 50% 100%, #14182b 0%, transparent 60%),
    linear-gradient(180deg, #0b0d1a 0%, #07080f 100%);
}

/* Light theme override — portal may flip body to .light */
body.light .cs-container {
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, #eef2ff 0%, transparent 60%),
    radial-gradient(ellipse 60% 50% at 50% 100%, #e0e7ff 0%, transparent 60%),
    linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  color: #0f172a;
}

.cs-glow {
  position: absolute;
  inset: -50%;
  pointer-events: none;
  background:
    radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.18) 0%, transparent 35%),
    radial-gradient(circle at 75% 75%, rgba(236, 72, 153, 0.10) 0%, transparent 35%);
  filter: blur(20px);
  z-index: 0;
}

.cs-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 720px;
  text-align: center;
}

.cs-logo {
  width: 96px;
  height: 96px;
  border-radius: 22px;
  object-fit: cover;
  background: #ffffff;
  padding: 8px;
  box-sizing: border-box;
  box-shadow:
    0 18px 50px rgba(99, 102, 241, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.08);
}

.cs-eyebrow {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(165, 180, 252, 0.9);
}
body.light .cs-eyebrow { color: #4f46e5; }

.cs-heading {
  margin: 0;
  font-size: clamp(40px, 6vw, 64px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  background: linear-gradient(135deg, #ffffff 0%, #a5b4fc 60%, #818cf8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
body.light .cs-heading {
  background: linear-gradient(135deg, #1e1b4b 0%, #4f46e5 60%, #7c3aed 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.cs-sub {
  margin: 0;
  font-size: 17px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.62);
  max-width: 480px;
}
body.light .cs-sub { color: #475569; }

.cs-timer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.cs-time-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 92px;
  padding: 18px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
body.light .cs-time-unit {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
}

.cs-time-value {
  font-size: clamp(28px, 4vw, 42px);
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
}
body.light .cs-time-value { color: #0f172a; }

.cs-time-label {
  margin-top: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}
body.light .cs-time-label { color: #64748b; }

.cs-time-sep {
  font-size: 32px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.25);
  line-height: 1;
}
body.light .cs-time-sep { color: rgba(15, 23, 42, 0.2); }

.cs-footer {
  margin-top: 28px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}
body.light .cs-footer { color: #94a3b8; }

@media (max-width: 560px) {
  .cs-time-unit { min-width: 72px; padding: 14px 10px; }
  .cs-time-sep { font-size: 24px; }
  .cs-timer { gap: 6px; }
}
```

---

## Part 4 — Tab Interception Logic

**Target file:** `web/app.js` (Codex to confirm — could be `web/router.js` or `web/views.js`)

**Strategy:** Wrap the existing `switchView` (or equivalent) so that for the four gated tabs, we render `ComingSoon` into the appropriate canvas div **before** any data fetch fires. No flicker.

**Patch — append to `web/app.js` (or wherever the router lives), AFTER the original `switchView` is defined:**

```javascript
/* === SE Portal Launch Patch: Coming Soon interception === */
(function () {
  'use strict';

  // Wait until ComingSoon + switchView are both available
  function init() {
    if (typeof window.ComingSoon === 'undefined') {
      return setTimeout(init, 50);
    }
    if (typeof window.switchView !== 'function') {
      // Try alternate names
      const candidates = ['switchView', 'showView', 'navigate', 'setView', 'selectTab'];
      for (const name of candidates) {
        if (typeof window[name] === 'function') {
          window.__csOriginalSwitchView = window[name];
          window.__csSwitchViewName = name;
          break;
        }
      }
      if (!window.__csOriginalSwitchView) {
        return setTimeout(init, 50);
      }
    } else {
      window.__csOriginalSwitchView = window.switchView;
      window.__csSwitchViewName = 'switchView';
    }

    const COMING_SOON_TABS = new Set([
      'my-deals',
      'my-contacts',
      'my-coaching',
      'live'
    ]);

    // Map tab -> canvas panel id. Codex: confirm these IDs exist in index.html.
    // If panel IDs differ, adjust here.
    const TAB_PANEL_MAP = {
      'my-deals':     'account-panel',
      'my-contacts':  'account-panel',
      'my-coaching':  'dash-panel',
      'live':         'call-panel'
    };

    function hideAllPanels() {
      ['call-panel', 'account-panel', 'dash-panel'].forEach(id => {
        const p = document.getElementById(id);
        if (p) p.style.display = 'none';
      });
    }

    function showPanel(id) {
      const p = document.getElementById(id);
      if (!p) {
        console.warn('[ComingSoon] Panel not found:', id);
        return null;
      }
      p.style.display = 'block';
      return p;
    }

    function renderComingSoon(tabKey) {
      const panelId = TAB_PANEL_MAP[tabKey] || 'dash-panel';
      hideAllPanels();
      const panel = showPanel(panelId);
      if (panel) {
        // Clear any in-flight state, then mount
        panel.innerHTML = '';
        window.ComingSoon.mount(panel);
      }
    }

    // Override
    const original = window.__csOriginalSwitchView;
    const origName = window.__csSwitchViewName;

    window[origName] = function (view) {
      // Normalize: accept string or event
      let key = view;
      if (typeof view === 'object' && view) {
        key = view.view || view.tab || view.target || view.id;
      }
      key = String(key || '').toLowerCase().trim();

      if (COMING_SOON_TABS.has(key)) {
        // Intercept BEFORE any data load
        try {
          renderComingSoon(key);
        } catch (e) {
          console.error('[ComingSoon] render error:', e);
        }
        return; // do NOT call original
      }

      // Non-gated tab: ensure ComingSoon is unmounted, then proceed
      try { window.ComingSoon.unmount(); } catch (_) {}
      return original.apply(this, arguments);
    };

    console.log('[SE Portal] Coming Soon interception active for:', Array.from(COMING_SOON_TABS));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
/* === End patch === */
```

**Also add to `web/index.html` `<head>` (or before `</body>`):**

```html
<link rel="stylesheet" href="components/coming-soon.css">
<script src="components/coming-soon.js"></script>
```

Make sure these load **before** `app.js` so `window.ComingSoon` is defined when the patch runs. If `app.js` loads first, the patch self-polls (see `init()` retry loop).

---

## Part 5 — Sub-tab Interception (Accounts → My Deals / My Contacts)

If "My Deals" and "My Contacts" are sub-tabs rendered by a separate function (e.g., `switchAccountTab()` in `web/account-service.js` or `web/calls-list-view.js`), apply the same wrap pattern:

```javascript
/* === Sub-tab interception for Accounts sub-tabs === */
(function () {
  'use strict';

  function init() {
    if (typeof window.ComingSoon === 'undefined') return setTimeout(init, 50);

    // Codex: find the actual sub-tab switcher. Common names:
    const candidates = ['switchAccountTab', 'switchAccountView', 'showAccountTab', 'renderAccountTab'];
    let orig = null, name = null;
    for (const n of candidates) {
      if (typeof window[n] === 'function') { orig = window[n]; name = n; break; }
    }
    if (!orig) return; // no sub-tab router — main switchView patch handles it

    const GATED = new Set(['my-deals', 'my-contacts', 'deals', 'contacts']);

    window[name] = function (tab) {
      const key = String(tab || '').toLowerCase().trim();
      if (GATED.has(key)) {
        const panel = document.getElementById('account-panel');
        if (panel) {
          panel.style.display = 'block';
          panel.innerHTML = '';
          window.ComingSoon.mount(panel);
        }
        return;
      }
      try { window.ComingSoon.unmount(); } catch (_) {}
      return orig.apply(this, arguments);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

---

## Implementation Order (Codex execution sequence)

1. **Recon** — run the grep commands above; record actual file paths and line numbers.
2. **Create** `web/components/coming-soon.js` and `web/components/coming-soon.css` (Parts 3).
3. **Wire** the two new files into `web/index.html` `<head>` / before `</body>`.
4. **Patch** `web/app.js` with the switchView wrap (Part 4).
5. **Patch** the Accounts sub-tab router if separate (Part 5).
6. **Append** CSS hide rules for login moon icon (Part 1) and profile theme option (Part 2) to the main stylesheet.
7. **Smoke test** in this order:
   - Login screen — confirm moon icon gone, theme still persists across reload.
   - Post-login — profile menu has no Theme row.
   - Click each gated tab — confirm ComingSoon renders, no data flash, timer ticks.
   - Click a non-gated tab — confirm ComingSoon unmounts and real data renders.
8. **Verify** no console errors, no double-mount, no leaked `setInterval` (check `ComingSoon.unmount()` clears it).

---

## Risk Register

| Risk | Mitigation |
|---|---|
| `switchView` name differs | Patch polls multiple candidate names; falls back gracefully |
| Panel IDs differ from `call-panel` / `account-panel` / `dash-panel` | Codex confirms via grep; adjust `TAB_PANEL_MAP` |
| Theme toggle is rendered by JS after CSS load | JS guard in `renderLogin()` added as backup |
| `ComingSoon` script loads after `app.js` | Patch self-polls every 50ms until `window.ComingSoon` exists |
| Double render (real data + coming soon) | `panel.innerHTML = ''` before mount; `return` before original `switchView` |
| Timer drift across timezones | Target stored as ISO with `+05:30` offset; `getTime()` is absolute |
| Interval leak on tab switch | `unmount()` clears interval; called in non-gated branch |

---

## Acceptance Criteria

- [ ] Login screen has no moon/dark-mode toggle visible.
- [ ] Profile dropdown has no "Theme" option.
- [ ] `localStorage.theme` still applies on reload (preference persists).
- [ ] Clicking **My Deals**, **My Contacts**, **My Coaching**, **Live** shows the ComingSoon page inline in the canvas — no full-page redirect, no data flash.
- [ ] Timer counts down to **Aug 16, 2026 17:30 IST** and updates every second.
- [ ] Freshworks Janus icon shows as the hero image (not the food image).
- [ ] No demo button, no social icons, no chat