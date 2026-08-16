---
name: gideon-mind-display
description: Open-design rebuild of the Gideon Mind Display dashboard.
version: 0.1.0
author: Gideon, Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [gideon, mind-display, dashboard, design-system, consciousness, monitoring]
    related_skills: [claude-design, design-md]
---

# Gideon Mind Display — Open-Design Rebuild

An open-design rebuild of the **Gideon Mind Display** — a live, single-page HTML
dashboard that surfaces the full inner state of the Gideon Mesh agent system for
human inspection. This skill provides the DESIGN.md token spec, the surface
architecture, data sources, and the build procedure.

The Mind Display is a **Monitor** surface (in the claude-design surface
taxonomy): the user is watching state change. Density, glanceable hierarchy, and
real-time telemetry dominate. No marketing framing, no hero, no feature cards.

---

## When to Use

- Rebuilding or extending the Gideon Mind Display dashboard
- Adding a new telemetry panel to the Mind Display
- Updating the DESIGN.md token spec for the Mind Display
- Debugging why a panel shows stale or empty data
- Porting the display to a new runtime (e.g., from static HTML to a framework)

## Prerequisites

- Gideon Mesh installed and running at `~/.hermes/` (state.db, scripts, daemons)
- `sqlite3` available (queries read `~/.hermes/state.db` in WAL mode)
- A browser to open the HTML artifact (or `browser_navigate` for verification)
- Optional: `npx @google/design.md` for linting the embedded DESIGN.md

## Data Sources (read-only queries)

The Mind Display aggregates five data domains from `state.db`. Every query is
read-only — the display never writes to the database.

### 1. Mesh Consciousness (`mesh_consciousness`)

Node-level state JSON for every peer in the mesh.

```sql
SELECT node_host, state_json, state_digest, updated_at
FROM mesh_consciousness
ORDER BY updated_at DESC;
```

Fields in `state_json`: node identity, service statuses (consciousness-daemon,
node-health, curiosity-daemon, task-router, mesh-memory), memory count, event
count, last-seen timestamp, schema version.

### 2. Curiosity Loop (`curiosity_briefs`, `curiosity_topics`, `curiosity_state`)

The self-directed curiosity cycle — recent briefs, active topics, loop metrics.

```sql
-- Latest briefs
SELECT id, trigger_type, topic, relevance_score, skipped, created_at
FROM curiosity_briefs
ORDER BY created_at DESC LIMIT 20;

-- Topic staleness
SELECT topic, kind, priority, stale_days, last_examined
FROM curiosity_topics
ORDER BY priority DESC;

-- Loop counters
SELECT key, value FROM curiosity_state;
```

### 3. Goals & Dispatch (`gideon_goals`, `goal_dispatch_state`)

Self-directed goals registered by curiosity, tracked through the dispatch
pipeline.

```sql
SELECT g.id, g.goal, g.status, g.progress, g.source,
       g.created_at, g.last_progress_at,
       d.attempts, d.max_attempts, d.last_status, d.dispatched_at
FROM gideon_goals g
LEFT JOIN goal_dispatch_state d ON d.goal_id = g.id
ORDER BY g.created_at DESC LIMIT 30;
```

### 4. Event Bus (`gideon_events`)

Recent events from all mesh subsystems (curiosity cycles, consciousness sync,
task routing, goal dispatch).

```sql
SELECT id, ts, type, payload, consumed
FROM gideon_events
ORDER BY ts DESC LIMIT 50;
```

### 5. Mesh Memory (`memory`)

Key-value memory entries synced across nodes.

```sql
SELECT key, value, updated_at, origin_node
FROM memory
ORDER BY updated_at DESC LIMIT 50;
```

### Latest Curiosity Brief

```bash
cat ~/.hermes/curiosity/LATEST.md
```

---

## Surface Architecture

The display is a single self-contained HTML file with embedded CSS and JS. It
polls a local JSON endpoint (or reads inline JSON generated at build time) and
re-renders panels on a 5-second interval.

