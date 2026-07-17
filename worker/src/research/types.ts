/** Shared types for the pre-LLM research pipeline. */

export interface ResearchEnv {
  ZOOMINFO_API_KEY?: string;
}

export interface ResearchInput {
  companyName: string;
  domain: string;
  emails: string[];
  prospectName?: string;
}

export interface PersonResearchFragment {
  source: string;
  email: string;
  name?: string;
  role?: string;
  totalExperience?: string;
  experienceSummary?: string;
  priorEmployers?: string[];
  competitorTouchpoints?: string[];
  snippets?: string[];
  url?: string;
  confidence: number;
}

export interface CompanyResearchFragment {
  source: string;
  snippets: string[];
  url?: string;
  confidence: number;
}

export interface ValidatedProspectResearch {
  email: string;
  name: string;
  role: string;
  totalExperience: string;
  experienceSummary: string;
  priorEmployers: string[];
  competitorTouchpoints: string[];
  sourceLabel: string;
  sourceUrl: string;
  confidence: number;
}

export interface ValidatedResearchContext {
  companySnippets: string[];
  prospects: ValidatedProspectResearch[];
  /** Pre-formatted block injected into the prep user prompt. */
  promptBlock: string;
}
