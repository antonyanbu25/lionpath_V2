---
version: alpha
name: Gideon Mind Display
description: Dark observability dashboard for the Gideon Mesh agent system.
colors:
  primary: "#0A0E14"
  secondary: "#1C2330"
  tertiary: "#39D0D8"
  neutral: "#141B26"
  on-primary: "#E6EDF3"
  on-secondary: "#B4BDC9"
  on-tertiary: "#0A0E14"
  border: "#2A3441"
  surface: "#0F141C"
  surface-elevated: "#1A2332"
  status-ok: "#3FB950"
  status-warn: "#D29922"
  status-error: "#F85149"
  status-idle: "#8B949E"
  accent-curiosity: "#A371F7"
  accent-goals: "#39D0D8"
  accent-events: "#F0883E"
  accent-memory: "#7EE787"
typography:
  display:
    fontFamily: "JetBrains Mono"
    fontSize: 1.5rem
    fontWeight: 700
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "Inter"
    fontSize: 0.875rem
    fontWeight: 600
    letterSpacing: "0.04em"
  body-sm:
    fontFamily: "JetBrains Mono"
    fontSize: 0.75rem
    lineHeight: 1.4
  label-caps:
    fontFamily: "Inter"
    fontSize: 0.625rem
    fontWeight: 600
    letterSpacing: "0.1em"
rounded:
  sm: 4px
  md: 6px
  lg: 10px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 32px
components:
  panel:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    padding: 20px
  panel-header:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    rounded: "{rounded.md}"
    padding: 8px
  status-dot-ok:
    backgroundColor: "{colors.status-ok}"
    height: 8px
    width: 8px
    rounded: 9999px
  status-dot-warn:
    backgroundColor: "{colors.status-warn}"
    height: 8px
    width: 8px
    rounded: 9999px
  status-dot-error:
    backgroundColor: "{colors.status-error}"
    height: 8px
    width: 8px
    rounded: 9999px
  status-dot-idle:
    backgroundColor: "{colors.status-idle}"
    height: 8px
    width: 8px
    rounded: 9999px
  badge-ok:
    backgroundColor: "{colors.status-ok}1A"
    textColor: "{colors.status-ok}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-warn:
    backgroundColor: "{colors.status-warn}1A"
    textColor: "{colors.status-warn}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-error:
    backgroundColor: "{colors.status-error}1A"
    textColor: "{colors.status-error}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-idle:
    backgroundColor: "{colors.status-idle}1A"
    textColor: "{colors.status-idle}"
    rounded: "{rounded.sm}"
    padding: 4px
  event-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-secondary}"
    rounded: "{rounded.sm}"
    padding: 8px
  progress-track:
    backgroundColor: "{colors.border}"
    rounded: "{rounded.sm}"
    height: 4px
  progress-fill:
    backgroundColor: "{colors.accent-goals}"
    rounded: "{rounded.sm}"
    height: 4px
---

## Brand & Style

The Gideon Mind Display is a dark-themed observability dashboard for monitoring
the real-time state of a multi-agent AI mesh system. The visual identity
prioritizes **information density over decoration** — every pixel should convey
state. The surface is a Monitor in the claude-design taxonomy: glanceable
hierarchy, live data, no marketing.

The aesthetic draws from terminal/observability tools (Grafana, htop, Datadog)
rather than SaaS dashboards. Monospace data, sans-serif labels, dark
backgrounds, and semantic status colors carry the entire visual load.

## Colors

