---
description: "WeRead-inspired HyperFrames video template for vertical annual reading reports,\npersonal reading dashboards, book-note recaps, and shareable year-in-review\nstories. Use when users want a 9:16 HTML-to-MP4 reading report with warm paper\ntexture, editorial Chinese typography, book-page metaphors, data highlights,\nand deterministic motion.\n"
---
# WeRead Year in Review Video Template

Create a vertical HyperFrames composition for annual reading reports: WeRead,
Goodreads, Readwise, Notion reading logs, book clubs, or personal learning
recaps. The template turns reading time, active days, bookshelf assets, notes,
keywords, and a reading persona into a shareable 9:16 video.

## Resource Map

```text
weread-year-in-review-video-template/
├── SKILL.md
├── assets/
│   └── template.html
├── references/
│   └── checklist.md
└── example.html
```

The rendered MP4 showcase used by `example.html` is hosted at
`https://repo-assets.open-design.ai/resources/videos/skills/weread-year-in-review-video-template/default-showcase.mp4`.

## Workflow

1. Copy `assets/template.html` to `index.html`.
2. Replace the default report data in the `REPORT` object:
   - owner/title
   - reading hours and active days
   - bookshelf and completion stats
   - note composition
   - interest keywords
   - reading persona and share line
3. Preserve the 12-scene timeline unless the user asks for a shorter cut.
4. Keep the WeRead-inspired visual language:
   - warm paper background
   - ink-blue typography
   - restrained WeRead green accents
   - book pages, bookmarks, highlights, note cards, and shelf metaphors
5. Motion should feel like flipping through a reading journal. Avoid techy
   slide transitions, bouncy UI effects, and dashboard-loading motion.
6. Keep the composition deterministic:
   - direct `data-start`, `data-duration`, and `data-track-index` attributes
   - no unseeded randomness
   - no infinite loops or `repeat: -1`
   - no dependency on scroll, hover, localStorage, or runtime class discovery
7. Validate against `references/checklist.md` before emitting.

## Output Contract

Emit one short orientation sentence, then a single HTML artifact:

```xml
<artifact identifier="weread-year-in-review-video-template" type="text/html" title="WeRead Year in Review Video Template">
<!doctype html>
<html>...</html>
</artifact>
```
