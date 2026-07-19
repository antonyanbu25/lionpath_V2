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
  companyName: string;
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
}

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

export const PLAYBOOK_VERSION = "1";
export const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
