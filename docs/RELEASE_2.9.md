# Release 2.9 — Pre-call UI (Know your Customer)

**Base:** `2.0.8.1-merge` @ `930b8d9`  
**Branch:** `2.9`  
**Remote:** `antony` → `github.com/antonyanbu25/lionpath_V2`  
**Date:** 2026-08-03  
**Tab affected:** Know your Customer (precall v9 layout)

Use this file as the branch reference — everything shipped in `2.9` for the boss-annotated pre-call UI is documented here.

---

## Summary

Release 2.9 completes the **Know your Customer** wireframe feedback from five annotated screenshots. Most items were already implemented on `2.0.8.1-merge`; this release adds the last two UI fixes and bumps the precall cache version.

---

## New in 2.9 (this release)

| Change | Why | File(s) |
|--------|-----|---------|
| **Removed "Tech stack & signals" accordion** from Know tab | Duplicated support stack + discovery kit — boss flagged it as repeating | `web/precall-brief-v9.js` |
| **DISC grid only for LinkedIn-enriched profiles** | When multiple contacts exist but only one has a LinkedIn PDF, empty DISC grids appeared on unknown seats | `web/precall-brief-v9.js` `attendeeRow()` |
| **Cache-bust precall CSS** | Force browsers/VPS to load updated markup | `web/index.html` → `precall.css?v=2.9` |
| **Render tests updated** | Lock in new behaviour | `web/scripts/test-precall-render.mjs` |

### DISC / attendee behaviour (2.9)

- **LinkedIn PDF attached** (or email matched to an uploaded PDF): full attendee row — DISC quadrant, summary, Do/Don't, competitor touchpoints.
- **No LinkedIn**: thin row only — name, role (or email fallback), prompt to attach a PDF. No DISC grid, no Do/Don't column.
- **Kaia/Zoom-only reads** are still stored in the brief payload but are **not shown** in the UI unless a LinkedIn PDF is attached for that seat.

### Know tab section order (after 2.9)

1. AI banner + "How to read this" legend  
2. About the company | Recent news  
3. ICP fitment | How big is this fish?  
4. Where they sit versus their industry  
5. Their support stack  
6. What we could not find  
7. Who is in the room  
8. Support agent JD (if found)  
9. Discovery kit · ask this | Likely pain points  
10. Research extras  

*(Tech stack & signals accordion removed — was between JD and Discovery kit.)*

---

## Inherited from 2.0.8.1-merge (included in 2.9, no extra commit)

These were requested in the same annotation set and are already on the base branch:

### Image 1 — Attendees

| Item | Status |
|------|--------|
| Replace **Ask / Watch / Match** with **Do / Don't** | Done |
| Remove repeating **Tech stack & signals** header | Done in 2.9 commit |

### Image 2 — Industry benchmark & support stack

| Item | Status |
|------|--------|
| Fixed maturity axes: **Channel coverage**, **Routing**, **Reporting & analytics**, **AI adoption** | Done (`worker/src/schema.ts` `FIT_LABELS`) |
| Parameters no longer change per brief | Done (`worker/src/word-limits.ts` `normalizePrepOutput`) |
| Remove **GAP** text column | Done — gap shown as shaded band only |
| Fixed **Channels in** chips: Email, Chat, Voice, Social, WhatsApp, Self-serve | Done (`STACK_CHANNELS`) |
| No dynamic channel prose ("Digital banking", "Evaluating AI Agent") | Done |
| Remove **Freshworks consolidation** tan banner | Done — only thin-incumbent prompt when platform unknown |

### Image 3 — About the company

| Item | Status |
|------|--------|
| Single **INPUT** badge per fact tile (no duplicates) | Done |
| **S#** citation format instead of literal "Orchestrator" | Done (`prep-source-canon.js`, worker canonicalizer) |
| **Recent news** from grounded company-news search, not company context | Done (`worker/src/prep/company-news.ts`) |
| **ICP fitment** as standalone tile (not inside About) | Done |

### Image 4 — Unknowns & DISC

| Item | Status |
|------|--------|
| Keep **+ / Add all** on "What we could not find" (add-to-kit is wired) | Done (`web/precall.js`) |
| DISC only for LinkedIn profiles | Done in 2.9 commit |

### Image 5 — Fixed parameters

| Item | Status |
|------|--------|
| No dynamic sublabels under maturity rows ("Digital-first", etc.) | Done |

---

## Files touched in 2.9 commit

```
web/precall-brief-v9.js          — remove signals accordion; LinkedIn-only DISC gate
web/scripts/test-precall-render.mjs — updated assertions (65 checks)
web/index.html                   — precall.css?v=2.9
docs/RELEASE_2.9.md              — this file
```

### Key code references

- Attendee rendering: `web/precall-brief-v9.js` → `attendeeRow()`, `renderAttendees()`
- Know tab layout: `web/precall-brief-v9.js` → `renderKnowTab()`
- Fixed fit axes: `worker/src/schema.ts` → `FIT_LABELS`
- Fit normalization: `worker/src/word-limits.ts` → `normalizePrepOutput()`
- Add gap to discovery kit: `web/precall.js` → `wireTabInteractions()`

---

## Validation

```powershell
cd web
node scripts/test-precall-render.mjs    # 65 checks
node scripts/test-prep-source-canon.mjs
```

Worker fit-axis normalization (optional):

```powershell
cd worker
npm run test:prep-normalize   # if script exists; else worker/scripts/test-prep-normalize.ts
```

Manual smoke:

1. Generate a brief with **one LinkedIn PDF** and **two prospect emails** — second seat should be thin (no DISC).
2. Confirm Know tab has **no** "Tech stack & signals" accordion.
3. Confirm maturity chart shows four fixed axes with no GAP column.
4. Confirm support stack shows six fixed channel chips (verified or dotted).

---

## Deploy (VPS / antony git)

```bash
cd /opt/se-singha-paathai
git fetch antony 2.9
git checkout 2.9
git pull antony 2.9
cd deploy/vps && bash update.sh
```

Verify precall CSS version in served HTML:

```bash
curl -sf "https://portal.benjaminsquare.com/" | grep precall.css
# expect: precall.css?v=2.9
```

---

## Upgrade path

| From | To | Notes |
|------|-----|-------|
| `2.0.7.4` (old portal) | `2.9` | Full precall UI overhaul — all annotation items |
| `2.0.8.1-merge` | `2.9` | Small delta: signals accordion removed, DISC gate tightened, cache bump |

---

## Known behaviour changes

- **Cached briefs in localStorage**: Re-opening an old brief may still show prior HTML until re-rendered; re-run the brief for fresh attendee rows.
- **Kaia-only DISC**: Previously shown when `discHint.source` was `kaia` or `zoom`; now hidden unless LinkedIn PDF is attached for that seat.
- **Signals data**: Still in JSON (`prep.signals[]`); only the duplicate Know-tab accordion UI was removed.

---

## Commits on branch 2.9

```
3a02f4b Release 2.9 precall UI: remove duplicate tech-stack section and gate DISC to LinkedIn profiles.
(+ docs commit after this README is added)
```
