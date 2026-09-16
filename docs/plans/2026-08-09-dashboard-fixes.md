# Dashboard Fix Plan

> **Root causes identified by Gideon.** For GLM-5.2 to decide architecture, then Codex 5.5 to implement.

**Goal:** Fix 2 dashboard bugs — (1) briefs generated KPI showing 0, (2) recent activity items not clickable on first load.

**Architecture:** JS-side fixes in `web/dashboard.js` and partial revert of the signature-guard.

---

## Bug 1: Briefs generated shows 0

**Root cause:** `refreshLaunchpadRemote()` at line ~1590 reads the current DOM `.launch-kpi-value[data-stat="preps"]` textContent as the fallback when remotePreps is null. If the cached snapshot reported 0 (because no stat existed when snapshot was written), the DOM shows 0, and the function reads back 0 instead of recalculating from `loadAllLocalBriefs()`.

**Fix:** Replace the DOM-read fallback with `loadAllLocalBriefs().length`. This is the authoritative local source regardless of what the stale cached snapshot says.

**File:** `web/dashboard.js`
**Exact line:** ~1590-1596

---

## Bug 2: Recent activity items not clickable

**Root cause:** My previous fix added an early-return at `~1890` when `section.dataset.activitySignature === signature` — but this also skips `wireCallLinks()` which attaches per-button `fwClick` and `click` listeners on each `.dash-call-link` element. Without these:
- For `fw-button` rows (main-board calls section), clicks fail because Crayons shadow DOM doesn't bubble `click` events transparently.
- For native `<button>` rows (activity section), the delegated handler at the section level should work, but the timing of rAF-coalesced DOM replacement can race with user interaction.

**Fix 1:** Remove the early-return on signature match — always run the DOM reconciliation path so `wireCallLinks` fires.

**Fix 2:** Move `wireCallLinks` to a separate utility that's callable AFTER DOM updates, called unconditionally at the end of `updateRecentActivitySection`.

**Fix 3:** Use `WEAK REFS` and `IntersectionObserver` pattern to detect when a row was detached mid-interaction (belt-and-suspenders).

**Simple approach (recommended):** Just remove the early-return on signature match. The `updateRecentActivitySection` already handles replacement efficiently — it only replaces rows whose sig doesn't match. The rAF coalescing from the previous fix is sufficient to prevent double renders.

**File:** `web/dashboard.js`

---

## Implementation plan

### Task 1: Fix briefs KPI count

**File:** `web/dashboard.js`

Replace the DOM-read fallback with local briefs count:

```js
// Old (line ~1590-1596):
const prepsCount =
      remotePreps ??
      Number(
        container
          .querySelector('.launch-kpi-value[data-stat="preps"]')
          ?.textContent?.replace(/\s*↻\s*/g, "")
          .trim() || 0,
      );

// New:
const prepsCount =
      remotePreps ??
      loadAllLocalBriefs().length;
```

And at `renderSeLaunchpadOnce` (~2086), ensure local count takes priority:

```js
// Old:
const prepsCount = renderMetrics?.prepsCount ?? loadAllLocalBriefs().length;

// New: always prefer local data over stale cached snapshot
const prepsCount = loadAllLocalBriefs().length || renderMetrics?.prepsCount || 0;
```

### Task 2: Remove activity signature early-return

**File:** `web/dashboard.js`

Remove the early-return block:

```js
// Remove these ~4 lines at ~1890:
// If everything is identical, skip all DOM work — eliminates flicker
// from parallel Firestore subscriptions firing the same data in
// separate microtask boundaries.
if (section.dataset.activitySignature === signature) return;
```

Keep the `section.dataset.activitySignature = signature` assignment (after the removal) — it's used for debug tracking but shouldn't short-circuit the render.

### Task 3: Always call wireCallLinks after DOM updates

**File:** `web/dashboard.js`

Ensure `wireCallLinks` runs at the END of `updateRecentActivitySection` regardless of whether rows were changed:

```js
// Keep this block (at ~1969-1972) but move it so it runs unconditionally
const currentOpts = section._recentActivityOpts;
if (currentOpts && typeof currentOpts.onOpenCall === "function") {
  wireCallLinks(section, currentOpts.onOpenCall);
}
```

### Verification

1. Build: `npm run build` inside `web/`
2. Deploy: commit + push to 2.1, then `deploy/vps/upgrade-now.sh`
3. Hard refresh portal
4. Check: briefs KPI shows correct non-zero count
5. Check: clicking any activity row opens the correct brief or call
6. Check: view-all button still works
