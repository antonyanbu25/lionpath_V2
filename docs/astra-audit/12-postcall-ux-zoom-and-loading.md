# 12 — The Three Mandatory Product Problems

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Evidence level:** structure and control flow are CODE-PROVEN. Durations are a **static model** (see [07](07-performance-and-cost.md) §1); no browser trace was captured, because the audit's scope forbids the environment changes a dev-server + Playwright run would require.
**Related:** [02-postcall-dag](02-postcall-dag.md) · [06-bugs-and-risks](06-bugs-and-risks.md) · [07-performance-and-cost](07-performance-and-cost.md) · [11-implementation-prompts](11-implementation-prompts.md)

This document covers the three problems the brief made mandatory targets: **post-call intake friction** (H17, H18), **Zoom transcript automation** (H19, H21), and **post-call loading quality** (H20). Every confirmed cause here has a corresponding implementation prompt in [11](11-implementation-prompts.md) regardless of its priority.

---

# Part A — Post-call intake friction

## A1. Why the Analyse button is disabled

`web/postcall.js:computeAnalyzeButtonDisabled:697-715`:

```js
const proxySeMissing = !!s.isManager && !String(s.proxySeUserId || "").trim();
return (
  busy ||
  !hasEmail ||
  !hasRecordingOrTranscript ||
  !!s.crmResolving ||
  !s.crmPreviewSurfacedOnce ||      // ← the network gate
  proxySeMissing
);
```

Six conditions. Five are legitimate field-completeness checks. **`crmPreviewSurfacedOnce` is not** — it is a flag set only when `renderCrmMatchesPanel` has run to completion (`:1110`, `:1184`), which requires a **network round-trip** to `resolveContactsForEmails`.

So: *the primary action of the page cannot be enabled until a CRM lookup has returned.* And it is reset to `false` on **every keystroke** in the prospect-emails field (`resetCrmPreviewGate`, `:5998`, `:6006`). The user types an email, the button lights up ~300 ms later, they add a second address, and it goes dark again.

The progress ring reinforces the confusion: `computeAnalyzeButtonProgress:722-727` counts `crmPreviewSurfacedOnce` as one of **three mandatory items**, so the ring sits at 2/3 while the user stares at two visibly-filled fields.

This is F-016. `E-003`, `E-004`.

## A2. Every handler fires twice

`web/crayons-ui.js:215-218` states the problem in the codebase's own words:

> Crayons buttons emit both `fwClick` and a bubbled native `click` for one physical gesture. Binding a handler to both (for compatibility) makes it run twice per click unless deduped.

and ships `bindActionOnce` to fix it. **`bindActionOnce` is used at 3 sites repo-wide, against ~99 `addEventListener("fw…"` registrations** (`E-079`). The intake form is not one of the 3.

`web/postcall.js:5950-6010` binds, on the same elements:

- `#pc-recording-url` — 8 listeners for 3 logical handlers (`fwInput`+`input`+`fwBlur` × `syncPasscodeVisibility`, `syncTranscriptFallbackOpen`; `fwInput`+`input` × `updateAnalyzeButtonState`)
- `#pc-prospect-emails` — `fwBlur`+`blur` and `fwInput`+`input`, where **each blur handler calls `renderCrmMatchesPanel()`** → **two CRM network lookups per blur**
- `#pc-transcript`, `#pc-recording-pwd`, `#pc-transcript-file-btn` — same doubling
- `#postcall-form` `submit` **and** `#analyze-call` `fwClick` → `analyzeCall` twice, and `#analyze-call` is `<fw-button type="submit">` inside that form (`web/index.html:772`), so one click produces both events

`startPipeline`'s re-entry guard is not atomic: `if (… pass0Busy …) return;` runs, then two `await`s (`flushCrmMatchesPanel`, `collectIntakePayload`) complete, and only then is `pass0Busy = true` set (`:5520-5533`). Two events in the same tick both pass the guard. Whether a duplicate pipeline actually starts needs a browser to confirm; the TOCTOU is unambiguous.

This is F-017. `E-005`–`E-008`.

## A3. CLICK AND WAIT LEDGER

Happy path: SE pastes a Zoom link, enters one prospect email, accepts every AI suggestion. **Interactions are counted as discrete user actions; a paste counts as one.**

