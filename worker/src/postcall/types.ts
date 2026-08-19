import type { PostCallTranscriptCacheBundle } from "../providers/gemini-cache";
import type { CallType } from "../rubric-profiles";
import type { PostCallAnalysis, PostCallResult } from "../postcall-schema";
import type { ZoomShareMedia } from "../zoomShare";
import type { ScorecardDraft } from "./scorecard";

export type { PostCallTranscriptCacheBundle };

/** Brief snapshot for Pass 0 matching — supplied by the web client from Firestore. */
export interface ResolveBriefSnapshot {
  id: string;
  accountId: string;
  dealId?: string | null;
  ownerId: string;
  createdAt: number;
  companyName: string;
  domain?: string | null;
  prospectEmails?: string[];
}

export interface ResolveAccountSnapshot {
  id: string;
  name: string;
  domain?: string | null;
  slug?: string;
}

export interface ResolveDealSnapshot {
  id: string;
  accountId: string;
  title: string;
  type: string;
  stage: string;
  status?: string;
  ownerId?: string;
}

export type PostCallSourceKind = "zoom" | "kaia" | "transcript";

/** Where the scoring transcript's text actually came from (v2.3 — see PostCallResolveResult.sources). */
export type TranscriptOrigin = "pasted" | "uploaded" | "zoom" | "kaia_api";

export interface PostCallResolveInput {
  transcript?: string;
  /**
   * v2.3 — how `transcript` was entered on the confirm form: typed/pasted into the textarea,
   * or loaded from a `.vtt`/`.srt`/`.txt` file upload. Defaults to "pasted" when omitted
   * (older clients, or callers that never had a file-upload UI to begin with).
   */
  transcriptOrigin?: "pasted" | "uploaded";
  recordingUrl?: string;
  recordingPassword?: string;
  meetingTitle?: string;
  /** Form company name — used for suggested company / weak matching. */
  companyName?: string;
  /** Extra participant emails (calendar invite, manual form). Primary match key. */
  participantEmails?: string[];
  ownerId?: string;
  /** Logged-in SE email — preferred SE identity hint. */
  ownerEmail?: string;
  /** Logged-in SE display name — preferred SE identity hint. */
  ownerDisplayName?: string;
  briefs?: ResolveBriefSnapshot[];
  accounts?: ResolveAccountSnapshot[];
  deals?: ResolveDealSnapshot[];
  /** v2.3 (Agent 3) — client-extracted LinkedIn "Save to PDF" text, for identity matching only. */
  linkedinProfileExports?: { fileName: string; text: string }[];
}

export type MatchSignalRank = 1 | 2 | 3 | 4 | 5;

export interface MatchReason {
  rank: MatchSignalRank;
  signal: string;
  detail: string;
}

export interface AccountMatchResult {
  accountId: string;
  accountName: string;
  score: number;
  reasons: MatchReason[];
  matchedBriefId?: string;
}

export interface DealMatchResult {
  dealId: string;
  accountId: string;
  title: string;
  type: string;
  stage: string;
  score: number;
  reasons: MatchReason[];
  preselected: boolean;
}

export interface VideoThemeApplicability {
  themeKey: string;
  applicable: false;
  reason: string;
}

/**
 * v2.3 — every source the SE actually supplied, fetched independently and kept distinct.
 * A Kaia link and a pasted/uploaded transcript can both be present at once (the documented
 * team process); this is what lets resolve keep Kaia's roster/title/startTime even when a
 * real transcript wins the `transcript` field, and vice versa. See resolve.ts precedence:
 * a real speaker-tagged transcript (`sources.transcript`) always wins the scoring transcript
 * over a Kaia summary (`sources.kaia`) — a Kaia summary is NEVER placed in `transcript`.
 */
export interface PostCallResolveSources {
  transcript?: {
    text: string;
    origin: TranscriptOrigin;
    hasTimestamps: boolean;
    speakers: string[];
  };
  kaia?: {
    summary: string;
    summaryJson?: string;
    participants: import("../prep/types").KaiaParticipantMeta[];
    title?: string;
    startTime?: string;
  };
  zoom?: {
    transcript: string;
    media?: ZoomShareMedia;
    topic?: string;
    startTime?: string;
  };
}