### Layout — Monitor Surface, 6 Panels

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

### Panel Specifications

| Panel | Data Source | Refresh | Key Info Displayed |
|-------|------------|---------|-------------------|
| Mesh Nodes | `mesh_consciousness` | 5s | Node host, service status dots, last-seen, state digest (short hash) |
| Curiosity Loop | `curiosity_briefs` + `curiosity_state` | 5s | Latest brief topic, relevance score, daily token usage, cycle count, throttle status |
| Goals & Dispatch | `gideon_goals` + `goal_dispatch_state` | 5s | Goal title, status badge, progress bar, attempt count, dispatch status |
| Event Stream | `gideon_events` | 5s | Timestamp, event type (color-coded), payload summary (truncated) |
| Latest Brief | `~/.hermes/curiosity/LATEST.md` | 30s | Rendered markdown of the most recent curiosity brief |
| Memory Log | `memory` table | 10s | Key, value (truncated), origin node, updated timestamp |

### Status Badge Colors

| Color | Token | Meaning |
|-------|-------|---------|
| Green | `{status.ok}` | Active/running, recent heartbeat |
| Amber | `{status.warn}` | Stale (>2× expected interval), degraded |
| Red | `{status.error}` | Stopped, failed, unreachable |
| Gray | `{status.idle}` | Proposed/pending, not yet started |

---

## DESIGN.md Token Spec

The following spec is the authoritative design system for the Mind Display. It
follows Google's DESIGN.md format (YAML front matter + markdown rationale). The
palette is dark-themed for a monitoring/observability surface — high contrast,
low eye strain, status-color-forward.

### Token File

Save this as `DESIGN.md` in the project root alongside the HTML artifact:

```markdown
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

## Overview

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

## Layout

Spacing scale is 4px baseline. Panels use `lg` (20px) internal padding. Data rows
use `sm` (8px) vertical spacing. Inter-panel gaps are `md` (12px). The grid is
a 2-column CSS Grid that collapses to a single column below 768px viewport.

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
```

---

## Build Procedure

### Step 1: Generate data snapshot

Create a script that queries `state.db` and emits a JSON snapshot:

```bash
#!/usr/bin/env bash
set -euo pipefail
DB="${HERMES_DB:-$HOME/.hermes/state.db}"

sqlite3 -json "$DB" <<'SQL'
SELECT json_object(
  'mesh_nodes', (SELECT json_group_array(json(state_json)) FROM mesh_consciousness ORDER BY updated_at DESC),
  'curiosity_briefs', (SELECT json_group_array(json_object('id',id,'trigger_type',trigger_type,'topic',topic,'relevance_score',relevance_score,'skipped',skipped,'created_at',created_at)) FROM curiosity_briefs ORDER BY created_at DESC LIMIT 20),
  'curiosity_topics', (SELECT json_group_array(json_object('topic',topic,'kind',kind,'priority',priority,'stale_days',stale_days,'last_examined',last_examined)) FROM curiosity_topics ORDER BY priority DESC),
  'curiosity_state', (SELECT json_group_array(json_object('key',key,'value',value)) FROM curiosity_state),
  'goals', (SELECT json_group_array(json_object('id',g.id,'goal',g.goal,'status',g.status,'progress',g.progress,'source',g.source,'created_at',g.created_at,'attempts',d.attempts,'max_attempts',d.max_attempts,'dispatch_status',d.last_status,'dispatched_at',d.dispatched_at)) FROM gideon_goals g LEFT JOIN goal_dispatch_state d ON d.goal_id=g.id ORDER BY g.created_at DESC LIMIT 30),
  'events', (SELECT json_group_array(json_object('id',id,'ts',ts,'type',type,'payload',payload,'consumed',consumed)) FROM gideon_events ORDER BY ts DESC LIMIT 50),
  'memory', (SELECT json_group_array(json_object('key',key,'value',value,'updated_at',updated_at,'origin_node',origin_node)) FROM memory ORDER BY updated_at DESC LIMIT 50)
);
SQL
```