| # | Step | User action | Trigger / listener | Network / CPU work | Blocking? | Model duration | Why required | Can infer/prefill? | Can run earlier / in parallel? | Failure / loading UI |
|---|---|---|---|---|---|---|---|---|---|---|
1 | Open post-call | navigate | `switchView("postcall")` | none | no | <100 ms | — | — | — | form is visible by default (`#postcall-form-view` has no `hidden`) |
2 | *(manager only)* pick "run for SE" | select | `#postcall-proxy-se` change | none | **yes** — button stays disabled without it | — | correct ownership; a real correctness gate | remember last choice per manager | — | none |
3 | Paste recording link | paste | `fwInput`+`input`+`fwBlur` → `syncPasscodeVisibility`, `syncTranscriptFallbackOpen`, `updateAnalyzeButtonState` — **each ×2–3** | none | no | <50 ms | — | — | **could pre-resolve the Zoom link here** | passcode field appears only if the link has no `?pwd=` |
4 | *(conditional)* enter passcode | type | `#pc-recording-pwd` ×2 | none | no | — | Zoom requirement | no | — | none |
5 | Enter prospect email | type | `fwInput`+`input` ×2 → `resetCrmPreviewGate` + `scheduleCrmMatches` (200 ms debounce) | **`resolveContactsForEmails`** | **YES — this is the gate** | 0.3–1 s | account/deal matching | — | — | button disabled; no spinner on the button itself |
6 | Blur the email field | click away / Tab | `fwBlur`+`blur` ×2 → `rejectSessionEmailInProspectField`, `prefillCompanyFromEmails`, `renderCrmMatchesPanel` — **all twice** | **2× CRM lookup** | no | 0.3–1 s | — | — | — | preview panel `innerHTML` replaced and re-wired |
7 | *(if >1 account matched)* choose account | click | `wireAccountDealPreview` | none | **yes** | — | **correctness-essential** — wrong account corrupts CRM writes | only when confidence is high | — | inline panel |
8 | *(if >1 deal)* choose deal / "new deal" | click | same | none | **yes** | — | **correctness-essential** | only when one open deal exists | — | inline |
9 | *(if new deal)* type deal title | type | `syncNewDealTitlePrefill` | none | no | — | — | **already prefilled** from account name | — | inline |
10 | *(optional)* upload VTT | 2 clicks + file picker | `fwClick`+`click` ×2 → `handleTranscriptFileChange` | local read | no | 0.1–2 s | needed whenever Zoom does not yield a transcript — see Part B | — | — | filename + error lines |
11 | *(optional)* deck / LinkedIn / context | ≥2 clicks each | `initDeckPdfUpload`, `initLinkedInPdfUpload`, `initContextFileUpload` | parse | **yes** — each sets a `*Parsing` flag that disables the button | 1–5 s | — | — | — | "Parsing…" label |
12 | **Click "Analyse call"** | click | `submit` **and** `fwClick` → `analyzeCall` ×2 | — | — | — | — | — | — | button `loading` |
13 | — | — | `flushCrmMatchesPanel` | **a THIRD CRM lookup** | **yes** | 0.3–1 s | re-reads data already fetched at steps 5–6 | **fully redundant** | — | none |
14 | — | — | `collectIntakePayload` | shadow-DOM reads | yes | <100 ms | Crayons hides values once disabled | — | — | field errors |
15 | — | — | `await postCallOwnerId()` | store | yes | <200 ms | — | — | **already promise-started 3 lines above and awaited twice** | — |
16 | — | — | `await domainContextP` | briefs+accounts+deals | yes | 0.2–2 s | resolve context | — | already parallel ✅ | 12 s timeout race |
17 | — | — | **`POST /api/postcall/resolve`** | Zoom fetch (up to **5 sequential HTTP calls, no timeout**) + identity match + 1 LLM | **yes** | **3–35 s** | transcript + roster | — | **could start at step 3** | overlay "Resolving…" |
18 | — | — | `enrichResolveDealsForAccount` | store | yes | 0.2–1 s | — | — | could fold into 16 | — |
19 | — | — | `resolvePipelineSeMotion` | store | yes | <300 ms | — | — | could fold into 16 | — |
20 | — | — | **`POST /api/postcall/classify`** | 1 LLM | **yes** | 2–15 s | call-type default | — | **should NOT block the gate** — it only pre-selects a chip the user can override | overlay "Classifying…" |
21 | **Confirmation gate appears** | read | `showConfirmationGate` | none | — | — | **human gate #2** | — | — | full card `innerHTML` |
22 | *(if wrong)* change SE motion | click chip | `wireConfirmGateInteractions` | none | **yes** | — | affects rubric profile | already defaulted | — | — |
23 | *(if wrong)* change call type | click chip | same | none | **yes** | — | affects rubric profile | already defaulted from classify | — | shows confidence % |
24 | *(per wrong attendee)* fix role | `<select>` | `.postcall-role-select` change → `syncAttendeeListDom` → **full list `innerHTML` replace + re-wire** | none | **yes** | — | **correctness-essential** — drives identity writes | **already inferred** by session match, AE/SE heuristics, roster suggestion, LinkedIn seniority and `resolve.seIdentity` (`inferAttendeeRole:3312-3337`) | — | list re-renders |
25 | *(if no SE inferred)* set Primary SE | select | same | none | **YES — hard block**: `if (!seIdentity) { showInlineStatus(…); return; }` | — | correct | usually inferred; blocks only when nothing matched | — | inline error **only after clicking Confirm** |
26 | *(if free-mail domain)* type company domain | type | `#pc-confirm-domain` | none | **YES — hard block** | — | correct | — | — | inline error **only after clicking Confirm** |
27 | **Click "Confirm and generate"** | click | `bindActionOnce` ✅ (one of the 3 correct sites) | — | — | — | — | — | — | button `loading` |
28 | — | — | **serial `for … await ensureCustomerContact`** | 1 domain-write **per customer attendee** | **YES — blocks everything** | 0.2 s × N | contacts must exist for the lifecycle link | — | **parallelise, or defer past generate** | none |
29 | — | — | qualify ∥ summarise ∥ arr ∥ commit ∥ video launched | 5 requests | no ✅ | — | — | — | already parallel ✅ | — |
30 | — | — | **`POST /api/postcall/generate`** | analyze ∥ (deck→scorecard), then verify, then golden — **3 serial LLM legs** | **yes** | **90–150 s** | the result | — | **verify ∥ golden is safe** (see [07](07-performance-and-cost.md) §3.1) | overlay + skeleton |
31 | Durable acceptance | — | `savePostCallHistory` → localStorage + `POST /api/history` | 1 request | yes | 0.2–1 s | — | — | — | — |
32 | Navigate to the record | — | `navigateToCallRecord` | see Part C | — | — | — | — | — | — |

