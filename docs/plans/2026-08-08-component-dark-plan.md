# FAILPROOF Fix Plan — Complete dark mode for component CSS (GLM-5.2)

Branch: 2.1 | Repo: /root/lionpath_V2 | Implementer: Codex (gpt-5.5)

## Core strategy (do NOT hardcode dark hexes, do NOT install a package)
Replace surface/background/border/text light hexes with the --dew-* theme variables that
already cascade correctly in dark mode (defined in web/dew-theme.css). This is single-source,
durable, and light mode stays identical because each var resolves to the same light value.

### Master mapping table
| Light hex pattern | Role | Replace with |
|---|---|---|
| #fff / #ffffff | primary card surface | var(--dew-surface) |
| #faf8f4 #fafafa #f9f7f3 #f8f6f1 | subtle tile | var(--dew-surface-subtle) |
| #f5f3ee #f3f0ea #f0ebe2 #efeae0 | faint inset/chart well | var(--dew-surface-faint) |
| #f7f7f5 #f4f2ed | hover surface | var(--surface-hover) |
| #eeece6 #ece9e2 | active surface | var(--surface-active) |
| #ece7de #e8e3d9 #e5e0d6 #e2ddd3 | card border | var(--dew-border) |
| #f0ece4 #eee9e0 | hairline divider | var(--dew-hairline) |
| #d8d3c8 #cfc9bd | input border | var(--dew-input-border) |
| #4a463f #3a3631 #3d3a34 #2f2c27 #2e2b26 | primary text | var(--dew-text) |
| #6b665d #7a7468 #6e695f | secondary text | var(--dew-text-secondary) |
| #9a948a #a8a298 #b5afa3 #9a9384 #a89f8b | muted/placeholder | var(--dew-text-muted) |

