# Build Alignment — Spec v2 × Wireframe v4 × 2.0.6

What agrees, what conflicts, what has to be decided, and where each piece gets built.

Read this alongside `post-call-intelligence-spec-v2.md`. The spec is canonical for *what*. This
document is canonical for *where in 2.0.6* and *what conflicts with existing code*.

---

## 1. Verdict

The spec is more complete than anything we assembled in conversation. Where the two differ, the
spec generally wins — it has thought through consequences we hadn't reached.

**My `qip-rubrics-by-call-type.md` is superseded.** Spec §6.2 has eight profiles to my seven
(it adds **Reverse demo**, which I missed and which is a real SE motion), a proper 38-theme shared
library, and the worked Storytelling anchor. Delete mine. The one thing worth carrying across is
that anchoring matters, and spec §6.4 already says so more precisely.

Five conflicts need resolving before build. Two are with existing 2.0.6 code and will cause
silent wrongness if ignored.

---

## 2. Conflicts

### 2.1 `Deal.latestQualityScore` violates the spec — **live code conflict**

Spec §2.1 is explicit: QIP lives on the **call**, and is *deliberately absent* from the deal,
because it grades the SE, not the deal.

2.0.6 does the opposite. `web/domain/types.js:16` has `latestQualityScore` on `Deal`, and
`deal-service.js:192 bumpDealAfterPostCall()` writes it after every post-call.

It's also a single blended number, which spec §6.1 forbids separately: composite scores compare
only within a call type, never blended.

**Resolution:** stop writing `latestQualityScore` on Deal. Leave the field in place (removing it
means a migration) but deprecate it and stop populating it. The deal record shows traction, MEDPICC
and TC — not QIP. If a manager misses it, spec §2.1 already prescribes the fallback: a one-line
"call quality" note in the right rail, not the number in the header.

**This also corrects something I told you.** My v3 pack said a blended rolling QIP was acceptable
as a trend. Spec §6.1 explains why it isn't — it quietly rewards whoever runs the easiest call mix.
The spec is right and my v3 was wrong on this.

### 2.2 Scorecards can't live in the analysis blob — **architecture conflict**

My v3 put the QIP inside `PostCallDoc.analysis`, which is an opaque `object`. Spec §10 gives
scorecards their own tables with `scorecard_lines` per theme.

The spec is right, and the reason is queryability. The team heatmap in wireframe §11.8 needs
"average score for theme `comp_pitch` across every call this team ran." Inside a blob that means
scanning and deserialising every post-call document in the org. As a queryable collection it's one
indexed read.

`ARCHITECTURE.md` rule 3 agrees — cross-entity aggregation gets a pipeline, not arrays on an entity.

**Resolution:** scorecards and scorecard lines become their own Firestore collections, keyed by
`callId`. The `analysis` blob keeps narrative outputs (notes, MoM draft) where per-theme querying
isn't needed.

### 2.3 Recording required vs transcript paste

Spec §3.2 makes the recording link **required** — it carries video, and video is Pass 2, and
`camera_on`, `call_flow` (share segments), `cde_build` and stakeholder profiles all depend on it.
Spec §6.5 states camera-on must **never** be inferred from a transcript.

My v3 offered transcript paste as an alternative. 2.0.6 supports pasted transcripts today, and
earlier in our thread you said the MVP was manual transcript upload.

**Resolution needed from you.** Options:

| | Consequence |
|---|---|
| Recording required | Matches the spec. Blocks any call not recorded to Zoom/Kaia. |
| Both, transcript degraded | Transcript-only calls score on transcript-derived themes; video themes marked not-applicable, denominator renormalises, `analysis_confidence` drops. Nothing is fabricated. |

I'd take the second. It's already how applicability works, it costs almost nothing, and "we
couldn't score this call at all" is a bad first experience for a tool asking for adoption.

### 2.4 Deal resolution — your answer vs spec §4.3

You said in chat: show all deals on the account, SE picks.
Spec §4.3 says: auto-tie on a single high-confidence candidate, show top 3 with reasons on two-plus.

**These reconcile.** Show all deals on the account always — your rule — but rank them by the spec's
match signals and display *why* each matched (email in brief, domain match, recent brief same SE).
Pre-select the top candidate. The SE sees everything and confirms with one glance.

That satisfies spec §4.2's real worry, which is silent mis-attribution, without hiding deals.

### 2.5 MEDPICC vs MEDDPICC

Spec writes MEDPICC throughout. 2.0.6 and ADR-005 use MEDDPICC. Both list the same eight slots —
metrics, economic buyer, decision criteria, decision process, paper process, identified pain,
champion, competition. Pure naming.

