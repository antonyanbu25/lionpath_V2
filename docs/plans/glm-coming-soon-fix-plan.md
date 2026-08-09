# Coming Soon UI Fix Plan

## APPROACH: **B — Fix existing separate files**

Keep the component in `web/components/coming-soon.js` + `coming-soon.css`. They're already separate, loaded independently, and referenced by `app.js`. No reason to inline or inject. Just patch the three files.

---

## Fix 1: Remove `calls` from Coming Soon tabs

**File:** `web/app.js`

**Change:** Delete the `calls` line from `COMING_SOON_VIEWS`:

```js
// BEFORE
const COMING_SOON_VIEWS = {
  deals: { view: "deals", panelId: "deal-panel", navView: "deals", title: "My deals", hash: "deals" },
  contacts: { view: "contacts", panelId: "contacts-panel", navView: "contacts", title: "My contacts", hash: "contacts" },
  coaching: { view: "coaching", panelId: "coaching-panel", navView: "coaching", title: "My coaching", hash: "coaching" },
  calls: { view: "calls", panelId: "call-panel", navView: "calls", title: "Activities", hash: "calls" },
};

// AFTER
const COMING_SOON_VIEWS = {
  deals: { view: "deals", panelId: "deal-panel", navView: "deals", title: "My deals", hash: "deals" },
  contacts: { view: "contacts", panelId: "contacts-panel", navView: "contacts", title: "My contacts", hash: "contacts" },
  coaching: { view: "coaching", panelId: "coaching-panel", navView: "coaching", title: "My coaching", hash: "coaching" },
};
```

**Also search app.js for any guard like:**
```js
if (COMING_SOON_VIEWS[view]) { ... }
```
This will now naturally return `undefined` for `calls`, so the Activities tab renders normally. No other changes needed — the lookup pattern handles it.

---

## Fix 2: Product name "Freshworks SE Portal" → "Janus"

**File:** `web/components/coming-soon.js`

```js
// BEFORE (line ~37)
<p class="coming-soon-product">Freshworks SE Portal</p>

// AFTER
<p class="coming-soon-product">Janus</p>
```

Also update the footer text:

```js
// BEFORE
<footer class="coming-soon-footer">Copyright Freshworks. All rights reserved.</footer>

// AFTER
<footer class="coming-soon-footer">Janus — Copyright Freshworks. All rights reserved.</footer>
```

And update the logo alt text:

```js
// BEFORE
<img class="coming-soon-logo" src="${LOGO_URL}" alt="Freshworks logo" width="96" height="96" />

// AFTER
<img class="coming-soon-logo" src="${LOGO_URL}" alt="Janus logo" width="96" height="96" />
```

---

## Fix 3: Theme colors — purple → blue/indigo

**File:** `web/components/coming-soon.css`

### Color mapping table

| Token | Old (purple) | New (blue/indigo) | Role |
|-------|-------------|-------------------|------|
| Dark bg base | `#080817` | `#0f172a` | slate-900 |
| Dark bg mid | `#171033` | `#1e1b4b` | indigo-950 |
| Dark bg end | `#2