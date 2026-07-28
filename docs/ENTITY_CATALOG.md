# Entity Catalog — First-Class Records vs Value Objects

This document locks which domain objects receive a **unique internal ID** and which data stays **embedded** inside a parent record. See also [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) and [RELATIONSHIPS.md](./RELATIONSHIPS.md).

---

## Decision rule

Give an object its **own unique ID** if **any** of these is true:

| Question | If yes → own ID |
|----------|-----------------|
| Will another record reference it by FK? | Yes |
| Will you query it directly? | Yes |
| Can it be created/updated/deleted independently? | Yes |
| Does RBAC apply to it separately? | Yes |
| Can there be many over time? | Yes |

If data is **only nested inside a parent** and never referenced elsewhere → **no global ID**.

---

## First-class entities (unique ID required)

| Entity | Firestore path | ID prefix | Natural key (lookup only) |
|--------|----------------|-----------|---------------------------|
| **User** | `users/{id}` | `usr_` | `email` (unique, normalized) |
| **Org** | `orgs/{id}` | `org_` | — |
| **Team** | `teams/{id}` | `team_` | — |
| **Account** | `accounts/{id}` | `acc_` | `slug` |
| **Contact** | `contacts/{id}` | `con_` | `(accountId, email)` |
| **Deal** | `deals/{id}` | `deal_` | `(accountId, type, status=active)` per type |

**Portal routes (hash):** `#accounts`, `#accounts/{accountId}`, `#accounts/{accountId}/deals/{dealId}`, `#deals`, `#deals/{dealId}` — Deals nav uses the latter pair; Accounts opportunity drill uses account-scoped deal hash.

| **Lifecycle** | `lifecycles/{id}` | `lc_` | `(ownerId, accountId, status=active)` |
| **PrepBrief** | `prepBriefs/{id}` | `prep_` | — |
| **PostCall** | `postCalls/{id}` | `call_` | `(ownerId, callIdentityKey)` |
| **Task** | `tasks/{id}` | `task_` | — |
| **Rubric** | `rubrics/{id}` | `rub_` | `(callType, version)` |
| **RubricTheme** | `rubricThemes/{id}` | — | `(rubricId, themeKey)` — doc id `{rubricId}__{themeKey}` |
| **Scorecard** | `scorecards/{id}` | `scr_` | `(callId)` — one scorecard per call |
| **ScorecardLine** | `scorecardLines/{id}` | `scl_` | `(scorecardId, themeKey)` |
| **ScoreOverride** | `scoreOverrides/{id}` | `sov_` | — |
| **VideoFacts** | `videoFacts/{id}` | `vf_` | `(callId)` — one facts doc per call |
| **TimelineSegment** | `timelineSegments/{id}` | `tls_` | `(callId, startS, endS)` |
| **TimelineMarker** | `timelineMarkers/{id}` | `tlm_` | `(callId, atS, kind)` |
| **FollowUp** | `followUps/{id}` | `fu_` | — |
| **Objection** | `objections/{id}` | `obj_` | — |
| **MomDraft** | `momDrafts/{id}` | `mom_` | `(callId)` — one draft per call |
| **MeddpiccDelta** | `meddpiccDeltas/{id}` | `mdd_` | `(callId, slot)` — per-call MEDDPICC movement |
| **TechnicalCommit** | `technicalCommits/{id}` | `tc_` | `(dealId)` — one TC snapshot per deal |
| **TcDelta** | `tcDeltas/{id}` | `tcd_` | `(callId, field)` — per-call TC movement |
| **DealSignal** | `dealSignals/{id}` | `dsig_` | `(callId)` — Pass 8 traction rollup per call |
| **DealSummary** | `dealSummaries/{id}` | `dsum_` | `(dealId)` — one current summary per deal (Pass 9) |
| **AccountSummary** | `accountSummaries/{id}` | `asum_` | `(accountId)` — one current summary per account (Pass 9) |
| **PriceBook** | `priceBooks/{id}` | `pb_` | `(product, tier, currency, term, effectiveFrom)` |
| **AddonPriceBook** | `addonPriceBooks/{id}` | `apb_` | `(addon, appliesTo, requiresTier, currency, term, effectiveFrom)` |
| **AssumptionsBook** | `assumptionsBooks/{id}` | `asb_` | `(key, scope, scopeValue, version, effectiveFrom)` |
| **ArrLine** | `arrLines/{id}` | `arl_` | `(callId, kind, addonKey)` — per-call ARR breakdown row |
| **ArrOverride** | `arrOverrides/{id}` | `aov_` | — |
| **LifecycleEvent** | `lifecycles/{lcId}/events/{id}` | `evt_` | — |
| **ContactEvent** | `contacts/{contactId}/events/{id}` | `cevt_` | — |

