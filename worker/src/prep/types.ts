import type { Prep } from "../schema";
import type { ProviderEnv } from "../providers/types";

export type PrepType = "new_business" | "expansion";

export type Env = ProviderEnv & {
  APOLLO_API_KEY?: string;
};

export interface ResearchFact {
  key: string;
  value: string;
  sourceLabel: string;
  sourceUrl?: string;
  confidence?: number;
  category?: "account" | "signal" | "prospect" | "support" | "news";
}

export interface SourceRef {
  label: string;
  title: string;
  url: string;
  confidence: number;
}

export interface ResearchSnippet {
  query: string;
  snippet: string;
  fetchedAt: number;
}

export interface ResearchBundle {
  lastResearchedAt: number;
  inputHash: string;
  facts: ResearchFact[];
  sources: SourceRef[];
  snippets: ResearchSnippet[];
  playbookVersion: string;
  enrichmentProvider?: "apollo" | null;
}

export interface AccountResearchMetadata {
  research?: ResearchBundle;
  firmographics?: {
    industry?: string;
    employeeRange?: string;
    hqCountry?: string;
    [key: string]: unknown;
  };
  sfAccountId?: string;
  bikalAccountId?: string;
}

export interface ContactResearchMetadata {
  research?: {
    lastResearchedAt: number;
    experienceSummary?: string;
    priorEmployers?: string[];
    competitorTouchpoints?: string[];
    sourceUrls?: string[];
  };
  disc?: {
    profile?: string;
    assessedAt?: number;
  };
}

export interface PrepInput {
  companyName?: string;
  companyDomain: string;
  prospectEmail: string;
  prospectEmails?: string[];
  prospectName?: string;
  additionalContext?: string;
  meetingType?: string;
  ae?: string;
  effort?: string;
  prepType?: PrepType;
  forceRefresh?: boolean;
  cachedResearch?: ResearchBundle | null;
  confirmedFacts?: ResearchFact[];
  linkedinProfileExports?: Array<{ fileName: string; text: string }>;
  confirmedProspectProfiles?: import("./merge-enrichment").ConfirmedProspectProfile[];
  meetingZoomUrl?: string;
  meetingZoomPasscode?: string;
  kaiaMeetingUrl?: string;
  kaiaSummary?: string;
  kaiaContent?: KaiaShareBundle;
  /** Client context for artifact linking — not used in prep generation. */
  lifecycleId?: string;
  dealId?: string | null;
}

/** Prep input after normalizePrepInput — companyName is always resolved. */
export type NormalizedPrepInput = PrepInput & { companyName: string };

export interface ResearchMeta {
  cacheHit: boolean;
  playbookSkipped: boolean;
  steps: Record<string, number>;
  inputHash: string;
  lowConfidence: string[];
  costEstimate?: {
    llmCalls: number;
    apolloCredits: number;
  };
  linkedinMatchedEmails?: string[];
}

export interface PrepResult {
  prep: Prep;
  researchMeta: ResearchMeta;
  researchBundle: ResearchBundle;
  contactDrafts?: Array<{
    email: string;
    name?: string;
    role?: string;
    metadata?: ContactResearchMetadata;
  }>;
}

export interface ResearchOnlyResult {
  accountDraft: {
    name: string;
    domain: string;
    slug: string;
  };
  contactDrafts: Array<{ email: string; name?: string; role?: string }>;
  facts: ResearchFact[];
  sources: SourceRef[];
  snippets: ResearchSnippet[];
  lowConfidence: string[];
  researchMeta: ResearchMeta;
  researchBundle: ResearchBundle;
}

export const PLAYBOOK_VERSION = "2";

export interface KaiaParticipantMeta {
  displayName: string;
  isHost?: boolean;
}

/** Client or worker-fetched Kaia bundle for research + per-prospect matching. */
export interface KaiaShareBundle {
  summary: string;
  title?: string;
  startTime?: string;
  participants?: KaiaParticipantMeta[];
  summaryJson?: string;
}
export const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