export interface PostCallResolveResult {
  transcript: string;
  meetingTitle?: string;
  /** How the transcript was obtained. Kept for back-compat — see `sources`/`sourcesUsed` for the full picture. */
  sourceKind: PostCallSourceKind;
  /** Every source the SE supplied, fetched independently (v2.3). */
  sources: PostCallResolveSources;
  /** Every source actually consumed (transcript origin + any fetched metadata used), e.g. ["pasted", "kaia_api"]. */
  sourcesUsed: string[];
  /**
   * True when only a Kaia summary exists — no real transcript from any source. `transcript`
   * is "" in this case; callers must surface this state explicitly rather than silently
   * scoring a summary as if it were a transcript (see Agent 4 — scorecard.ts / postcall.js).
   */
  summaryOnly: boolean;
  /** True when a Zoom media stream is available for Pass 2. */
  videoAvailable: boolean;
  /** Call start / time when known from Zoom/Kaia metadata. */
  callTime?: string;
  /** Duration minutes when known (media or transcript parse). */
  durationMinutes?: number | null;
  /** Best-effort SE identity hint (owner / SE-titled speaker). Never an AE-titled speaker. */
  seIdentity?: string;
  /** Best-effort AE identity hint (AE-titled speaker / remaining Freshworks speaker). */
  aeIdentity?: string;
  /** Best-effort customer identity hints (non-internal speakers / prospect emails). */
  customerIdentities?: string[];
  /** Speakers + emails the SE can pick from on the confirm gate. */
  identityOptions?: string[];
  participantEmails: string[];
  participantDomains: string[];
  freeMailDomains: string[];
  needsCompanyDomain: boolean;
  /** Themes that cannot be scored for this source (video-dependent). */
  videoThemesNotApplicable: VideoThemeApplicability[];
  analysisConfidence: number;
  transcriptMeta: {
    format: string;
    speakerCount: number;
    wordCount: number;
    durationMinutes: number | null;
    speakers: string[];
  };
  media?: ZoomShareMedia;
  account: AccountMatchResult | null;
  deals: DealMatchResult[];
  noMatch: {
    participantEmails: string[];
    participantDomains: string[];
    suggestedCompanyName?: string;
  } | null;
  /**
   * Speaker roster-merge + meeting-room segment suggestions (see ./speaker-attribution).
   * Suggestions only, rendered on the confirm page for the SE to accept/edit/reject —
   * never auto-applied. Omitted when the pass was skipped or failed (soft-fail).
   */
  speakerAttribution?: import("./speaker-attribution").SpeakerAttributionResult;
  /**
   * v2.3 (Agent 3) — identity extracted from each LinkedIn PDF export, matched by name
   * against transcript speakers / typed emails where possible. Identity and context only —
   * never fed to the scorecard as scoring evidence. Suggestions only, same as
   * speakerAttribution: rendered on the confirm page for the SE to accept/edit/reject.
   */
  linkedinIdentities?: import("./linkedin-identity").LinkedInIdentityMatch[];
}

export interface CallTypeMixEntry {
  type: CallType;
  weight: number;
}

export interface PostCallClassifyInput {
  transcript: string;
  meetingTitle?: string;
  userId?: string;
  callId?: string;
}

export interface PostCallClassifyResult {
  primary: CallType;
  mix: CallTypeMixEntry[];
  confidence: number;
}

export interface OverrideLogEntry {
  from: string;
  to: string;
  at: number;
}

/** One page of client-extracted deck PDF text (see `PostCallDeckContent`). */
export interface PostCallDeckSlideContent {
  page: number;
  text: string;
}

/**
 * Deck PDF, parsed client-side and sent as text only (bytes never leave the browser).
 * Replaces the old `deckLink` free-text field as the source of slide_deck scoring
 * evidence (v2.2) — see `resolveDeckVerdict` in ./deck-validate.
 */
export interface PostCallDeckContent {
  fileName: string;
  pageCount: number;
  slides: PostCallDeckSlideContent[];
  /**
   * Per-page geometry metrics computed by the client during PDF extraction (v2.3).
   * Used by the worker-side relevance gate (`deck-validate.ts`) alongside the
   * LLM validation result to produce the authoritative `deckVerdict`.
   */
  shape?: {
    /** Fraction of pages where width > height (0..1). Decks are overwhelmingly > 0.6. */
    landscapePct: number;
    /** Median word count across all pages. Dense prose > 250; slides typically < 150. */
    medianWordsPerPage: number;
    /** Total page count — mirrors `pageCount`, convenient for gate checks. */
    pageCount: number;
  };
  /**
   * Client-side shape verdict based purely on geometry + word density.
   * Advisory only — the worker's `resolveDeckVerdict` is authoritative.
   */
  deckShapeVerdict?: "likely_deck" | "unlikely_deck";
}

export type { ConfirmedRoomAttribution, ConfirmedRoomAttributionSpan } from "./speaker-attribution";

