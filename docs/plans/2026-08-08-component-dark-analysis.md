# Analysis — Dark mode incomplete: component CSS (precall/postcall/call-view) never covered

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2

## User's report
- "About the company" section is so white (in dark mode).
- Still not fully optimized — "some elements / little tiles are poorly optimized for dark mode."

## Root cause — the dark-mode pass missed the per-view component CSS files

The earlier dark-mode pass (`ea8a281`) added ~287 lines of `[data-theme="dark"]` overrides to
`web/styles.css` and `web/lifecycle.css`, plus `--surface-hover`/`--surface-active` tokens to
`web/dew-theme.css`. But the portal renders most content through SEPARATE per-view stylesheets
that have hardcoded light hexes and ZERO or minimal dark overrides.

Measured (web/*.css):

| file            | light hexes | [data-theme="dark"] rules |
|-----------------|-------------|---------------------------|
| styles.css      | 29          | 119 (well covered)        |
| lifecycle.css   | 44          | 36 (partial)              |
| dew-theme.css   | 16          | 1 (token defs)            |
| call-view.css   | 43          | 0  ← MISSED entirely      |
| precall.css     | 39          | 0  ← MISSED entirely      |
| postcall.css    | 11          | 1  ← nearly missed        |

Concrete example: `web/precall.css` `.prep-v9-card { background:#fff; border:#ece7de; }`
(line 2571) and `.prep-v9-tile { background:#faf8f4; border:#f0ebe2; }` (line 2586) hardcode
white/cream. The "About the company" card is one of these `.prep-v9-card`/`.prep-v9-tile`
elements → pure white in dark mode. Text colors like `.prep-v9-about { color:#4a463f }` (line
2577) are dark-on-light and unreadable on a dark card.

## Fix strategy — convert to theme variables, not hardcoded dark hexes

The durable, "easier for 5.5" fix is to REPLACE surface/background/border/text hardcodes with
the theme variables that already cascade correctly in dark mode:
- Surfaces: `var(--dew-surface)`, `var(--dew-surface-subtle)`, `var(--dew-surface-faint)`,
  `var(--surface-hover)`, `var(--surface-active)`
- Text: `var(--dew-text)`, `var(--dew-text-secondary)`, `var(--dew-text-muted)`
- Borders: `var(--dew-border)`, `var(--dew-hairline)`, `var(--dew-input-border)`

Do NOT hardcode dark hexes for every element — that doubles maintenance and is what "install a
dark package" would do badly. Instead, for each light hex that represents a surface/background/
border/text color, swap to the variable. Keep light hexes ONLY where they are intentional accent
colors (brand greens/ambers/reds) or where a true accent needs its own dark tint.

## Files to cover (exhaustive)
1. `web/precall.css` (39 light hexes, 0 dark rules) — prep-brief v9 cards, tiles, fact tiles,
   news rows, support stack, maturity chart, unknowns, call plan, attendees.
2. `web/call-view.css` (43 light hexes, 0 dark rules) — call timeline, transcript, score strip,
   AI attach callout, video facts, timeline segments, quality coach.
3. `web/postcall.css` (11 light hexes, 1 dark rule) — post-call result cards, ARR/traction tiles.
4. Sweep `web/lifecycle.css` remaining gaps (44 light hexes, 36 dark rules) and `web/styles.css`.

## Ask GLM-5.2
Give a FAILPROOF plan for Codex (gpt-5.5): walk every rule in precall.css, call-view.css,
postcall.css (and finish lifecycle.css/styles.css) that uses a light surface/background/border/
text hex, and replace it with the correct --dew-* variable (or add a [data-theme="dark"]
override where the light value is intentional for light mode). Cover: About the company card,
fact tiles, news, support stack, call timeline, transcript, score strip, ARR/traction tiles.
Verification: toggle dark, visually inspect every section; no pure-white cards; light mode
unchanged. Do NOT hardcode dark hexes; use theme variables.