- **Primary (#0A0E14):** Near-black background — the canvas. Minimizes eye
  strain for prolonged monitoring sessions.
- **Secondary (#1C2330):** Panel headers and control surfaces. One step lighter
  than primary, establishes visual layering without shadows.
- **Tertiary (#39D0D8):** Cyan accent — the single brand color for interactive
  elements, data highlights, and the Gideon identity mark. Used sparingly.
- **Surface (#0F141C):** Base panel fill — slightly lighter than primary to
  create depth without elevation/shadows.
- **Surface Elevated (#1A2332):** Active panel, hover state, selected row.
- **Border (#2A3441):** Subtle dividers between data rows and panel sections.
  Never decorative — always structural.
- **Status colors:** Four semantic colors for service/node/goal health. Green
  (ok), Amber (warning/stale), Red (error/stopped), Gray (idle/pending). These
  are the most important colors in the system — they carry meaning, not mood.
- **Accent colors:** One per data domain (purple=curiosity, cyan=goals,
  orange=events, green=memory). Used only for the panel header accent bar and
  domain-specific data highlights. Never on text bodies.

## Typography

Two families, strictly separated by role:

- **JetBrains Mono** for all data values, timestamps, IDs, node hosts, digests,
  and the display title. Monospace ensures aligned columns and numeric scanning.
- **Inter** for labels, panel headers, badges, and status text. The sans-serif
  provides readable hierarchy at small sizes where mono would be too heavy.

Weight carries hierarchy, not family. Display weight is 700; panel headers are
600; body data is 400. label-caps uses 600 weight with wide tracking for
section labels.

## Layout & Spacing

Spacing scale is 4px baseline. Panels use `lg` (20px) internal padding. Data rows
use `sm` (8px) vertical spacing. Inter-panel gaps are `md` (12px). The grid is
a 2-column CSS Grid that collapses to a single column below 768px viewport.

```
┌─────────────────────────────────────────────────────────────────┐
│  GIDEON MIND DISPLAY                          [last-updated ts]  │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│  MESH NODES          │  CURIOSITY LOOP                          │
│  (consciousness)     │  (briefs + topics + counters)            │
│                      │                                          │
├──────────────────────┼──────────────────────────────────────────┤
│                      │                                          │
│  GOALS & DISPATCH    │  EVENT STREAM                            │
│  (pipeline status)   │  (recent gideon_events)                  │
│                      │                                          │
├──────────────────────┴──────────────────────────────────────────┤
│                                                                 │
│  LATEST BRIEF + MEMORY LOG                                      │
│  (LATEST.md render + recent memory entries)                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Panel map

| Panel | Data Source | Refresh | Key Info Displayed |
|-------|------------|---------|-------------------|
| Mesh Nodes | `mesh_consciousness` | 5s | Node host, service status dots, last-seen, state digest |
| Curiosity Loop | `curiosity_briefs` + `curiosity_state` | 5s | Latest brief topic, relevance score, cycle count, throttle |
| Goals & Dispatch | `gideon_goals` + `goal_dispatch_state` | 5s | Goal title, status badge, progress bar, dispatch status |
| Event Stream | `gideon_events` | 5s | Timestamp, event type (color-coded), truncated payload |
| Latest Brief | `~/.hermes/curiosity/LATEST.md` | 30s | Rendered markdown of most recent curiosity brief |
| Memory Log | `memory` table | 10s | Key, value (truncated), origin node, updated timestamp |

## Shapes

Rounded corners are modest and structural. `sm` (4px) on data rows and badges.
`md` (6px) on panel headers. `lg` (10px) on panels. `full` (9999px) on status
dots only. No decorative radius.

## Components

- `panel` is the primary surface for grouped telemetry. Elevated background,
  no shadow. A 2px accent bar (domain color) sits on the top edge.
- `status-dot-*` are 8px circles indicating service/daemon health. Pulsing
  animation (respecting `prefers-reduced-motion`) for active states.
- `badge-*` are status labels with 10% opacity background fill and full-opacity
  text. Used for goal statuses, dispatch states, and node health.
- `progress-track` / `progress-fill` is the progress bar for goal completion
  percentage. Track is border color; fill is the goals accent.
- `event-row` is a single-line log entry with timestamp (mono, muted), event
  type (color-coded by domain), and truncated payload.

### Status badge semantics

| Color | Token | Meaning |
|-------|-------|---------|
| Green | `{colors.status-ok}` | Active/running, recent heartbeat |
| Amber | `{colors.status-warn}` | Stale (>2× expected interval), degraded |
| Red | `{colors.status-error}` | Stopped, failed, unreachable |
| Gray | `{colors.status-idle}` | Proposed/pending, not yet started |

## Do's and Don'ts

- **Do** use monospace for any value the user needs to scan or compare.
- **Do** use semantic status colors consistently — green always means healthy.
- **Do** keep panels information-dense; this is a Monitor, not a landing page.
- **Don't** add gradients, glows, or decorative shadows.
- **Don't** use the accent colors (curiosity/goals/events/memory) for status —
  those are domain colors, not health indicators.
- **Don't** nest component variants. `badge-ok` is a sibling of `badge-warn`,
  not a child.
- **Don't** introduce colors outside the palette — extend the palette first.
