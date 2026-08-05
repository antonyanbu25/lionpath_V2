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

export interface PostCallResolveInput {
  transcript?: string;
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

export interface PostCallResolveResult {
  transcript: string;
  meetingTitle?: string;
  /** How the transcript was obtained. */
  sourceKind: PostCallSourceKind;
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

export interface PostCallGenerateInput {
  transcript?: string;
  recordingUrl?: string;
  recordingPassword?: string;
  companyName?: string;
  meetingTitle?: string;
  meetingDate?: string;
  additionalContext?: string;
  /** Optional deck URL — stored only; processing deferred (spec §3.4). */
  deckLink?: string;
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
  };
}

export type { PostCallAnalysis };
