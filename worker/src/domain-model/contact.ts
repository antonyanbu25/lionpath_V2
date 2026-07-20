/** Person at an account — always belongs to exactly one account. */

export type DiscPrimary = "D" | "I" | "S" | "C" | "unknown";
export type ConfidenceLevel = "low" | "medium" | "high";
export type InfluenceLevel = "high" | "medium" | "low" | "unknown";
export type DecisionRole =
  | "economic_buyer"
  | "champion"
  | "influencer"
  | "blocker"
  | "unknown";
export type ContactFieldSource = "prep" | "postcall" | "manual";

export interface ContactDiscMetadata {
  primary?: DiscPrimary;
  secondary?: string;
  confidence?: ConfidenceLevel;
  evidence?: string[];
  assessedAt?: number;
  source?: ContactFieldSource;
}

export interface ContactInfluenceMetadata {
  level?: InfluenceLevel;
  decisionRole?: DecisionRole;
  source?: ContactFieldSource;
  updatedAt?: number;
}

export interface ContactResearchMetadata {
  research?: {
    lastResearchedAt: number;
    experienceSummary?: string;
    priorEmployers?: string[];
    competitorTouchpoints?: string[];
    sourceUrls?: string[];
  };
  disc?: ContactDiscMetadata;
  influence?: ContactInfluenceMetadata;
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