Keep as-is (intentional accents): brand greens (#2f6f4e #3d8b5f), ambers (#b8862f #d4a017),
reds (#b03838 #c44848 #b91c1c #dc2626 #991b1b). These get dark overrides only if washed out.

## Files to fix (order)
1. web/precall.css (39 hexes, 0 dark rules) — PRIORITY 1
2. web/call-view.css (43 hexes, 0 dark rules) — PRIORITY 2
3. web/postcall.css (11 hexes, 1 dark rule) — PRIORITY 3
4. web/lifecycle.css (44 hexes, 36 dark rules) — finish partial
5. web/styles.css (29 hexes, 119 dark rules) — finish partial

## File 1: precall.css
- `.prep-v9-card` bg #fff->var(--dew-surface), border #ece7de->var(--dew-border)
- `.prep-v9-card:hover` bg #f7f7f5->var(--surface-hover)
- `.prep-v9-card-title`, `.prep-v9-about` color #4a463f->var(--dew-text)
- `.prep-v9-tile` bg #faf8f4->var(--dew-surface-subtle), border #f0ebe2->var(--dew-border)
- `.prep-v9-tile-label`, `.prep-v9-fact-tile-key` color #9a948a->var(--dew-text-muted)
- `.prep-v9-tile-val`, `.prep-v9-fact-tile-val` color #4a463f->var(--dew-text)
- `.prep-v9-fact-tile` bg->var(--dew-surface-subtle), border->var(--dew-border)
- `.prep-v9-fact-tile-source` color->var(--dew-text-secondary)
- `.prep-v9-news-row` bg->var(--dew-surface), border-bottom->var(--dew-hairline)
- `.prep-v9-news-row:hover`->var(--surface-hover)
- `.prep-v9-news-headline`->var(--dew-text); `.prep-v9-news-source`->var(--dew-text-muted); `.prep-v9-news-date`->var(--dew-text-secondary)
- `.prep-v9-support-item` bg->var(--dew-surface-subtle), border->var(--dew-border); hover->var(--surface-hover); name->var(--dew-text); role->var(--dew-text-secondary)
- `.prep-v9-maturity-bar-track` bg->var(--dew-surface-faint); KEEP fill brand green; label->var(--dew-text-secondary); stage->var(--dew-text)
- `.prep-v9-unknown-item` bg->var(--dew-surface-subtle), border->var(--dew-hairline); text->var(--dew-text); KEEP flag amber
- `.prep-v9-callplan-step` bg->var(--dew-surface), border->var(--dew-border); hover->var(--surface-hover); num KEEP brand green; text->var(--dew-text)
- `.prep-v9-attendee-row` bg->var(--dew-surface), border-bottom->var(--dew-hairline); hover->var(--surface-hover); name->var(--dew-text); title->var(--dew-text-secondary); avatar bg->var(--dew-surface-faint), border->var(--dew-border)
- `.prep-v9-section` bg->var(--dew-surface), border->var(--dew-border); header border-bottom->var(--dew-hairline); title->var(--dew-text); subtitle->var(--dew-text-secondary)

## File 2: call-view.css
- Call timeline: track bg->var(--dew-surface-faint); segments keep accent; labels->var(--dew-text-secondary)
- `.call-transcript` bg->var(--dew-surface), border->var(--dew-hairline)
- `.call-transcript-entry` border-bottom->var(--dew-hairline)
- `.call-transcript-speaker` #4a463f->var(--dew-text); `.call-transcript-time` #9a9384->var(--dew-text-muted); `.call-transcript-text` #3d3a34->var(--dew-text)
- `.call-transcript-text.is-highlight` bg->var(--dew-surface-faint), KEEP amber left-border
- `.call-transcript-search` bg->var(--dew-surface-subtle), border->var(--dew-input-border); placeholder #a89f8b->var(--dew-text-muted)
- Score strip: values->var(--dew-text); labels->var(--dew-text-muted); keep good/warn/bad accent colors
- AI attach callout: bg->var(--dew-surface-subtle), border->var(--dew-border); header->var(--dew-text); body->var(--dew-text-secondary)
- Video facts: labels->var(--dew-text-muted); values->var(--dew-text)
- Quality coach: item border-left->var(--dew-border); tip/warn KEEP amber/red accent borders; text->var(--dew-text-secondary)

## File 3: postcall.css
- `.postcall-result-card` bg->var(--dew-surface), border->var(--dew-border)
- header border-bottom->var(--dew-hairline); title->var(--dew-text); body->var(--dew-text-secondary)
- positive/negative/neutral KEEP accent left-borders
- `.postcall-traction-tile` bg->var(--dew-surface-subtle), border->var(--dew-border); label->var(--dew-text-muted); value->var(--dew-text); delta KEEP green/red
- `.postcall-arr-tile` same pattern; chart track bg->var(--dew-surface-faint); bar KEEP accent green

## Files 4-5: sweep lifecycle.css + styles.css
Same substitution pass on every remaining light surface/background/border/text hex not already
covered by an existing [data-theme="dark"] rule. For existing dark rules that duplicate a token
as a hardcoded hex, replace with the token. Focus: modals, drawers, toasts, tooltips, dropdowns,
lifecycle stages/cards/pills/table/filters.

## Dark overrides ONLY if contrast fails (don't add speculatively)
- `.prep-v9-unknown-badge`, `.call-transcript-text--highlight`, `.call-quality-coach-item--tip`,
  `.postcall-traction-tile-delta--positive/--negative`, `.call-score-strip-value--warn/--bad`
  -> lighter/darker accent tints in dark.

## Anti-regression (MUST all pass)
- No new CSS files, no hardcoded dark hexes for surfaces/text/borders, no !important unless
  removing one, no @media prefers-color-scheme, NO package install, no new deps.
- Light mode unchanged (each --dew-* light value matches the original hex).
- After swap: `grep -rn '#fff\b\|#ffffff\b' web/precall.css web/call-view.css web/postcall.css`
  -> zero matches (except box-shadow/rgba).
- Build passes: npm run build.
- Commit after EACH file (5 commits). Push to origin/2.1 when done.

## Verification (toggle dark, inspect)
- Prep-brief: About the company card NOT pure white, fact tiles subtle, news rows, support stack,
  maturity chart, unknowns, call plan, attendees readable.
- Call view: timeline, transcript, score strip, AI attach callout, video facts readable.
- Postcall: result cards, ARR tile, traction tiles readable.
- Light mode visually identical to before.