### Registered post-call collections (spec ↔ Firestore)

Post-call extension lane ([BUILD_ALIGNMENT.md](./BUILD_ALIGNMENT.md)). Spec tables use **snake_case**; Firestore uses **camelCase** plural paths. Register here before writing collection code.

| Spec name | Firestore path | Entity |
|-----------|----------------|--------|
| `scorecards` | `scorecards/{id}` | Scorecard |
| `scorecard_lines` | `scorecardLines/{id}` | ScorecardLine |
| `score_overrides` | `scoreOverrides/{id}` | ScoreOverride |
| `rubrics` | `rubrics/{id}` | Rubric |
| `rubric_themes` | `rubricThemes/{id}` | RubricTheme — doc id `{rubricId}__{themeKey}` |
| `meddpicc_deltas` | `meddpiccDeltas/{id}` | MeddpiccDelta |
| `technical_commit` | `technicalCommits/{id}` | TechnicalCommit — one snapshot per deal |
| `tc_deltas` | `tcDeltas/{id}` | TcDelta — per-call TC movement |
| `deal_signals` | `dealSignals/{id}` | DealSignal — Pass 8 traction rollup |
| `deal_summaries` | `dealSummaries/{id}` | DealSummary — Pass 9 deal narrative |
| `account_summaries` | `accountSummaries/{id}` | AccountSummary — Pass 9 account narrative |
| `price_book` | `priceBooks/{id}` | PriceBook — effective-dated base plan rows |
| `addon_price_book` | `addonPriceBooks/{id}` | AddonPriceBook — effective-dated add-on rows |
| `assumptions_book` | `assumptionsBooks/{id}` | AssumptionsBook — versioned ARR derivation constants |
| `arr_lines` | `arrLines/{id}` | ArrLine — queryable ARR breakdown per call |
| `arr_overrides` | `arrOverrides/{id}` | ArrOverride — append-only SE edit / confirm log |
| `product_gaps` | `productGaps/{id}` | ProductGap — Pass 6 negative signal |
| `what_works` | `whatWorks/{id}` | WhatWorks — Pass 6 positive signal |
| `gap_clusters` | `gapClusters/{id}` | GapCluster — async verbatim embedding clusters |
| `clustering_state` | `clusteringState/{orgId}` | ClusteringState — pipeline cursor (not prefixed) |

**Auth index (not a domain entity):** `authIndex/{firebaseUid}` → `{ userId: "usr_..." }` — maps Firebase auth to internal User.id for Firestore rules.

---

## Value objects (no global ID)

These are stored **inside** a parent document. They are never queried or secured independently.

| Data | Parent | Notes |
|------|--------|-------|
| Prep JSON (`prep`, `input`) | PrepBrief | Generated research brief; schema in `worker/src/schema.ts` |
| Post-call analysis JSON | PostCall | Call notes + other narrative outputs — not queried by theme. MoM lives in `momDrafts`. |
| Legacy Quality Coach dimensions | PostCall.analysis | Deprecated — superseded by `scorecards` / `scorecardLines` |
| Event `payload` | LifecycleEvent | Context for that event only |
| Form snapshots | PrepBrief.input | Input at generation time |
| Enums | Various | `role`, `stage`, `status`, `source` — not separate tables |

---

## Entity field summary

### User

```typescript
{
  id: string;              // usr_* — domain primary key; used as ownerId everywhere
  email: string;
  authUid: string | null;  // Firebase uid after SSO login
  displayName: string;
  role: "se" | "manager" | "admin";
  jobTitle?: string | null;   // optional display title (read-only in profile UI)
  teamId: string | null;
  orgId: string | null;
  managerId: string | null;
  status: "active" | "inactive";
  createdAt: number;
  updatedAt: number;
}
```

### Team

```typescript
{
  id: string;              // team_*
  name: string;
  orgId: string | null;
  managerId: string;       // User.id of team manager
  memberIds: string[];     // User.id of SE members
  createdAt: number;
  updatedAt: number;
}
```

### Org

