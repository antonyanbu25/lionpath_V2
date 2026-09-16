---
description: "Editorial \"Field Notes\" report template with soft paper background, serif hero\ntypography, rounded pastel insight cards, and a retention chart panel.\nUse when users ask for a premium magazine-style business report, board memo\none-pager, or elegant data storytelling layout.\n"
---
# Field Notes Editorial Template

Produce a premium editorial data report in a single self-contained HTML file.

## Resource map

```text
field-notes-editorial-template/
├── SKILL.md
├── assets/
│   └── template.html
├── references/
│   └── checklist.md
└── example.html
```

## Workflow

1. Read active `DESIGN.md` and map palette/typography to root CSS variables.
2. Copy `assets/template.html` to `index.html` as the working artifact.
3. Keep the editorial frame language:
   - paper-like background and subtle vignette
   - serif display headlines plus clean sans-serif body copy
   - rounded pastel metric / insight cards
   - chart panel with legend and axis labels
4. Keep interactions lightweight and presentation-safe:
   - page view switcher (metrics / insights / retention)
   - number count-up animation for key metrics
   - chart line reveal animation
5. Use honest placeholders (`—` or neutral labels) where data is unknown.
6. Validate against `references/checklist.md` before emitting.

## Output contract

One short orientation sentence, then:

```xml
<artifact identifier="field-notes-editorial" type="text/html" title="Field Notes Editorial Report">
<!doctype html>
<html>...</html>
</artifact>
```