**Resolution:** keep the code's `MeddpiccRollup` keys. Don't rename working code over a spelling.

---

## 3. What the spec adds that we never discussed

| Addition | Why it matters |
|---|---|
| **Pre-call brief as answer key** (§3.3) | Research & agenda, Questions, Incumbent & competition stop being transcript guesswork and become a diff against a document we wrote. Biggest scoring-quality idea in the spec. |
| **Shadow mode** (§6.6) | Demo and discovery ship live; six profiles compute but display `provisional` and stay out of averages. Promotion gate is consistency + volume (~20 shadow calls, composite SD ≤ 5, no theme SD > 15), not hand-scored calibration — see `QIP_PROFILES.md` §6. Live profiles still suppress individual themes with SD > 15. |
| **Reverse demo profile** | A real SE motion I missed entirely. |
| **Two-axis gap taxonomy** (§8) | Product area × cross-cutting tags. Solves the fragmentation my flat `featureArea` would have caused. |
| **Real gap vs enablement gap** | A third of "product gaps" are things the product does and the SE didn't know. Different owner, different fix. |
| **TC snapshot + per-call delta** (§2.2) | Current state on the deal, movement on the call. Makes the commit legible over time. |
| **ARR as a pure function over a versioned price book** (§7) | Deterministic, auditable, re-runnable. Not model-inferred. |
| **Confidence bands, not point estimates** | "$15K–$20K" reads as an estimate. "$9,744" invites an argument nobody can win. |
| **What's working** as a first-class object | The half that makes product actually read the dashboard. |

---

## 4. Screen map — wireframe v4 against 2.0.6

| Wireframe | 2.0.6 | Gap |
|---|---|---|
| `#precall` | `view-precall` + `precall.js` | Aligned |
| `#intake` | `view-postcall` | **Two fields only** — Zoom link, passcode. Full rebuild |
| `#call` — call record | Result panel inside post-call | **Not a screen.** Deepest object in the product, currently a render target |
| `#accounts` / `#account` | `view-accounts` + `account-view.js` | Close. Needs generated summary, ARR panel |
| `#calls` — all calls | — | **Missing entirely** |
| `#deals` / `#deal` | `view-deals` + `deal-view.js` | Close. Sort by traction not close date; **remove QIP column** |
| `#coaching` | `view-dashboard` + `coaching.js`, `dashboard.js` | Exists. Needs per-type averages, no blend |
| `#team` | `view-manager` + `renderManagerDashboard` | Exists. Needs column-reading heatmap + drill-down |
| `#se` — SE detail | — | **Missing** |
| `#pipeline` — leadership | — | **Missing** |
| `#signal` — product | — | **Missing** |

Four screens don't exist. The call record is the significant one — the spec treats it as the
deepest object in the product and today it's a panel inside the upload page.

---

## 5. Video is entirely greenfield — the biggest scope item

`worker/src/zoomShare.ts` resolves **transcript + signed mp4 stream URLs** from the same
`play/info` NWS call (`fetchRecordingFromShareLink` / `media.streams`). It does **not** download
mp4 bytes — Workers cannot hold multi-hundred-MB recordings. Pass 2 runs on the **VPS Node
image with ffmpeg** (`worker/src/video/`), writing `videoFacts` / `timelineSegments`.

### Zoom share links do not work on the Freshworks tenant

`share-info` returns `needRecaptcha: true` on the **first** call, before any passcode attempt.
No passcode unlocks that path, so `fetchRecordingFromShareLink` cannot serve Freshworks
recordings — the earlier "rate-limited, wait and retry" message was wrong.

`worker/src/zoom-api.ts` is the working path: Server-to-Server OAuth (`ZOOM_ACCOUNT_ID` +
`ZOOM_CLIENT_ID` + `ZOOM_CLIENT_SECRET`) reads the account's cloud recordings directly —
TRANSCRIPT VTT plus MP4 download URLs for Pass 2, with `media.authHeader` carrying the bearer
token into ffmpeg. Pass 0 tries the API first and falls back to the share scrape only on
`fallback: true` errors.

Share links carry no meeting UUID, so the API matches on the `?startTime=` epoch-ms param
(±5 min, ±1 day search window). Links copied without `startTime` cannot be matched.

### Kaia share ≠ Zoom share for media

