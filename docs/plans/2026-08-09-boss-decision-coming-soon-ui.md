# Boss Decision Coming Soon UI — Implementation Plan

> **For Hermes:** Route to GLM-5.2 (architecture) then Codex (implementation) via AgentRadio.

**Goal:** Replace the fake 30s-deploy countdown in the boss-decision popup with immediate local UI application, then route real implementation to Codex for a push to 2.1 with a polished, Pulkit-inspired design.

**Architecture:** Three-phase:
1. **Phase 1 (Gideon):** Fix boss-decision popup to immediately apply locally (no fake deploy)
2. **Phase 2 (GLM → Codex via AgentRadio):** Architecture decisions then polished implementation
3. **Phase 3 (Codex):** Push to 2.1 branch, deploy on VPS

**Tech Stack:** Vanilla JS (no framework), CSS custom properties, localStorage for cache, git 2.1 branch

---

### Phase 1: Fix Boss Decision Popup (Gideon does this directly — it's a bug fix)

**Objective:** Stop the fake 30s countdown. Instead: store choice in localStorage, apply immediately via CSS class on `<body>`, and show a simple confirmation. Then inform Gideon to start the AgentRadio pipeline.

**Files:**
- Modify: `web/components/boss-decision/popup.js` — change Confirm behavior
- Modify: `web/components/boss-decision/state.js` — add applyChoice function
- Modify: `web/components/boss-decision/redeploy.js` — replace fake deploy with local apply
- Modify: `web/components/boss-decision/styles.css` — polish popup design
- Add: `web/components/coming-soon-state.css` — CSS for "hidden icons" mode
- Add: `web/components/coming-soon-state.js` — JS to apply stored preference on load

**Key changes:**
1. In `state.js`: add `applyChoice(choice)` — sets body class `cs-timer` or `cs-hidden`
2. In `redeploy.js`: replace countdown with instant apply, then notify a callback
3. Remove the 30s toast countdown — show a "Preference saved!" toast instead
4. On page load, check localStorage and re-apply the style

---

### Phase 2: GLM-5.2 Architecture Decisions (via AgentRadio)

**Topic:**
- Design language for Coming Soon pages — inspired by Pulkit's landing pages (Forma, Dot Daily Calm, Pelmatech)
- Should match Janus 2.0's black/white transparent logo theme
- Determine: glassmorphism, backdrop-blur, subtle animations, bold typography

---

### Phase 3: Codex Implementation + Push (via AgentRadio)

**What Codex needs to build:**
1. Polished Coming Soon page UI replacing the basic one in `coming-soon.js`
2. "Hidden icons" mode that removes 4 nav items (accounts, deals, contacts, coaching) and shows placeholder text
3. "Timer mode" with countdown styled like Pulkit's designs — glassmorphic timeboxes, subtle animations
4. Both modes persist via localStorage  
5. Push to 2.1 branch, deploy on VPS

**Reference designs:**
- Forma Video Landing: full-screen video, glassy backdrop-blur, bold headline
- Dot Daily Calm: floating pill navbar, typewriter effect, minimalist
- Mentality Landing: cinematic glassmorphism, gradient masks
- Pelmatech: dark hero, blurred elements, animated headings

---

### Phase 4: Deploy

- Push to 2.1 branch on GitHub
- SSH to VPS, pull, rebuild, restart
- Verify on portal.benjaminsquare.com
