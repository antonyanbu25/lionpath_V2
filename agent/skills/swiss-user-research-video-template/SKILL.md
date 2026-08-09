---
description: "Swiss-style user-research narrative template in warm-paper editorial aesthetics.\nUse when users ask for a premium research deck or story-first live artifact with\nminimalist typography, high-clarity layout, subtle motion, donut breakdowns,\nand keyboard/click navigation across slides in a single HTML file.\n"
---
# Swiss User Research Video Template

A premium Swiss-editorial user research template for narrative-heavy live artifacts.
The visual language is warm paper, strict spacing rhythm, thin rules, and restrained
micro-interactions that keep attention on the story.

## Resource map

```text
swiss-user-research-video-template/
├── SKILL.md
├── assets/
│   └── template.html
├── references/
│   └── checklist.md
└── example.html
```

## Workflow

1. Read `DESIGN.md`, then map tokens to the template CSS variables (`--paper`, `--ink`, `--muted`, rule colors, segment colors) without changing layout semantics.
2. Start from `assets/template.html`; keep the three-slide structure:
   - title / framing
   - participant breakdown donut
   - behavioral pattern + evidence panel
3. Preserve interactions:
   - click/keyboard slide navigation (`ArrowLeft`/`ArrowRight`)
   - bottom pagination dots with active state
   - donut legend hover highlight
   - subtle line-draw and panel-lift transitions
4. Keep all data realistic and internally consistent between copy, donut labels, and percentages.
5. Keep HTML self-contained (inline CSS/JS), with no external framework dependencies.
6. Validate using `references/checklist.md` before output.

## Output contract

Emit one concise orientation sentence and then a single HTML artifact:

```xml
<artifact identifier="swiss-user-research-deck" type="text/html" title="Swiss User Research Synthesis">
<!doctype html>
<html>...</html>
</artifact>
```