### Step 2: Build the HTML artifact

Using the DESIGN.md tokens above, create a single self-contained HTML file:

1. Embed all CSS using the DESIGN.md token values as CSS custom properties
2. Implement the 2-column grid layout from the surface architecture diagram
3. Each panel fetches `/api/snapshot` (or reads inline JSON if served statically)
4. Use `setInterval` at 5000ms for panels 1-4, 10000ms for Memory, 30000ms for Latest Brief
5. Status dots pulse with CSS animation (respect `prefers-reduced-motion`)
6. Dark theme only — no light-mode toggle (this is a server-room display)

### Step 3: Serve or open

```bash
# Option A: Static — embed JSON inline, open the file directly
# Option B: Live — serve with a simple HTTP server that runs the snapshot script
python3 -m http.server 8765 --directory ~/gideon-mesh/display/
```

### Step 4: Verify

```bash
# File exists
ls -la ~/gideon-mesh/display/mind-display.html

# Open in browser, check console for errors
# Use browser_navigate to open and browser_console to check

# Lint the DESIGN.md (optional)
npx -y @google/design.md lint ~/gideon-mesh/display/DESIGN.md
```

---

## Slop Audit Checklist

Before declaring the display done, run the claude-design slop diagnostic:

1. **No tech gradient** — background is flat `#0A0E14`, no gradient
2. **No generic hue** — accent is cyan (#39D0D8), not indigo/violet
3. **No feature-tile grid** — panels are data-dense, not marketing cards
4. **No accent rail** — domain accent bars are functional (identify data source), not decorative
5. **No glassmorphism** — panels are solid fills with real borders
6. **No monument stats** — numbers are contextual, not oversized fillers
7. **No icon toppers** — panel headers are text labels, not icon+heading
8. **No center stack** — left-aligned grid layout, not centered
9. **Intentional type** — JetBrains Mono + Inter chosen for function, not default
10. **Correct surface** — Monitor: density, glanceability, live data. No hero.

Score must be 0/10 before shipping.

---

## Pitfalls

- **Stale data looks like stopped services.** Node health queries `mesh_consciousness.updated_at` — if the consciousness daemon is stopped, the last known state persists and may look healthy. Display staleness by comparing `updated_at` to current time; show amber/red when超过了 `2 * CONSCIOUSNESS_INTERVAL` seconds.
- **WAL mode required.** The display reads `state.db` while daemons write to it. If WAL mode is not enabled (`PRAGMA journal_mode=WAL`), concurrent reads may block or error. Phase 2 install enables WAL — but verify if the DB was created before Phase 2.
- **Event table schema varies.** `gideon_events` may use `(ts, type, payload)` or `(id, topic, payload, emitted_at)` depending on which subsystem created it. The display's snapshot script uses `json_object()` which handles nullable columns gracefully, but verify the actual schema with `.schema gideon_events` before relying on specific column names.
- **`curiosity_*` tables may not exist** if the curiosity loop was never installed. The snapshot script should handle empty results gracefully (SQLite `json_group_array` returns `[]` for no rows, but the table itself must exist — wrap queries in `TRY` or check via `sqlite_master`).
- **Large payloads in events.** `gideon_events.payload` can be multi-KB JSON. Truncate to 200 chars in the display with a "..." indicator and a click-to-expand interaction.
- **No write path.** The display must never write to `state.db`. All queries are `SELECT`. If a "refresh" button is needed, it re-runs the snapshot query, not a DB write.

---

## Verification

- [ ] HTML file exists at the stated path
- [ ] Opens in browser with no console errors
- [ ] All 6 panels render with real data from `state.db`
- [ ] Status dots show correct colors for running/stopped services
- [ ] Design tokens match DESIGN.md spec exactly (no hardcoded hex outside tokens)
- [ ] `prefers-reduced-motion` disables status-dot pulse animation
- [ ] Slop audit score is 0/10
- [ ] DESIGN.md lints clean (if CLI available)
- [ ] Responsive: single-column layout below 768px viewport
