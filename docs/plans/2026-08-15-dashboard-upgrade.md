# Plan: Kuttan Dashboard Inner Monologue Upgrade
**Date:** 2026-08-15
**Goal:** Upgrade the inner monologue dashboard (dash.benjaminsquare.com/stream) with premium UI components, semantic caching, and oh-my-hermes engineering patterns.

## Sources Reviewed
1. **GPTCache** (zilliztech/GPTCache, 8.2k stars) — semantic cache for LLM queries. Embedding-based similarity matching, LangChain/llama_index integration, Redis/Milvus backends, LRU/FIFO/LFU eviction.
2. **SmoothUI** (smoothui.dev) — Motion-powered React components for shadcn/ui. SiriOrb, NumberFlow, DynamicIsland, PhotoTab, AnimatedTags, ScrollableCardStack, WaveText, GridLoader. AI-agent MCP server for programmatic install. MIT licensed.
3. **Motion-Primitives** (motion-primitives.com, ibelick/motion-primitives) — copy-paste animated UI components. ScrambleHover, TextScramble, Knob/Slider, date picker, morphing buttons. Pure CSS/JS, no framework lock-in.
4. **Watermelon UI** (ui.watermelon.sh) — 600+ React components, production templates, theming via CSS variables, production-ready page blocks.
5. **Inspora particle burst** — glowing particle effects (CSS/WebGL) for visual flair.
6. **TimesFM** (google-research/timesfm) — time-series forecasting. NOT applicable to dashboard UI — skip.
7. **oh-my-hermes** (rlaope/oh-my-hermes, 981 stars) — engineering intelligence for hermes-agent. Stage/status tracking (Plan · not run / Code · running / Test · verified), capability manifests, workflow reference, roles system. MIT licensed.

---

## Deliverables

### D1: Premium UI Layer — `thought-stream/index.html` (FRONTEND)
**Owner:** Codex D1-UI

Upgrade `/srv/gideon/thought-stream/index.html` and create companion CSS/JS if needed.

**What to pull from sources:**
- **SmoothUI patterns:** Card entrance animations (slideIn from bottom), channel filter buttons with hover glow, mesh node pulse rings using CSS `box-shadow` animation, gradient atmosphere from SmoothUI hero section (`radial-gradient` dark purple → black)
- **Motion-Primitives patterns:** TextScramble on status labels (characters randomize on change), ScrambleHover on channel buttons, smooth meter fill transitions (CSS `transition` on width)
- **Watermelon UI patterns:** Emotion/metric cards with glassmorphism (`backdrop-filter: blur`), metric counters with animated number display, activity channel pills with count badges
- **Inspora:** Subtle particle/star background using CSS `@keyframes` floating dots, glowing card borders on hover using `box-shadow` with emotion accent colors
- **oh-my-hermes stage indicator:** Adopt the `Plan · not run / Code · running / Test · verified` stage labels — show a small stage badge in the header (e.g., "THINKING · active" vs "IDLE")

**Changes:**
- Add TextScramble effect on status label change
- Add `backdrop-filter: blur` and subtle glassmorphism to cards
- Add floating particle background (CSS-only, 20-30 dots, subtle)
- Add hover glow to channel buttons matching SmoothUI style
- Add emotion-colored `box-shadow` on card hover (reflection=purple, decision=teal, etc.)
- Add stage badge in header: shows current processing stage
- Improve attention/novelty meters with gradient fills and smooth animation
- Ensure the dark palette is preserved (no white themes)

**Verification:**
- `grep -c "TextScramble\|box-shadow\|backdrop-filter\|particle" /srv/gideon/thought-stream/index.html` ≥ 3
- Cards animate on hover with color-matched glow
- Status text scrambles on change

---

### D2: Semantic Cache — GPTCache Integration (BACKEND)
**Owner:** Codex D2-Cache

Add semantic caching to the thought-stream server (`thought-stream-server.py`) using GPTCache principles — NOT the full GPTCache library (Python version mismatch risk), but the same pattern: embed recent thoughts, similarity-check new thoughts against cached ones, avoid duplicate processing.