| | Zoom | Kaia Engage public share |
|---|---|---|
| API | NWS `play/info` → VTT + signed mp4 URLs | `…/sharable-links/{id}` → summary / participants only |
| Pass 2 streams | Yes (`media.streams`) | **No** — summary API, not a recording media API |
| Later path | Already wired | Outreach OAuth, org S3 daily export, or player-network spike — **not** `zoomShare.ts` |

### The timeline card without video

The spine has two sources. Pass 2 share segments (`source: "video"`) are what the spec means by
the timeline and are the only ones that feed `call_flow`. When there is no video but the
transcript carries cue timestamps, `worker/src/postcall/timeline.ts` derives conversation phases
(`source: "transcript"`) plus `timelineMarkers` — gaps, wins, objections and a weak close, each
pinned to the second it happened.

That derivation is deterministic and model-free: markers come from scorecard `evidenceJson[].atS`
and from locating gap / win / objection verbatims back in the cue stream. A quote that cannot be
found is dropped, never approximated.

**It is display evidence only.** A transcript spine does not make `call_flow`, `camera_on`,
`cde_build` or `customer_engagement` applicable — §6.5 still holds, and the card's subtitle
changes to say so. A plain-text paste has no clock and yields no timeline at all.

Kaia video is deferred. Pass 0 sets `videoAvailable: false` for Kaia sources.
`worker/src/kaia/media.ts` probes plausible public media siblings and records
`summary_api_only` — use org S3/SFTP daily export or Outreach OAuth later.

**Consent (spec §12.8):** the post-call form checkbox `pc-visual-consent` gates face/camera
vision. Without it, Pass 2 still samples (preferring share-only stream) for CDE/share
segments, but `camera_on` stays not-applicable. Do not ship face keyframe analysis to prod
without legal sign-off; the checkbox is the product control until then.

Spec Pass 2 (Video) feeds four themes:

| Theme | Depends on video |
|---|---|
| `camera_on` | Sampled camera state — spec forbids transcript inference |
| `call_flow` | Share-segment timestamps → timeline of events |
| `cde_build` | Vision: is the tenant theirs, or "Acme Corp" with stock seed data |
| `customer_engagement` | Camera state + talk ratio + attendee curve |

In the demo profile those four carry **35 of 100 points**. Without video, a demo score is computed
on 65 applicable points and `cde_build` — the joint-heaviest theme — can't be scored at all.

This is real engineering: Zoom recording download, frame sampling, the two-tier cost approach in
spec §5 (cheap frame-diffing for state, 15–20 keyframes to a vision model for judgement), plus
storage for keyframe refs. Budget for it as its own workstream, not a task.

It also carries spec §12 open decision 8 — **consent for automated visual analysis of customer
faces.** Zoom's recording notice probably doesn't cover it. That's a legal question with a long
lead time, so ask now.

---

## 6. Where each thing gets built

Translating spec §10's relational model onto 2.0.6's Firestore document store, respecting
`ARCHITECTURE.md`'s extension rules.

**Core entities — already exist, extend in place**

| Spec table | 2.0.6 | Action |
|---|---|---|
| `accounts` | `Account` | Add region, sub_region, support_agent_count, incumbent, competitor, reason_for_evaluation, why_ai |
| `deals` | `Deal` | Add fitment, competitive_position, copilot, forecast_month, all ARR columns. **Stop writing `latestQualityScore`** |
| `briefs` | `PrepBrief` | Add prospect_emails[], stakeholder_profiles — needed for §3.3 answer-key matching |
| `calls` | `PostCallDoc` | Add call_type, confidence, mix, rubric_version, analysis_confidence, provisional, match_method, match_confidence, arr_snapshot, sequence_index |

**New collections — extension lane, keyed by core IDs**

`scorecards` · `scorecard_lines` · `score_overrides` · `rubrics` · `rubric_themes` ·
`video_facts` · `timeline_segments` · ~~`timeline_markers`~~ (built — `timelineMarkers`) ·
`call_participants` ·
`technical_commit` (on deal) · `tc_deltas` (on call) · `product_gaps` · `gap_clusters` ·
`what_works` · `deal_signals` · `mom_drafts` · `deal_summaries` · `account_summaries` ·
`price_book` · `addon_price_book`

Each needs an entry in `ENTITY_CATALOG.md`, an ID prefix in `ID_STANDARDS.md`, FKs in
`RELATIONSHIPS.md` and a rule in `RBAC.md` before code. That's the process the repo already runs;
follow it rather than inventing collections ad hoc.

**Stays in the `analysis` blob:** call notes (internal, blunt, editable). Narrative outputs nobody
queries by field. **MoM is not in the blob** — it lives in `momDrafts` (spec §9/§10) because send
tracking (`sentAt` / `sentBy`) and drafted-but-never-sent metrics need a queryable collection.