### Totals

| Metric | Minimum happy path | Typical |
|---|---|---|
Discrete user interactions | **5** (paste link, type email, blur, Analyse, Confirm) | **8–14** |
Human decision gates | **2** | 2 |
Blocking network/LLM waits | **6** | 6–8 |
CRM lookups for the same emails | **3** (steps 5, 6, 13) — and 6 with the double-binding | 3–6 |
Model time to the confirmation gate | **~5–40 s** | |
Model time from Confirm to first result | **~95–190 s** | |
**Total to durable acceptance** | **~100–230 s and ≥5 interactions** | |

The gate's own footnote claims "Analysis usually finishes in 20–45 seconds after confirm" (`renderConfirmationGate:3820`). Against three serial LLM legs at a documented 50–60 s p95 each, **that promise is not achievable on the current critical path** — which is itself a source of the "it feels broken" perception.

### Correctness-essential vs. ceremony vs. implementation leakage

| Category | Steps |
|---|---|
**Correctness-essential** — removing these would create wrong account/deal/ownership/identity writes | 2 (proxy SE), 7 (account when ambiguous), 8 (deal when ambiguous), 24–25 (attendee roles / Primary SE), 26 (company domain for free-mail) |
**UI ceremony** — safe to collapse | 6 (blur to trigger what input already scheduled), 9 (title already prefilled), 22–23 (chips already correctly defaulted; keep them visible and editable, just don't require a look) |
**Implementation leakage** — should not exist | **5's network gate** (`crmPreviewSurfacedOnce`), **13** (third redundant lookup), **15** (double-awaited `postCallOwnerId`), **20 blocking the gate**, **28 serial contact loop**, all the doubled listeners |

### The minimum safe happy path

```
paste recording link → (Zoom pre-resolve starts immediately, in the background)
type prospect email  → CRM lookup starts; button ENABLES on field completeness alone
click "Analyse call" → gate renders as soon as /resolve returns; call-type chip fills in when classify lands
  [confirm only what is genuinely uncertain: ambiguous account/deal, unmatched attendee roles]
click "Confirm"      → durable job accepted immediately; results stream in
```

**3 interactions, 1 human gate, and the only blocking wait before the gate is `/resolve`.** Every confirmation whose removal could corrupt data is preserved, but shown as *correction affordances on confident defaults* rather than as required stops. Where confidence is high (single account match, single open deal, SE inferred by session-email match), auto-confirm and surface an "Analysed as… change?" affordance on the result.

---

# Part B — Zoom transcript automation

## B1. What exists

Three code paths, of which two work and one is scaffolding.

| Path | Symbol | Auth | Status |
|---|---|---|---|
**Server-to-Server OAuth API** | `fetchZoomRecordingViaApi` `worker/src/zoom-api.ts:274` | `account_credentials` grant, `Basic base64(clientId:clientSecret)`, in-memory token cache with single-flight refresh | **works**, and is tried **first** |
**Share-link cookie scrape** | `fetchTranscriptFromShareLinkInner` `worker/src/zoomShare.ts:625` | none — impersonates a browser (spoofed Chrome UA) and maintains a hand-rolled cookie jar to hold `_zm_page_auth` | **works**, but cannot pass reCAPTCHA |
**User OAuth** | `zoomAuthUrl` `worker/src/zoom.ts:26` | — | **scaffolding**: an authorize URL exists; there is **no callback route**, no code exchange, no scope set, unverified `state`, no token storage. `fetchMeetingTranscript` and `listPastMeetings` are never called |

Dispatch (`worker/src/postcall/resolve.ts:478-523`): parse URL → if the host is `freshworks.zoom.us` **and** S2S is unconfigured, fail immediately with a 400 explaining that S2S is required → else try the API → fall back to the scrape **only** on errors flagged `fallback: true`.

That last detail is well designed: a *real* API answer ("this recording has no transcript") is `{status: 404}` with **no** `fallback` flag, so it is reported as-is rather than silently re-attempted by the scraper. There is a test asserting exactly that (`test-zoom-api.ts:255-262`).

## B2. What does not exist

Proven negatives, with the searches run:

| Absent | Negative proof |
|---|---|
`scheduled()` handler | `grep -n 'scheduled' worker/src/index.ts` → no match. `index.ts:66` exports `fetch` only |
Zoom webhook receiver | the verbatim route map `routes.ts:3298-3340` contains no Zoom path other than `/api/zoom/status` and `/api/zoom/auth`; no `recording.completed` / `transcript_completed` handler anywhere |
Scheduled recording discovery | no cron target; the two cron entries in `deploy/vps/cron-batch.sh` point at **unregistered** batch routes (`E-045`) |
Transcript-readiness polling | no polling loop in `zoom-api.ts` or `zoomShare.ts` |
OAuth token **refresh** | `grep -rniE 'refresh_token\|grant_type' worker/src` → only `zoom-api.ts:15,57`. Renewal is re-minting from client credentials |
HTTP timeout on any Zoom call | no `AbortController`/`signal` in either Zoom module |
Retry / backoff on any Zoom call | the only retry in the stack is at the media layer, and it re-resolves signed URLs rather than repeating a request (`video/pass2.ts:501-514`) |
Idempotent ingestion keyed on Zoom meeting/recording identity | none — `callIdentityKey` is computed **client-side** from the pasted URL, and its consumer is broken by the `call_` prefix mismatch (`E-038`) |
Speech-to-text of any kind | `grep -rniE 'whisper\|speech-to-text\|transcribe\|deepgram\|assemblyai\|stt'` → 2 hits, both unrelated prose. `grep -rniE '\-vn\b\|acodec\|\.wav\|\.mp3\|\.m4a\|ar 16000'` → **0 hits** |

**`worker/src/video/` produces frames, not dialogue.** Both ffmpeg invocations end in `-vf fps=…,scale=640:-2 -q:v 5 → *.jpg` (`video/ffmpeg.ts:134-176`, `:239-274`). `VideoFactsDraft` (`domain-model/video-facts.ts:74-120`) has no transcript, utterance, cue or dialogue field; the closest datum is an aggregate `talkPct` per attendee. `transcript-infer.ts` runs in the **opposite** direction — it consumes a transcript to *infer video facts*. With media but no transcript and no ffmpeg, Pass 2 returns `unavailable` rather than generating anything (`video/pass2.ts:583-591`).

**So there is no automatic fallback when Zoom has no transcript.** The only recovery is the SE downloading the `.vtt` from Zoom and uploading or pasting it — which is precisely what the UI copy instructs: *"In Zoom: open the recording → Audio Transcript → Download. Drop the .vtt here."* (`web/index.html:684`).

## B3. Scenario matrix

| # | Scenario | Current behaviour | Verdict |
|---|---|---|---|
S8 | Pasted `/rec/share/` URL, transcript already available, S2S configured, link carries `?startTime=` | API path: mint token → page `/accounts/me/recordings` over a ±1-day window → pick the recording within ±5 min of `startTime` → select the `TRANSCRIPT` (or `CC`) file → download with `Bearer` | **works automatically** |
S8b | Same, but the link has **no `?startTime=`** | hard stop with `fallback: true`: *"This Zoom link has no startTime, so it cannot be matched to a cloud recording."* The share id is **never** sent to Zoom — the epoch-ms is the only join key | **fails** — and which link the SE copies decides it |
S9 | Recording exists, transcript **still processing** | `completedFiles` filters out any file whose `status !== "completed"`, so `transcriptFile` is `undefined` and the user is told *"That Zoom recording has no transcript. Turn on 'Create audio transcript'…"* | **wrong error, no retry.** A transient state is reported as permanent misconfiguration. `E-107` |
S10a | Passcode embedded as `?pwd=` | extracted by `extractZoomEmbeddedPasscode`, forwarded to `validate-meeting-passwd`, the play URL and `play/info`. The `.token` path suffix is deliberately **not** treated as the passcode (it triggers `captcha_error`) | **works** on the scrape path; **ignored** on the API path (which does not need it) |
S10b | Passcode entered separately | `#pc-recording-pwd` → `recordingPassword` → `fetchZoomRecording` → precedence `passcode ?? parsed.passcode ?? embeddedPasscode` → POSTed as `id/passwd/action=viewdetailpage`. The field is hidden unless the link lacks a passcode (`syncPasscodeVisibility`) | **works** |
S11 | Recording accessible, **no transcript at all** | API: hard 404 with remediation. Scrape: a two-tier message, plus a chapter-marker-only rejection (`isChapterOnlyVtt`) so *"Recording Started"/"Sharing Started"* is never mistaken for speech | **correct diagnosis, no automated recovery** — the SE must upload a VTT |
S12 | Expired / revoked link, permission denied, redirect to Microsoft SSO, CAPTCHA | API 401/403 → 502 with a scope hint. Scrape: `assertZoomNotSsoHtml` detects SSO by final URL, Microsoft copyright, `<title>Redirect` or `AADSTS`, and asks the human to *"retry Analyze once"*. CAPTCHA detected in two places (pre-emptive `needRecaptcha`, and the `status:true` + `result:"captcha_error"` trap) and surfaced with instructions to configure S2S | **detected and explained well; never retried programmatically** |
S13 | Authenticated connector receives a completed-recording / transcript-ready event | **no such connector exists** — no webhook, no cron, no queue | **does not exist** |
S14 | Duplicate webhook / retry / re-analysis of the same meeting | no webhook to duplicate. Re-analysis mints a **new** `pc_*` id; `findPostCallByIdentity` cannot match because writers store `'call_' + key` and readers compare the raw key (`E-038`), so dedupe is dead and the second write silently overwrites the first row via the partial unique index | **broken** — F-015 |

## B4. Verdict on the product question

> *Can a valid Zoom call fetch its transcript automatically today?*

**Yes — but only inside a narrow window**, and every failure lands on the SE as manual work:

1. `ZOOM_ACCOUNT_ID` + `ZOOM_CLIENT_ID` + `ZOOM_CLIENT_SECRET` must all be set (S2S). Without them, any `freshworks.zoom.us` link fails immediately with a 400.
2. The pasted link must carry `?startTime=` — i.e. copied from the recording detail page, not from a share dialog.
3. The recording must be on the **same Zoom account** as the S2S app.
4. Zoom must have **already finished** producing the transcript. If it is still processing, the user is told it will never exist.
5. Cloud recording + audio transcript must be enabled, and transcript visibility allowed on shared links.

Miss any one and the SE downloads a VTT by hand.

**Two further defects make this worse than it needs to be:**

- `/api/config` and `/api/zoom/status` report `zoomConfigured` — the **dead user-OAuth triple** — instead of `zoomApiConfigured`, the working S2S triple. So the UI can show Zoom as configured while fetch is impossible (`ZOOM_ACCOUNT_ID` unset), and as unconfigured while it works fine (`ZOOM_REDIRECT_URI` unset). The status indicator is not merely unhelpful, it can be exactly inverted (`E-106`, F-039).
- The intake hint says *"we'll pull it in to transcribe and analyze"* (`web/index.html:666`). **Nothing transcribes.** The system downloads Zoom's pre-existing VTT or fails.

## B5. Smallest reliable path, and the longer-term connector

### Smallest reliable path (no new infrastructure)

1. **Report the right predicate.** Switch `/api/config` and `/api/zoom/status` to `zoomApiConfigured`, and surface it in the intake so the SE knows before pasting whether automatic fetch is even possible.
2. **Distinguish "processing" from "absent".** Read `recording_files[].status`; when a `TRANSCRIPT`/`CC` file exists but is not `completed`, return a distinct `transcript_pending` outcome with Zoom's own timestamp — never the "turn on audio transcript" message.
3. **Poll for readiness within the job.** On `transcript_pending`, retry the recording lookup with bounded backoff (e.g. 30 s / 2 min / 5 min / 15 min). This alone converts the most common failure into a wait.
4. **Add timeouts and bounded retries** to all Zoom HTTP calls — none has either today (F-027).
5. **Recover `?startTime=`.** When it is missing, fall back to matching on `topic` + the meeting date already known from intake, instead of refusing outright.
6. **Fix the copy.** "We'll fetch the transcript Zoom generated" — not "transcribe".

That is a contained change to `zoom-api.ts`, `resolve.ts`, two route handlers and one hint string, and it eliminates scenarios S8b and S9.

### Longer-term connector (needs the durable boundary from [09](09-architecture-options.md) Option C)

`Zoom webhook (recording.completed / recording.transcript_completed)` → verify signature → **idempotent ingestion job keyed on `(zoom_account_id, meeting_uuid, recording_file_id)`** → resolve host → map to an SE via `app_user.email` → fetch transcript → create the post-call job → run the pipeline server-side → durable result → notify the SE.

Design controls that must be explicit, because none exists today:

- **Consent and scope**: an org-level opt-in, plus a per-SE toggle. Auto-ingesting every recording on a Zoom account is a privacy decision, not a technical one.
- **Host → SE mapping and call ownership**: `host_email` → `app_user`; refuse rather than guess when unmapped.
- **Meeting → account/deal matching**: reuse the existing resolve path, but **auto-created calls must be marked provisional** and surfaced for confirmation — never silently written as confirmed identities.
- **Duplicate suppression**: Zoom retries webhooks; the idempotency key above must be a real unique constraint, and it must be the *same* key the reader queries (the current `call_` prefix mismatch is the cautionary tale).
- **Delayed transcript readiness**: `recording.completed` usually precedes transcript availability; the job must park and re-check, not fail.
- **Retry / dead-letter**, **rate limits** (Zoom's API is quota'd and `/accounts/me/recordings` is paged), **transcript retention** (transcripts are customer PII — retention and deletion must be explicit), **backfill** for recordings predating the connector, and a **manual override** so an SE can always paste a link or upload a VTT.

**Explicitly labelled as an unsupported product assumption:** that SEs *want* every recorded call auto-analysed. Auto-ingestion changes what the tool is. It should ship behind an opt-in with a visible queue the SE can approve from, not as a silent default.

---

# Part C — Post-call loading quality

## C1. Six repaints per open

`paintCallRecord` (`web/call-view.js:3342-3350`) is unconditional destroy-and-rebuild:

```js
container.innerHTML = renderCallRecord({ ...bundle, coachAudience }, { pending, errors, progressMessage });
wireCallRecord(container, session, { ...bundle, coachAudience }, opts);
wireCallViewAnimations(container);
wireCallSpine(container);
```

A cold open replaces `#call-panel.innerHTML` **six** times: the loading shell from `app.js:1709`, a second shell from `call-view.js:3399`, a third from `:3442`, the local-bundle paint at `:3450`, a technical-commit paint at `:3502`, and the enriched paint at `:3525` — plus one more per realtime snapshot. Each replacement discards scroll position, open `<details>`, and the active tab (`app.js:1748-1749` *clears* `callRecordTab` after the first render), and restarts the KPI count-up animations, because `call-view-animate.js` keys its "already animated" sets on `callId:attr:value` — and each paint supplies a *different* value as hydration lands, minting a new key each time.

That is the mechanism behind "KPIs counting up one by one, repeatedly". `E-070`.

## C2. RENDER AND FETCH LEDGER

One normal **warm** saved-call open. Default read mode is `api`. `Guard` = whether a stale-response check protects the step.

| # | Kind | Step | Source | Correlation / generation key | Blocking | Guard | User-visible state | Model duration |
|---|---|---|---|---|---|---|---|---|
R1 | render | `panel.innerHTML = renderCallRecordLoadingPanel` | localStorage preview | `callPanelRenderGen` minted here | — | n/a | skeleton | <10 ms |
F1 | read | `getPostCallAnalysis` | localStorage — **full parse + sort** | none | sync | none | — | 1–20 ms |
F2 | fetch | `syncSessionWithDomainStore` | store | `shouldApply` | **yes** | ✅ | skeleton | 0–300 ms |
F3 | fetch | `scrubLegacyArrHydrationError` | may `POST /api/history` | none | **yes** | ❌ | skeleton | 0–500 ms |
R2 | render | second loading shell | — | — | — | ✅ | skeleton | <10 ms |
F4 | fetch | `getPostCallForSession` *(only if F1 empty)* | `GET /api/calls/:id`, then a Firestore `users where email ==` query, then scorecard hydration | none | yes | ✅ | skeleton | 0.3–2 s |
R3 | render | third loading shell | — | — | — | ✅ | skeleton | <10 ms |
R4 | **render** | `paintCallRecord(localBundle)` | localStorage only | `callRecordMatches` (weak) | — | ⚠️ | **first content — with nine empty states, see C4** | <30 ms |
F5 | fetch | `hidePrepGenOverlay` (fire-and-forget) | — | **none** | no | ❌ | 420 ms fade, not keyed to a call | 420 ms |
F6 | fetch | `opts.subscribeCallDetail(cb)` | Firestore, 12 listeners | none | no | ❌ | — | **never resolves in `api` mode** (`E-066`) |
F7 | fetch | `resolveMergedTechnicalCommit` | Firestore `technicalCommits where dealId ==` | none | **yes** | ⚠️ | stale content | 0.2–1 s |
R5 | **render** | `paintCallRecord({...localBundle, technicalCommit})` | — | — | — | ⚠️ | content shifts | <30 ms |
F8–F29 | fetch | **`loadCallBundle`: 18 `safeEnrich` sites, ~22 store operations, 8 serial barriers** | 4 worker HTTP + 6 direct Firestore | **none — `safeEnrich` has no token, no signal, no timeout** | **yes** | ❌ | R5's content, unchanged, for the whole duration | **1–6 s** |
F30 | read | `getPostCallAnalysis` again | localStorage | none | sync | none | — | 1–20 ms |
F31 | fetch | `await hidePrepGenOverlay()` | — | none | **yes** | ❌ | **420 ms of nothing before the real paint** | 420 ms |
R6 | **render** | `paintCallRecord(enrichedBundle)` | — | `canApply() \|\| callRecordMatches` | — | ⚠️ | **authoritative content** | <30 ms |
R7+ | render | one full repaint per realtime snapshot | — | same weak guard | — | ⚠️ | can **revert** — see C5 | per snapshot |

**Warm open: 10 distinct network requests** (4 worker HTTP + 6 direct browser Firestore), 8 serial barriers, 6 repaints, ≥12 full localStorage history parses, ~45 store-layer operations, **one exactly duplicated technical-commit query** (F7 repeats what `loadCallBundle` also does), and **two reads of the same deal** (`safeEnrich` site 8 and the `getDeal:probe` at site 17).
**Cold open (record not in local history): 14 requests.**
**In `firestore` read mode: +12 listeners per render, never unsubscribed**, each snapshot triggering another 10-request bundle load and a full repaint.

`E-070`–`E-074`.

## C3. Seven competing state deciders

There is no state machine. Independent deciders, each with its own rule:

1. `app.js:1707-1717` — "loading" from the presence of `selectedCallId`
2. `call-view.js:3386-3393` — empty / no-session
3. `call-view.js:3432-3435` — "Call not found"
4. `resolveRecordHydration:595-608` — derives `{pending, errors, progressMessage}` from the record blob
5. `resolveEffectiveHydrationPending:633-664` — **re-derives** completeness from data presence, contradicting (4)
6. `app.js:1636-1657` — computes `pending` a **third** time, from a different read, to decide whether to repaint at all
7. Per-section predicates inside `renderCallRecord`, which combine `pending` inconsistently — and several (`renderTechnicalCommitTab`, `renderDealHealthTab`, `renderMinutesTab`, `renderStakeholderSection`) **never receive `pending` at all**

Consequence: on one paint the ARR pill can show a skeleton, the Minutes tab can say "No minutes draft yet", and the radar can say "appear here once analysis completes" — three different verdicts about the same in-flight record.

The clearest symptom: `showPostCallPipeline` (`web/postcall.js:3185-3190`) decides its own visibility by **reading another panel's DOM `hidden` attribute**. And `#postcall-loading` is never shown by any code path — six separate sites spend a line hiding it (`E-077`).

The post-call stage panels have six more partial deciders (`startPipeline`, `showConfirmationGate`, `confirmAndGenerate` + its `catch`, `navigateToCallRecord`, `resetPostCallView`, `onSessionCleared`), no two of which touch the same set of panels.

`E-075`, `E-076`.

## C4. "Empty" before the authoritative read

All nine render at R4 — **before `loadCallBundle` has issued a single store read**. `buildLocalCallBundle` hard-codes `account: null`, `meddpiccDeltas: []`, `dealSignal: null`, and `deal = dealId ? { id: dealId } : null` (an id-only stub with no title, stage or accountId).

| Site | Message | Reality |
|---|---|---|
`renderTechnicalCommitTab:2303` | *"No technical commit yet… **Re-run post-call analysis** to extract it from the transcript."* | the store read has not happened yet — and it tells the user to re-run a pipeline that already succeeded |
`renderDealHealthTab:2384` | "No deal-health movement yet" | `meddpiccDeltas` is hard-`[]` in the local bundle |
`renderMinutesTab:2540` | *"No minutes draft yet… **Re-run analysis** to generate one."* | `momDraft` is enrichment-only |
`renderStakeholderSection:2117` | "Stakeholder profiles not loaded" / *"**Re-run post-call** and confirm SE / AE / customer"* | contacts not yet fetched; this function never receives `pending` |
radar `:1922` | "category scores appear here once analysis completes" | gated on a data predicate, never on `pending` |
QIP tab `:2617` | *"**Re-run post-call analysis** to populate the scorecard."* | same |
ARR pair `:1765` | the ARR row **disappears entirely** when `pending` no longer contains `"arr"` and no value is present | ARR is only added to `pending` when *both* `dealId` and `accountId` exist |
deal-context strip `:1791` | `if (!pairs.length) return "";` — **the whole strip vanishes** | on the local paint `deal` is `{id}` only and `account` is `null`, so it returns `""` and appears ~8 barriers later. **The largest layout shift of the open** |
`getPostCallForSession` `se-access-service.js:82-97` | *"Call not found. It may have been cleared from this browser."* | swallows every failure — could be a 500 from the worker |

Underneath all of it: **`safeEnrich` returns `null`/`[]` on any error** (`call-view.js:2688-2700`), so a permission-denied read and a genuinely-absent artefact produce byte-identical UI. Four of these messages actively instruct the user to re-run analysis, which costs 15–18 LLM calls and re-triggers the whole broken write path.

`E-071`, `E-083`, `E-084`.

## C5. Inverted merge precedence — how newer data visibly reverts

Five precedence rules that do not agree:

| Rule | Site | Winner |
|---|---|---|
A | `se-access-service.js:78-81` | **local**, unconditionally, no timestamp check |
B | `call-view.js:3424-3429` | **local**; remote is fallback only |
C/D | `call-view.js:2781-2793`, `:3024-3032` | **local blob if non-empty**, else store; age-blind |
E | `mergeEnrichedRecord:3356-3373` | **bundle**, for `callNotes` and `technicalCommit` |
**F** | `call-view.js:3459-3465` (realtime) | **remote** — and it spreads `resolvedRecord`, the snapshot taken at `:3429` **before any hydration** |
**G** | `mergeHistoryLists:134-144`, called `(local, remote)` at `:302` | **remote**, by argument order; the `.sort()` only orders the list and never arbitrates the collision |

Two concrete regression paths:

1. **Realtime revert.** The user opens a call while hydration is still writing `qualification`, `summarise`, `pass6`, `arrCompute` into localStorage. R6 paints the fully-hydrated record. A Firestore snapshot then rebuilds from the **pre-hydration** `resolvedRecord`, shallow-merged under a `postCall` doc the worker has not yet received those fields for, and repaints. **Every locally-hydrated field reverts on screen.** Neither guard catches it: `canApply()` compares only the render generation, `callRecordMatches` only the `data-call-id`; neither knows a newer paint already happened. (Only reachable in `firestore` read mode — which is also the only mode where the subscription attaches at all.)
2. **Sync revert.** Hydration writes the enriched record locally, then `pushRemoteEntry` fires-and-forgets and may fail — the `catch` explicitly keeps only the local copy. If a list view triggers `syncHistoryOnLogin` within its 30 s TTL, `mergeHistoryLists(local, remote)` replaces the hydrated local record with the server's un-hydrated one and writes it back. Every subsequent read — i.e. all ≥12 per paint — returns the **older** record, and the call view loses its qualification, notes, gaps and ARR.

`E-081`, `E-082`. This is F-033.

## C6. Broken progress and refresh plumbing

- **`setCallRecordProgress(recordId, "")` is a no-op.** The guard is `if (!recordId || !message) return;` (`:3147`), so the call at `:5029` that is supposed to clear the banner when hydration completes does nothing. The stale "Qualifying…" text is only cleared by a later full repaint. `E-067`
- **Four refresh-request branches are dropped permanently.** `scheduleCallRecordPanelRefresh` (`app.js:1636-1674`) has four early returns that set `callRecordRefreshTargetId = id` and return **without arming a timer**; nothing else ever reads that variable. Since `defaultHydrationPending` seeds 4–5 keys, the normal case takes one of those branches — so a `["summarise"]` update while anything is still pending never repaints. `E-068`
- **One global timer cancels other calls' refreshes.** `callRecordRefreshTimer` is a single module global, so `clearTimeout` for call B kills a pending refresh for call A. `E-069`
- **The first progress event is always lost.** `navigateToCallRecord` triggers an async `renderCallPanel`, then the very next line dispatches a progress event whose handler queries `#call-panel .call-record-inline-progress` — a node that has not been painted yet.
- **The realtime subscription can never be torn down.** `buildSubscribeRemoteCallDetail` is an `async` factory, so `container._callDetailUnsub` holds a **Promise**; both teardown sites test `typeof === "function"` and never fire. In `firestore` mode every render stacks another 12 listeners permanently. In the default `api` mode it never attaches at all, because `fbReadyPromise` is only resolved when `readMode === "firestore"` — so the one live-update path silently does not exist, which is *why* the codebase grew a 900 ms debounce, a `lionpath:*` event bus and six manual repaint sites to compensate. `E-065`, `E-066`
- **`#call-mom-save` fires twice per click** (`fwClick` + native, no `bindActionOnce`) → two concurrent `POST /api/history` read-modify-writes. `E-078`

## C7. Recommended target: one explicit view-state model

Only after the above, because each item above is a distinct cause:

1. **One state machine per view.** `idle → loading → partial(record, pendingSet) → complete(record) → error(reason)`. Every section reads *only* that state; delete the seven ad-hoc deciders and the three separate `pending` derivations.
2. **Two paints maximum**: one skeleton, one content paint, then **targeted** section updates keyed by a generation token. Never `innerHTML` the whole panel to add one field.
3. **Distinguish `unknown` from `empty`.** `safeEnrich` must return `{ok: false, reason}` rather than `null`, and every empty state must render "couldn't load — retry" for a failed read and "none yet" only for a proven-absent artefact. Remove the four "re-run analysis" instructions.
4. **One request-coalescing layer.** De-duplicate the 3× technical-commit and 2× deal reads; cache `getAccount` like `getDeal`/`getCall`; collapse the 8 serial barriers to at most 2 waves.
5. **One merge rule, timestamp-based.** `updatedAt` wins, everywhere, on both paths. Remove the inverted realtime precedence.
6. **Fix the subscription or delete it.** Either make the factory synchronous and resolve `fbReadyPromise` in every mode, or remove the dead path and keep the event bus as the single update channel.
7. **`bindActionOnce` everywhere** `fw*` and native are paired — the helper already exists and is used at 3 of ~99 sites.

Implementation prompts: [11](11-implementation-prompts.md) Prompts 8–14.