```typescript
{
  id: string;              // org_*
  name: string;
  directorId: string;         // User.id of org director (role: manager)
  seniorLeaderIds: string[];  // User.id[] with org-wide read (senior managers)
  teamIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

### Account

```typescript
{
  id: string;              // acc_*
  name: string;
  domain: string | null;
  slug: string;
  industry?: string;
  seTeam?: Array<{
    seUserId: string;
    role: "primary" | "secondary";
    addedAt: number;
    addedBy?: string;
  }>;
  primarySeUserId?: string | null;
  metadata?: {
    research?: object;
    firmographics?: object;
    engagementOverride?: {
      dealType?: "new_business" | "expansion";
      dealId?: string | null;
      updatedAt?: number;
      updatedBy?: string;
    };
    /** @deprecated use Deal.metadata.meddpicc — dual-read fallback only */
    meddpicc?: MeddpiccRollup;
    meddpiccMigratedAt?: number;
    /** Deal that consumed the once-per-account 500 AI Agent session allowance (ADDON_ARR §3). */
    arrSessionAllowanceDealId?: string | null;
  };
  createdAt: number;
  updatedAt: number;
}
// FieldSlot = { value?, status: "unknown"|"partial"|"confirmed", source?, updatedAt?, contactId? }
```

### Contact

```typescript
{
  id: string;              // con_*
  accountId: string;
  email: string;
  name?: string;
  title?: string;
  role?: string;
  metadata?: {
    research?: object;
    disc?: { primary?, secondary?, confidence?, evidence?, assessedAt?, source? };
    influence?: { level?, decisionRole?, source?, updatedAt? };
  };
  createdAt: number;
  updatedAt: number;
}
```

### ContactEvent (append-only)

```typescript
{
  id: string;              // cevt_*
  contactId: string;
  type: "contact_created" | "field_updated" | "disc_updated" | "influence_updated" | "linked_from_prep" | "linked_from_postcall";
  actorId: string;
  timestamp: number;
  payload: object;         // { field?, fields?, source?, lifecycleId?, artifactId? }
}
```

### Deal

```typescript
{
  id: string;              // deal_*
  accountId: string;
  type: "new_business" | "expansion";
  stage: LifecycleStage;
  status: "active" | "paused" | "archived";
  ownerId: string;
  teamId: string;
  orgId: string | null;
  primaryContactId: string | null;
  title: string;
  prepCount: number;
  postCallCount: number;
  openTaskCount: number;
  latestQualityScore: number | null;
  /** Derived ARR estimate — spec §7.7. arrActual is Salesforce opp.Amount only; never blended here. */
  arrEstimateLow?: number | null;
  arrEstimateHigh?: number | null;
  arrEstimatePoint?: number | null;
  arrActual?: number | null;
  arrSource?: "derived_from_agents" | "opp_amount" | "se_override" | null;
  arrPriceBookVersion?: string | null;
  assumptionsBookVersion?: string | null;
  arrInputsJson?: object | null;
  arrComputedAt?: number | null;
  metadata?: {
    meddpicc?: MeddpiccRollup;
  };
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}
```

MEDDPICC is **deal-scoped** (ADR 005). Account-level `metadata.meddpicc` is deprecated (migration fallback only).

Deal ARR fields (spec §7.7): estimate columns are written by post-call compute; `arrActual` is populated only from Salesforce `opp.Amount` and stays separate for calibration. MRR is derived at render as `arrEstimatePoint / 12` — no `mrr*` columns on Deal.

### Lifecycle (aggregate root)

```typescript
{
  id: string;              // lc_*
  dealId?: string | null;  // FK → Deal (canonical stage on Deal)
  ownerId: string;         // User.id
  teamId: string;
  accountId: string;
  primaryContactId: string | null;
  stage: LifecycleStage;
  status: "active" | "paused" | "archived";
  title: string;
  prepCount: number;
  postCallCount: number;
  openTaskCount: number;
  latestQualityScore: number | null;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}