**`product_gaps` + `gap_clusters` + `what_works` are the `ProductInsight` that `ENTITY_CATALOG.md`
gates.** Spec §8's Governance section answers the questions that gate was waiting on — fixed
taxonomy, versioning, Other-bucket review cadence, clustering over embeddings. So the gate can now
open, via **ADR-006**, written from spec §8.

**Worker vs web:** every pass is a worker endpoint (LLM + secrets). Every surface is web. The price
book is worker-side — a pure function per §7.8, never a model call.

---

## 7. Still true from this thread, not in the spec

Three live findings the spec doesn't cover, all still needed:

1. **`dealQualification` is broken end to end.** Defined at `postcall-schema.ts:174`, read at
   `contact-service.js:337`, dropped by `normalizePostCallOutput` in `word-limits.ts`. Spec Pass 4
   depends on this path working.
2. **Free-mail domains collapse accounts.** `normalizeAccountSlug` returns the domain whenever
   present, so `raj@gmail.com` produces slug `gmail.com` and every personal-email prospect merges
   into one account. Spec §4.1 doesn't mention it. Fix before writing post-call data at scale.
3. **The five-file rule and the Gemini schema trap.** Any new analysis field must exist in schema,
   interface, system prompt, `normalizePostCallOutput`, and renderer — the normalizer rebuilds
   field-by-field and silently drops anything unlisted. And `gemini-schema.ts` strips `description`,
   so field semantics must live in the prompt text.

---

## 8. Build sequence, adjusted for 2.0.6

Spec §13's phasing is sound. Two changes: real bugs come first, and video splits out.

**Phase 0 — clear the ground** *(days)*
`dealQualification` fix · free-mail fix · `analysisVersion` + `rubricVersion` stamping ·
stop writing `Deal.latestQualityScore`

**Phase 1 — the spine** *(spec Phase 1, minus video)*
Pass 0 resolve → Pass 1 call type → **human gate** → Pass 3 scorecard (demo + discovery live,
six shadow) → Pass 7 commitments → notes + MoM.
Scorecard collections. Surfaces: post-call intake, **call record** (new screen), all calls (new).
Transcript-only scoring with video themes not-applicable.

**Phase 1b — video** *(parallel workstream, own timeline)*
Recording download → frame sampling → vision keyframes → `video_facts`, `timeline_segments`,
`call_participants`. Promotes `camera_on`, `cde_build`, `call_flow`, `customer_engagement` from
not-applicable to scored. **Legal check on consent starts now, not when the code is ready.**

**Phase 2 — the deal**
Pass 4 MEDPICC (needs Phase 0's fix) → Pass 5 TC + deltas → Pass 8 traction → Pass 9 summaries →
ARR engine. Surfaces: deal record, accounts. Deal list sorts by traction.

**Phase 3 — audiences**
ADR-006 → product signal → team heatmap + drill-down → SE detail → pipeline review.

**Phase 4 — breadth**
Calibrate and promote the six shadow profiles · deck diff · pre-call and post-call fully joined.

**Throughout:** override logging from day one.

---

## 9. Decisions blocking the build

Spec §12 lists eight. These four block soonest:

| # | Decision | Blocks |
|---|---|---|
| 1 | Recording required, or transcript-only degraded? (§2.3 above) | Phase 1 intake |
| 2 | **The ~37 remaining anchors** | Every score is noise without them. Needs your hand-scorers, not a model. Highest-leverage unglamorous work in the build |
| 3 | Consent for automated visual analysis | Phase 1b. Long lead time — ask legal this week |
| 4 | Permissions matrix — SE own / manager team / leadership rollup / product gaps across everyone | First dashboard query. Cheap now, expensive later |

Freshservice and Freshsales price rows (spec §12.2) block ARR in Phase 2 — not urgent yet, but
somebody has to pull them from the internal book.

---

## 10. What to hand Cursor first

Save into the repo and commit:

```
docs/POST_CALL_SPEC_V2.md          the spec
docs/wireframes/se-singha-paathai-v4.html   the wireframe
docs/BUILD_ALIGNMENT.md            this document
```

Then run Phase 0 as four small PRs against `2.0.6`. All four are bug fixes or additive stamping,
none depend on the open decisions, and they clear the ground for everything after.

The Standing Rules block in `cursor-prompts-postcall-v3.md` is still correct and still worth
pasting at the top of every agent session — the five-file rule and the Gemini schema constraint
haven't changed. The task list in that file is superseded by the sequence above.
