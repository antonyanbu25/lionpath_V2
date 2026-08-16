# Gideon Inner Monologue — Live Thought Stream

## What
Real-time SSE stream of Gideon's raw inner monologue — unfiltered reasoning, half-formed thoughts, questions, observations — displayed like ai-desk-card's live AI status.

**Reference**: op7418/ai-desk-card — M5Paper e-ink desk card showing AI's live inner monologue.

## Architecture

```
Curiosity Daemon → POST /emit → ThoughtStream Server (7892)
                                    ↓
                        SSE /stream → Browser (dash.benjaminsquare.com/thought-stream/)
```

### Components

1. **ThoughtStream Server** — FastAPI on port 7892
   - `POST /emit` — daemon calls this to push a thought
   - `GET /stream` — SSE endpoint, streams thoughts to all connected browsers
   - In-memory deque, broadcasts to all `EventSource` clients
   - CORS open (browser connects from different origin)

2. **Daemon Integration** — curiosity-daemon.sh
   - At end of each cycle (stage FEEDBACK), POST current brief/insight to `/emit`
   - Also emit: thoughts from the curiosity pipeline, observations, internal questions

3. **Frontend** — `dash.benjaminsquare.com/thought-stream/`
   - Dark background (#0A0E14)
   - Live scrolling thought stream — new thoughts appear at top, old fade out
   - Each thought card shows: timestamp, type tag, raw thought text
   - Emotion color coding: curious=purple, anxious=orange, planning=teal, intrusive=pink
   - Minimal chrome — just the thoughts, nothing else

4. **Caddy Route**
   - `handle /thought-stream/events` → reverse_proxy 172.17.0.1:7892
   - `handle_path /thought-stream/*` → serve static files

### Data Shape

```json
{
  "id": "uuid",
  "type": "reflection|question|anxious|planning|intrusive|observation",
  "text": "the raw thought text — unfiltered, conversational, first-person",
  "timestamp": "2026-08-14T23:45:00Z",
  "confidence": 0.7
}
```

### SSE Event Format

```
event: thought
data: {"id":"...","type":"reflection","text":"...","timestamp":"...","confidence":0.8}
```

### Frontend Behavior
- Connect via `EventSource('/thought-stream/events')`
- New thought arrives → card slides in at top with animation
- Keep last 50 thoughts visible, older ones fade out
- If SSE disconnects → show "reconnecting..." banner, auto-reconnect
- Demo mode fallback if SSE never connects (show 3-5 sample thoughts)

### Color Tokens
| Type | Color |
|---|---|
| reflection | #8b7cff (purple) |
| question | #3b82f6 (blue) |
| anxious | #D29922 (amber) |
| planning | #43d7b5 (teal) |
| intrusive | #ec4899 (pink) |
| observation | #8B949E (gray) |

### Files
- `thought-stream-server.py` — FastAPI SSE server on 7892
- `curiosity-daemon.sh` patch — POST thoughts to /emit after each cycle
- `index.html` — live thought stream frontend
- Caddyfile addition for `/thought-stream/` route