**What to pull from sources:**
- **GPTCache pattern:** Embed thought text → store in cache dict with embedding key → on new thought, compute similarity → if above threshold (0.85), return cached response instead of reprocessing
- Use `sentence-transformers` or `hashlib` for fast embedding (no GPU needed)
- Store cache in SQLite (already available) with columns: `id, type, text, embedding_hash, response_json, created_at, hit_count`
- LRU eviction: keep last 500 cached thought+response pairs
- Cache hit logged to `token_saved` counter (each hit = ~200 tokens saved)

**Changes to `thought-stream-server.py`:**
1. Add `semantic_cache` dict: `{embedding_hash: {"response": {...}, "count": int}}`
2. After `routeThought()` checks, compute `hashlib.sha256(text.encode()).hexdigest()[:16]` as quick dedup key
3. Before emitting a new thought, check if semantically similar thought (same type + >80% text overlap via difflib) exists in last 50 thoughts — if yes, increment `hit_count` and skip emit (or emit with `cached: true` flag)
4. Add endpoint `GET /cache/stats` returning `{"hits": N, "misses": N, "saved_tokens": N*200}`
5. Frontend: update `token-saved` metric from this endpoint every 30s

**Verification:**
- `grep "semantic_cache\|embedding_hash\|cache/stats" thought-stream-server.py` returns ≥ 3 matches
- Cache stats endpoint responds with JSON
- New identical thought within 50 items is flagged as cached

---

### D3: oh-my-hermes Engineering Patterns (PROCESS)
**Owner:** Codex D3-OMH

Add oh-my-hermes stage tracking and workflow patterns to the Gideon mesh.

**What to pull from sources:**
- **oh-my-hermes stage labels:** `Plan · not run | Code · running | Test · verified`
- **Capability manifests:** JSON file listing Gideon capabilities with confidence scores
- **Workflow reference:** Document the 3 canonical workflows (curiosity loop, SE metrics, portal sync)
- **Roles system:** Define 3 roles: `orchestrator` (Gideon), `worker` (subagents), `reviewer` (Codex checks)

**Changes:**
1. Create `/root/gideon-mesh/docs/stages.md` — stage tracking guide: `PLAN → CODE → TEST → VERIFY → DONE` with timestamps
2. Create `/root/gideon-mesh/docs/capability-manifest.json` — list of Gideon capabilities with confidence (e.g., `{"capability": "semantic_cache", "confidence": 0.85, "last_verified": "2026-08-15"}`)
3. Create `/root/gideon-mesh/docs/workflows/` dir with 3 workflow docs:
   - `curiosity-loop.md` — 9-stage loop workflow
   - `se-metrics.md` — pre/post-call report workflow
   - `portal-sync.md` — Janus ↔ Firestore sync workflow
4. Create `/root/gideon-mesh/docs/roles.md` — role definitions for mesh participants

**Verification:**
- `/root/gideon-mesh/docs/stages.md` exists with ≥ 5 stage definitions
- `/root/gideon-mesh/docs/capability-manifest.json` is valid JSON with ≥ 5 capabilities
- All 3 workflow docs exist in `/root/gideon-mesh/docs/workflows/`

---

## Partition
| Branch | Worktree | Owner | Output |
|--------|----------|-------|--------|
| D1-ui | `/tmp/mesh-D1-ui` | Codex D1-UI | `/srv/gideon/thought-stream/index.html` (upgraded) |
| D2-cache | `/tmp/mesh-D2-cache` | Codex D2-Cache | `~/workspace/thought-stream-server.py` (upgraded) |
| D3-omh | `/tmp/mesh-D3-omh` | Codex D3-OMH | `docs/stages.md`, `docs/capability-manifest.json`, `docs/workflows/*.md`, `docs/roles.md` |

## Non-Negotiables
- Dark theme only — `#050608` base, no white backgrounds
- No external JS CDN dependencies (all inline or CSS-only)
- WebSocket remains primary transport (SSE confirmed non-working)
- Keep the `HERMES` central orb, `REASON/VISION/MEMORY/TOOLS` satellite nodes
- All changes backward-compatible with existing thought types