/**
 * SE-confirmed identities from the confirm page (page 2) — structured, in addition to the
 * free-text `additionalContext` identities block used by the narrative pass. Threaded into
 * scoring so SE-execution credit is only ever attributed to a confirmed SE (see generate.ts /
 * scorecard.ts `identitiesContext` + `buildEffectiveTranscriptForScoring`).
 */
export interface ConfirmedIdentities {
  seIdentity?: string;
  secondarySeIdentities?: string[];
  aeIdentity?: string;
  customerIdentities?: string[];
  partnerIdentities?: string[];
  generalManagerIdentities?: string[];
  executiveIdentities?: string[];
  roomAttributions?: import("./speaker-attribution").ConfirmedRoomAttribution[];
}

export interface PostCallGenerateInput {
  transcript?: string;
  recordingUrl?: string;
  recordingPassword?: string;
  companyName?: string;
  meetingTitle?: string;
  meetingDate?: string;
  additionalContext?: string;
  /**
   * @deprecated Legacy free-text deck URL (v2.1). No longer populated by the intake
   * UI as of the deck-PDF-evaluation change (v2.2) — a bare link let the scorer
   * invent slide_deck evidence with nothing to ground it. Kept readable so historical
   * records still display it; use `deckContent` for anything scoring-relevant.
   */
  deckLink?: string;
  /** Parsed deck PDF — client-extracted text, capped, per-slide/page. */
  deckContent?: PostCallDeckContent | null;
  /**
   * SE-confirmed identities + meeting-room attributions from the confirm page — structured
   * (in addition to the free-text identities block already folded into `additionalContext`).
   * Drives identity-aware scoring in ./generate.ts → ./scorecard.ts.
   */
  confirmedIdentities?: ConfirmedIdentities;
  prospectEmails?: string[];
  linkedinProfileExports?: { fileName: string; text: string }[];
  effort?: string;
  lifecycleId?: string;
  dealId?: string | null;
  accountId?: string | null;
  callType?: CallType;
  callTypeOverride?: OverrideLogEntry;
  dealMatchOverride?: OverrideLogEntry;
  /** When true, run analysis only (resolve/classify already done). */
  confirmed?: boolean;
  /** Legacy one-shot — skip human gate, auto-pick top match. */
  legacyAutoConfirm?: boolean;
  /** Usage attribution — set by route handlers. */
  userId?: string;
  callId?: string;
  /** Gemini transcript cache handles from POST /api/postcall/cache/prepare. */
  transcriptCaches?: PostCallTranscriptCacheBundle;
}

export interface PostCallGenerateResult extends PostCallResult {
  resolve?: PostCallResolveResult;
  classify?: PostCallClassifyResult;
  /** Pass 3 QIP draft — persist to scorecards/scorecardLines; not in analysis blob. */
  scorecard?: ScorecardDraft;
  /** Pass 2 draft — persist to videoFacts/timelineSegments; not in analysis blob. */
  videoFacts?: import("../domain-model/video-facts").VideoFactsDraft;
  confirmed?: {
    accountId?: string | null;
    dealId?: string | null;
    callType: CallType;
    callTypeOverride?: OverrideLogEntry;
    dealMatchOverride?: OverrideLogEntry;
  };
  analysisMeta?: {
    callType: CallType;
    callTypeConfidence?: number;
    callTypeMix?: CallTypeMixEntry[];
    matchMethod?: string;
    matchConfidence?: number;
    sourceKind?: PostCallSourceKind;
    videoAvailable?: boolean;
    videoPassStatus?: string;
    analysisConfidence?: number;
    provisional?: boolean;
    rubricVersion?: string;
    videoThemesNotApplicable?: VideoThemeApplicability[];
    deckLink?: string;
    /**
     * Three-state deck verdict from the worker-side gate (v2.3).
     * `deck_valid` — deck accepted for scoring.
     * `deck_rejected` — upload failed shape/relevance gate (junk upload, wrong doc, etc.).
     * `deck_absent` — nothing uploaded and no video slide evidence.
     * Recorded here so the result card can inform the SE when their upload didn't count.
     */
    deckVerdict?: "deck_valid" | "deck_rejected" | "deck_absent";
    /** Human-readable explanation when `deckVerdict === "deck_rejected"` (max 20 words). */
    deckRejectionReason?: string;
    /**
     * v2.3 (Agent 4) — true when this call has only a Kaia summary and no real transcript from
     * any source (see PostCallResolveResult.summaryOnly). No timestamped evidence exists, so
     * scoring confidence lands well below HIGH_CONFIDENCE_THRESHOLD and the call is already
     * silently excluded from coaching aggregates — this makes that state visible on the result
     * card instead, with a prompt to attach the transcript.
     */
    summaryOnly?: boolean;
  };
}

export type { PostCallAnalysis };
