/** Person at an account — always belongs to exactly one account. */

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

export interface ContactMetadata extends ContactResearchMetadata {
  [key: string]: unknown;
}

export interface Contact {
  id: string;
  accountId: string;
  email: string;
  name?: string;
  title?: string;
  role?: string;
  metadata?: ContactMetadata;
  createdAt: number;
  updatedAt: number;
}
