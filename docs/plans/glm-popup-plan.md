# One-Time Boss Decision UI — Architecture Plan

## 1. Architecture Overview

### Flow Diagram
```
Login (completeFirebaseLogin)
  ↓
Session established (setSession enriched)
  ↓
[NEW] Gate: shouldShowBossPopup()?  ←── counter > 0 AND no decision flag
  ├─ NO  → proceed to render
  └─ YES → mount overlay + popup (BEFORE first paint)
            ↓
          Popup 1: choice (timer | hidden)
            ↓
          Popup 2: confirm redeploy (~30s)
            ├─ Cancel → close, do NOT decrement counter (still 1)
            └─ Continue → recordDecision(choice)
                          ↓
                        POST /api/boss-decision { choice }
                          ↓
                        Toast: "Updates being applied. Estimated time: 30s" (countdown)
                          ↓
                        Poll /api/boss-decision/status
                          ↓
                        Toast: "Done!" → reload page
```

### Files to Create / Modify

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `index.html` | MODIFY | Add open-design CDN, mount points, theme attr |
| 2 | `src/boss-decision/state.js` | CREATE | Counter + flag persistence |
| 3 | `src/boss-decision/popup.js` | CREATE | Pure-DOM popup component |
| 4 | `src/boss-decision/toast.js` | CREATE | Toast with countdown timer |
| 5 | `src/boss-decision/redeploy.js` | CREATE | API client + status polling |
| 6 | `src/boss-decision/styles.css` | CREATE | open-design token-based styles |
| 7 | `src/app.js` | MODIFY | Hook into `completeFirebaseLogin` |
| 8 | `src/coming-soon-config.js`