```

### Artifacts (PrepBrief, PostCall, Task)

All artifacts carry:

- `id` — entity ID with prefix
- `lifecycleId` — parent lifecycle
- `dealId` — parent deal (denormalized)
- `ownerId`, `teamId`, `accountId` — denormalized for queries and RBAC

See [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) for full artifact shapes.

### Rubric (reference data)

Versioned QIP weight profiles per call type. Org-wide reference — not scoped to owner/team.

```typescript
{
  id: string;              // rub_{callType}_{versionSlug} — e.g. rub_demo_1_0
  callType: CallType;      // demo | discovery | technical_deep_dive | …
  version: string;         // semver label — e.g. "1.0"
  totalPoints: number;     // always 100 for v1 profiles
  active: boolean;         // inactive rubrics are not selectable for new scorecards
  provisional: boolean;    // shadow mode — scores compute but stay out of aggregates (§6.6)
  createdAt: number;
  updatedAt: number;
}
```

### RubricTheme

One weighted theme line on a rubric. Theme keys are shared vocabulary across all profiles.

```typescript
{
  rubricId: string;        // FK → Rubric.id
  themeKey: string;        // shared key — e.g. call_flow, questions
  weight: number;          // points toward rubric totalPoints
  anchorsJson: object | null;  // score-level anchors; null until hand-scored
}
```

Firestore document id: `{rubricId}__{themeKey}` (composite natural key, no separate prefix).

Seed source: [`worker/src/rubric-profiles.ts`](../worker/src/rubric-profiles.ts) · seed script:
[`worker/scripts/seed-rubrics.mjs`](../worker/scripts/seed-rubrics.mjs).

### Scorecard

One weighted QIP scorecard per call. Queryable for team heatmaps and per-type averages.

```typescript
{
  id: string;              // scr_*
  callId: string;          // FK → PostCall.id
  rubricId: string;        // FK → Rubric.id
  rawScore: number;        // type-composite numerator (points earned)
  denominator: number;     // applicable weight sum — display as "86 / 100"
  confidence: number | null;
  provisional: boolean;    // shadow mode — exclude from aggregates (§6.6)
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  callType: CallType;
  rubricVersion: string;
  createdAt: number;
  updatedAt: number;
}
```

### ScorecardLine

Per-theme score with evidence. Indexed for "average score for theme X across team calls."

```typescript
{
  id: string;              // scl_*
  scorecardId: string;     // FK → Scorecard.id
  callId: string;          // FK → PostCall.id (denormalized)
  themeKey: string;        // shared vocabulary — e.g. comp_pitch, call_flow
  score: number;           // 0..maxScore (typically 0..100)
  maxScore: number;
  applicable: boolean;
  notApplicableReason?: string | null;  // greyed reason when applicable:false — never display as zero
  confidence: number | null;
  evidenceJson: Array<{ atS?: number, quote?: string, source?: string }>;
  coachingNote: string | null;
  weight: number;          // rubric weight at score time
  ownerId: string;         // denormalized for heatmap queries
  teamId: string;
  orgId: string;
}
```

### ScoreOverride

Append-only human override log per scorecard line.

```typescript
{
  id: string;              // sov_*
  scorecardLineId: string; // FK → ScorecardLine.id
  scorecardId: string;     // FK → Scorecard.id (denormalized)
  callId: string;          // FK → PostCall.id (denormalized)
  original: number;
  override: number;
  userId: string;          // FK → User.id
  reason: string;
  createdAt: number;
}
```

### VideoFacts

Pass 2 output — sampled video facts for one call. Not nested in `PostCall.analysis`.

```typescript
{
  id: string;              // vf_*
  callId: string;          // FK → PostCall.id
  status: "pending" | "ready" | "failed" | "unavailable";
  cameraOnPct: number | null;   // 0..100 sampled — never inferred from transcript
  keyframeRefs: Array<{ atS: number; path: string; kind?: string }>;
  attendeeCurveJson?: unknown | null;
  cdeCustomized?: boolean | null;
  cdeEvidence?: string | null;
  sampleIntervalS: number;
  durationSec?: number | null;
  streamKind?: string | null;   // view_with_share | view | share
  errorMessage?: string | null;
  retentionExpiresAt: number;   // keyframe TTL (ms)
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

### TimelineSegment

The call's spine. Two sources, never mixed on one call:

- `source: "video"` — share / scene segments from Pass 2 frame sampling. Feeds `call_flow`.
- `source: "transcript"` — conversation phases derived from cue timestamps when there is no
  video. **Display only.** Video-dependent themes stay `applicable: false`; a transcript spine
  never makes `call_flow` scoreable (spec §6.5).

`videoFactsId` is null on transcript-derived segments — there is no Pass 2 doc to hang them off.

```typescript
{
  id: string;                 // tls_*
  callId: string;             // FK → PostCall.id
  videoFactsId: string | null; // FK → VideoFacts.id; null when source is "transcript"
  source: "video" | "transcript";
  startS: number;
  endS: number;
  segmentType:
    | "slides" | "product" | "cde" | "customer_screen" | "none" | "scene_change"  // video
    | "intro" | "discovery" | "demo" | "pricing" | "objection_handling" | "next_steps"; // transcript
  label?: string | null;
  ownerId: string;
  teamId: string;
  orgId: string;
}
```

### TimelineMarker

Moments pinned on the spine (spec §11.4). Derived deterministically from timestamped
transcript evidence — scorecard `evidenceJson[].atS`, and gap / objection / win verbatims
located back in the transcript. Requires cue timestamps, so a plain-text paste yields none.

Markers are evidence, not judgement: they never alter a score.

```typescript
{
  id: string;              // tlm_*
  callId: string;          // FK → PostCall.id
  atS: number;
  kind: "gap" | "objection" | "win" | "weak_cta";
  label: string;
  quote?: string | null;
  /** Theme the moment came from, when it originated in a scorecard line. */
  themeKey?: string | null;
  source: "transcript" | "video";
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
}
```

### FollowUp

Pass 7 commitment / next-step row. Queryable across calls (MoM-sent ratio, calls with no next step).

```typescript
{
  id: string;              // fu_*
  callId: string;          // FK → PostCall.id
  dealId: string | null;   // FK → Deal.id
  description: string;
  owner: "se" | "ae" | "customer";
  dueDate: string | null;  // ISO date or relative phrase from transcript
  status: "open" | "done" | "cancelled";
  sourceQuote: string | null;
  ownerId: string;         // SE owner — denormalized for RBAC
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

### Objection

Pass 7 objection raised on the call — handling quality and whether it landed.

```typescript
{
  id: string;              // obj_*
  callId: string;          // FK → PostCall.id
  objectionText: string;
  handling: string | null; // how the SE/AE responded
  landed: boolean;         // true if the objection was resolved / accepted
  theme: string | null;    // theme key or short label (e.g. pricing, security)
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

### MomDraft

Customer-facing minutes draft. **Only** customer-facing post-call output (spec §9). Never auto-send.

```typescript
{
  id: string;              // mom_*
  callId: string;          // FK → PostCall.id — one draft per call
  draftBody: string;       // flat copy/email form (diplomatic)
  editedBody: string | null; // human edit before send
  /** Kaia-style structured minutes — optional on older drafts. */
  outcome?: string | null;
  keyPoints?: Array<{ title: string; detail?: string | null }> | null;
  actionItems?: Array<{
    text: string;
    owner?: "se" | "ae" | "customer" | null;
    dueDate?: string | null;
    atS?: number | null;
    sourceQuote?: string | null;
  }> | null;
  sentAt: number | null;   // null = drafted but never sent (useful metric)
  sentBy: string | null;   // User.id who sent
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

### MeddpiccDelta

Per-call MEDDPICC movement (spec §2.2 snapshot-plus-delta). Current state on `Deal.metadata.meddpicc`; deltas record what changed and why.

```typescript
{
  id: string;              // mdd_*
  callId: string;          // FK → PostCall.id
  dealId: string;          // FK → Deal.id
  slot: MeddpiccFieldKey;  // metrics | economicBuyer | … | competition
  previous: MeddpiccFieldSlot | null;
  current: MeddpiccFieldSlot;
  changeType: "confirmed" | "changed" | "new";
  evidence: string;        // transcript quote or "not surfaced"
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

### TechnicalCommit

Deal-scoped **current state** for technical commit (spec §2.2, §10). Snapshot-plus-delta twin of
MeddpiccDelta — but TC lives in its own collection keyed by `dealId`, not on `Deal.metadata`.
Written by `POST /api/postcall/commit` (Pass 5).

**AI attach is not a boolean.** Spec §11.9: `aiAttach` is a first-class value with its own column
in the deal list, call context strip, TC tab, and pipeline review — product, agent scope, and
summary text (e.g. "Copilot 14/14").

```typescript
type TcStatus = "yes" | "no" | "pending" | "at_risk";

interface TcFieldSlot {
  value: string;
  evidence?: string;
}

/** First-class AI attach metric — not metadata, not a boolean. */
interface AiAttachValue {
  product?: string;           // e.g. "Copilot", "Agent"
  agentCount?: number;          // agents in scope (numerator)
  agentTotal?: number;          // total agents (denominator) — display as "14/14"
  summary?: string;             // human-readable roll-up for columns
  optedInAfterDemo?: boolean;   // customer opted in after being shown, not before
}

{
  id: string;              // tc_*
  dealId: string;          // FK → Deal.id — one snapshot per deal (natural key)
  accountId: string;
  status: TcStatus;
  justification: string | null;
  incumbent: TcFieldSlot | null;
  competitor: TcFieldSlot | null;
  identifiedRisk: TcFieldSlot | null;
  timelineForClosure: TcFieldSlot | null;
  reasonForEvaluation: TcFieldSlot | null;
  aiAttach: AiAttachValue | null;
  whatsWorking: TcFieldSlot | null;  // deal-level roll-up; per-call detail in what_works
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
```

### TcDelta

Per-call **movement** on technical commit (spec §2.2, §5 Pass 5, §10). Makes commit legible over
time — "TC = yes" as a static field tells you nothing about strengthening vs rotting.

```typescript
type TcFieldKey =
  | "incumbent"
  | "competitor"
  | "identifiedRisk"
  | "timelineForClosure"
  | "reasonForEvaluation"
  | "aiAttach"
  | "whatsWorking"
  | "status"
  | "justification";

type TcChangeType = "confirmed" | "changed" | "new";

type TcFieldValue = TcFieldSlot | AiAttachValue | TcStatus | string;

{
  id: string;              // tcd_*
  callId: string;          // FK → PostCall.id
  dealId: string;          // FK → Deal.id
  field: TcFieldKey;
  previous: TcFieldValue | null;
  current: TcFieldValue;
  changeType: TcChangeType;
  evidence: string;        // transcript quote or explicit "not surfaced"
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

### ProductGap

Pass 6 **negative product signal** (spec §8, ADR-006). One structured gap surfaced on one call —
queryable org-wide by taxonomy, gap type, and curation status. Never stored in `PostCall.analysis`.

```typescript
type GapDisposition = "hard_blocker" | "workaround_offered" | "roadmap_deflection" | "se_didnt_know";
type DealImpact = "blocker" | "friction" | "nice_to_have";
type GapType = "real_gap" | "enablement_gap";
type ProductGapStatus =
  | "draft"
  | "in_review"
  | "published"
  | "routed_enablement"
  | "published_enablement"
  | "dismissed"
  | "merged";

{
  id: string;              // pgap_*
  postCallId: string;      // FK → PostCall.id
  dealId: string;          // FK → Deal.id
  accountId: string;       // FK → Account.id
  productArea: string;     // Axis 1 — fixed enum (spec §8)
  subArea: string;         // Axis 1 sub-list for the area
  crossCuttingTags: string[]; // Axis 2 — data_residency, security_compliance, …
  verbatim: string;        // customer's own words — always retained
  disposition: GapDisposition;
  dealImpact: DealImpact;
  gapType: GapType;        // se_didnt_know → enablement_gap (routes to enablement)
  competitorNamed: { name: string; saidBetter: boolean } | null;
  arrTouched: number | null; // from PostCall.arrSnapshot at analysis time — never current deal ARR
  embedding: number[];     // over verbatim — for async clustering
  taxonomyVersion: string; // e.g. "1.0" — frozen at write time
  clusterId?: string | null; // FK → GapCluster.id
  status: ProductGapStatus;  // Pass 6 creates draft; PM publishes real gaps
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
```

Written by `POST /api/postcall/gaps` (Pass 6). `se_didnt_know` disposition routes to enablement,
not the PM backlog.

### WhatWorks

Pass 6 **positive product signal** (spec §8, ADR-006). What landed — case-study and reference
pipeline. Per-call detail; deal-level roll-up remains `TechnicalCommit.whatsWorking`.

```typescript
{
  id: string;              // ww_*
  postCallId: string;      // FK → PostCall.id
  accountId: string;       // FK → Account.id
  productArea: string;     // Axis 1 — fixed enum
  verbatim: string;        // customer praise in their words
  referenceCandidate: boolean;
  taxonomyVersion: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
```

Written by `POST /api/postcall/gaps` (Pass 6) alongside `productGaps`.

### GapCluster

Cross-call **verbatim embedding** clusters (spec §8, ADR-006). Async pipeline writes draft rows;
PM publishes labels. Clustering uses embeddings only — taxonomy fields are derived summaries.

```typescript
type GapClusterStatus = "draft" | "published" | "archived";

{
  id: string;              // gclus_*
  orgId: string;           // FK → Org.id
  label: string;           // PM-facing; machine-suggested in draft
  centroid: number[];      // mean member embedding (L2-normalized)
  dealCount: number;       // distinct dealId among member gaps
  arrTotal: number;        // sum of member gaps' snapshotted arrTouched
  status: GapClusterStatus;
  taxonomyVersion?: string | null;  // frozen when PM publishes
  productArea?: string | null;      // derived plurality — not authoritative
  crossCuttingTags?: string[];      // derived union — not authoritative
  supersededBy?: string[];          // when archived after split/merge
  createdAt: number;
  updatedAt: number;
}
```

Written by `POST /api/product-signal/cluster` async job. Gaps reference via `productGaps.clusterId`.

### DealSignal

Pass 8 **traction rollup** per call (spec §5, §9, §10). Hot / warm / cold — never a 0–100 score.
Aggregates across the deal's calls with time decay; consumes Pass 4 (MEDDPICC champion), Pass 5
(TC status when on file), Pass 7 (follow-ups, objections), and per-call `momentum` as one input.
Always carries visible `reasonsJson` and exactly one `recommendedAction`.

```typescript
type TractionLabel = "hot" | "warm" | "cold";

{
  id: string;              // dsig_*
  callId: string;          // FK → PostCall.id — one signal row per call after rollup
  dealId: string;          // FK → Deal.id
  traction: TractionLabel;
  reasonsJson: string[];   // visible reasons — never a naked label
  recommendedAction: string;
  daysSilent: number;      // since Deal.lastActivityAt
  nextStepOwner: string;   // se | ae | customer
  daysInStage: number;
  stageMedianDays: number; // median for closed deals at this stage (empirical or default)
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
```

Video-only signals (talk ratio, attendee drop-off, dead air) are listed in `reasonsJson` as gaps
when `videoFacts` is absent — never approximated from transcript.

Call notes (internal, blunt narrative) live on `PostCall.analysis.callNotes` — editable, not a separate collection.

### DealSummary

Pass 9 **deal-scoped narrative roll-up** (spec §5, §9, §11.6). Rewritten after every call on
the deal. Evidence-grounded — synthesizes call notes, traction, MEDDPICC/TC snapshots, and
commitments. **Does not overwrite** human or CRM fields on `Deal`.

```typescript
{
  id: string;              // dsum_*
  dealId: string;          // FK → Deal.id — natural key (one current row per deal)
  accountId: string;       // denormalized
  summary: string;
  generatedAt: number;
  sourceCallIds: string[]; // traceability + re-run when a call is re-analysed
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
```

### AccountSummary

Pass 9 **account-scoped narrative roll-up** (spec §5, §11.5). Spans **every call across every
deal** on the account — the cross-sell lens. Rewritten after every call on the account.
**Does not overwrite** human or CRM fields on `Account`.

```typescript
{
  id: string;              // asum_*
  accountId: string;       // FK → Account.id — natural key (one current row per account)
  summary: string;
  generatedAt: number;
  sourceCallIds: string[];
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
```

### PriceBook

Effective-dated base plan rows for ARR (spec §7.3). Org-wide reference — not scoped to
owner/team. Never overwrite a row; close with `effectiveTo` and insert a successor.

```typescript
{
  id: string;              // pb_* — seeded ids use deterministic slug (see ID_STANDARDS.md)
  product: string;         // freshdesk | freshdesk_omni | freshservice | freshsales
  tier: string;            // growth | pro | enterprise | starter (freshservice only)
  currency: string;        // USD | EUR | INR | …
  term: string;            // annual | monthly
  unit: string;            // agent_month | user_month
  price: number | null;    // null when quoteOnly:true — never display as zero
  quoteOnly: boolean;      // true → lookup returns explicit quote-only, no tier fallback
  effectiveFrom: string;   // ISO date YYYY-MM-DD
  effectiveTo: string | null;
  source: string;          // pricing page URL or internal book label
}
```

Seed source: [`worker/src/price-book-seed.ts`](../worker/src/price-book-seed.ts) · seed script:
[`worker/scripts/seed-price-book.mjs`](../worker/scripts/seed-price-book.mjs).

### AddonPriceBook

Effective-dated add-on rows (Copilot, AI Agent sessions, day passes, asset units, etc.).

```typescript
{
  id: string;              // apb_*
  addon: string;           // freddy_ai_copilot | freddy_ai_agent_sessions | day_pass | asset_units | …
  appliesTo: string[];     // product keys this row applies to
  requiresTier: string[];  // empty = any tier; else pro | enterprise | growth | …
  unit: string;            // agent_month | per_100_sessions | per_pass | per_500_units | …
  price: number | null;
  includedUnits: number;
  includedScope: string | null;  // once_per_account | per_billing_cycle | null
  quoteOnly: boolean;
  note: string | null;
  currency: string;
  term: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
```

### AssumptionsBook

Versioned constants for ARR derivation (e.g. conversation volume → sessions). Same
effective-dating rules as the price book.

```typescript
{
  id: string;              // asb_*
  key: string;             // ai_session_rate | peak_to_average_ratio | conversations_per_ticket
  scope: string;           // global | product | channel | region
  scopeValue: string | null;  // e.g. "voice", "freshdesk_omni", "IN" — null for global
  value: number;
  source: string;          // benchmark | internal_estimate | placeholder
  rationale: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: string;         // e.g. "2026-07-24-usd-list"
}
```

### ArrLine

Queryable ARR breakdown row (ADDON_ARR §4, spec §7.7). One row per priced or excluded line
emitted by `computeArr()` for a call. `Deal.arrEstimatePoint` is the sum of non-excluded lines on
the latest compute; lines are the derivation.

```typescript
type ArrLineKind = "base" | "addon";
type ArrExclusionReason =
  | "not_committed_spend"
  | "no_list_price"
  | "not_quantified"
  | "tier_conflict"
  | "peak_basis_unresolved"
  | null;

{
  id: string;              // arl_*
  dealId: string;          // FK → Deal.id
  accountId: string;       // FK → Account.id (denormalized)
  callId: string;          // FK → PostCall.id — snapshot source call
  kind: ArrLineKind;
  addonKey: string | null; // null for base
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  priceBookVersion: string;
  assumptionsBookVersion: string;
  annualValue: number;
  recurring: boolean;      // true for per-seat units; false for consumption (ADDON_ARR_MRR)
  stated: boolean;         // quantity actually said on the call
  inScope: boolean;        // discussed but unquantified
  excluded: boolean;
  exclusionReason: ArrExclusionReason;
  tierConflict?: boolean;
  confidence: number | null;
  evidence: string | null; // quote the quantity came from
  derivationJson: object[];  // full pricing chain (ADDON_ARR_VOLUME §4)
  computedAt: number;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
```

**PostCall.arrSnapshot** (value object on the call, not a collection): `{ arrEstimatePoint, arrEstimateLow?, arrEstimateHigh?, lines[], priceBookVersion, assumptionsBookVersion, computedAt }` — frozen at analysis time so gap attribution does not drift when the deal changes later.

### ArrOverride

Append-only log when an SE edits ARR inputs on a deal or confirms assumptions (ADDON_ARR_VOLUME §5).

```typescript
type ArrOverrideField =
  | "agents"
  | "conversationVolume"
  | "aiSessionRate"
  | "copilotSeats"
  | "connectorTasks"
  | "sessionDirectOverride"
  | "assumptionsConfirmed";

type ArrOverrideAction = "edit" | "confirm_assumptions";

{
  id: string;              // aov_*
  dealId: string;          // FK → Deal.id
  accountId: string;       // FK → Account.id (denormalized)
  field: ArrOverrideField;
  action: ArrOverrideAction;
  original: unknown | null; // JSON — value before change
  override: unknown | null; // JSON — value after change (null for confirm-only)
  arrEstimatePoint: number; // deal total ARR after this action
  displayUnit: "ARR" | "MRR" | null; // user toggle at time of edit
  userId: string;          // FK → User.id
  reason?: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
}
```

Deal-level field provenance lives on `Deal.metadata.arrEdits` (not a global assumptions_book mutation).

---

## ID generation

All entity IDs are created via the centralized module:

- Browser: [`web/domain/id.js`](../web/domain/id.js) — `newId("user")`, `newId("lifecycle")`, etc.
- Worker: [`worker/src/domain-model/id.ts`](../worker/src/domain-model/id.ts)

See [ID_STANDARDS.md](./ID_STANDARDS.md) for format and usage rules.

---

## What is explicitly not an entity (future)

These may become entities later; do **not** add IDs until the feature exists:

| Future concept | When to add |
|----------------|-------------|
| teamMembers join | SE on multiple teams is required |
| InsightTheme / tags | Tagging feature is scoped |
| orgId | Multi-tenant SaaS is required |

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [ID_STANDARDS.md](./ID_STANDARDS.md) | Prefix format, generator API |
| [RELATIONSHIPS.md](./RELATIONSHIPS.md) | FK fields, cardinalities |
| [adr/001-user-identity.md](./adr/001-user-identity.md) | Internal User.id vs Firebase auth |
| [adr/003-account-deal-engagement.md](./adr/003-account-deal-engagement.md) | Account backbone + Deal + engagement |
| [RBAC.md](./RBAC.md) | Role permissions |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Core vs extension boundaries |
