---
description: "Luxury dark-editorial HyperFrames template for three-page cinematic storyboards,\ninspired by haute couture title cards and magazine chapter spreads. Use when the\nuser asks for premium fashion-style motion pages, moody serif-led storytelling,\nor a high-end dark presentation aesthetic with rich transitions.\n"
---
# After Hours Editorial Template

Produce a self-contained HTML editorial motion artifact in a dark luxury style,
with three short pages, cinematic typography, and premium transition language.

## Resource map

```text
after-hours-editorial-template/
├── SKILL.md
├── assets/
│   └── template.html
├── references/
│   └── checklist.md
└── example.html
```

## Workflow

1. Read active `DESIGN.md` and map colors, typography tone, and layout rhythm
   into CSS variables while preserving a dark editorial baseline.
2. Copy `assets/template.html` to `index.html`.
3. Keep three narrative pages in sequence; do not increase default page dwell
   above 3 seconds.
4. Preserve premium motion behavior:
   - staged text reveal hierarchy
   - chapter wipe transitions
   - ambient grain/vignette depth
   - restrained cursor-light interaction for local preview
5. Keep output single-file HTML with inline CSS and JS.
6. Avoid sandbox-hostile browser APIs (e.g. localStorage and confirm).
7. Validate with `references/checklist.md` before emitting.

## Output contract

One short orientation sentence, then:

```xml
<artifact identifier="after-hours-editorial" type="text/html" title="After Hours Editorial Template">
<!doctype html>
<html>...</html>
</artifact>
```
