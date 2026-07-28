# Call View Module

## Overview

The Call View Module provides a detail page for individual calls, displaying call metadata, AI analysis results, transcript, and media. It is accessible via deep links from the Deal View Timeline and other surfaces.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Call View Page                            │
│  ┌─────────────┐  ┌──────────────────────────────────────────┐  │
│  │   Header    │  │  Tabs: Overview | Transcript | Analysis  │  │
│  │ Call Meta   │  │                                          │  │
│  │ Open Deal → │  │  ┌────────────────────────────────────┐  │  │
│  └─────────────┘  │  │         Tab Content                │  │  │
│                   │  └────────────────────────────────────┘  │  │
│                   └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Domain Services                              │
│  CallService │ SummariesService │ ScorecardService │ etc.       │
└─────────────────────────────────────────────────────────────────┘
```

## Deep Linking

Call View supports deep links with the format:

```
#call/{callId}
#call/{callId}?tab=overview
#call/{callId}?tab=transcript
#call/{callId}?tab=analysis
#call/{callId}?tab=timeline
#call/{callId}?tab=scorecard
#call/{callId}?tab=commitments
#call/{callId}?tab=gaps
```

### Opening from Deal Timeline

When clicking a call in the Deal View Timeline:

```javascript
// In deal-view.js
function openCall(callId) {
  window.location.hash = `call/${callId}`;
}
```

## Data Sources

| Tab | Primary Source | Fallback |
|-----|----------------|----------|
| Overview | Call entity + analysis | Legacy history |
| Transcript | Call.transcriptText | Zoom/Kaia fetch |
| Analysis | PostCall.analysis | — |
| Timeline | timelineSegments collection | analysis.timeline (legacy) |
| Scorecard | scorecards/scorecardLines | analysis.qualityCoach (legacy) |
| Commitments | followUps/objections | analysis.nextSteps (legacy) |
| Gaps | productGaps/whatWorks | — |

## Usage

```javascript
import { renderCallView, openCallView } from './call-view.js';

// Render into a container
await renderCallView(container, callId, { initialTab: 'overview' });

// Navigate to call view
openCallView(callId, { tab: 'scorecard' });
```

## Files

| File | Purpose |
|------|---------|
| `web/call-view.js` | Main view module |
| `web/call-view.css` | Styles |
| `web/domain/video-facts-service.js` | VideoFacts CRUD |
| `web/domain/scorecard-service.js` | Scorecard CRUD |
| `web/domain/commitments-service.js` | FollowUps/Objections/MoM CRUD |
| `web/domain/timeline-service.js` | Transcript timeline derivation |
| `web/domain/product-signal-service.js` | ProductGaps/WhatWorks CRUD |
| `web/domain/technical-commit-service.js` | TechnicalCommit/TcDelta CRUD |
| `web/domain/meddpicc-qualify-service.js` | MEDDPICC qualification |
