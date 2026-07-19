/** Company being sold to — stable identity shared across SE lifecycles. */

export interface AccountResearchMetadata {
  research?: {
    lastResearchedAt: number;
    inputHash: string;
    facts: Array<{
      key: string;
      value: string;
      sourceLabel: string;
      sourceUrl?: string;
      confidence?: number;
      category?: string;
    }>;
    sources: Array<{ label: string; title: string; url: string; confidence: number }>;
    snippets?: Array<{ query: string; snippet: string; fetchedAt: number }>;
    playbookVersion: string;
    enrichmentProvider?: "apollo" | null;
  };
  firmographics?: {
    industry?: string;
    employeeRange?: string;
    hqCountry?: string;
    [key: string]: unknown;
  };
  sfAccountId?: string;
  bikalAccountId?: string;
}

export interface AccountMetadata extends AccountResearchMetadata {
  [key: string]: unknown;
}

export interface Account {
  id: string;
  name: string;
  domain: string | null;
  slug: string;
  industry?: string;
  metadata?: AccountMetadata;
  createdAt: number;
  updatedAt: number;
}

/** Normalize company name to a lookup slug — prefers explicit company domain. */
export function normalizeAccountSlug(name: string, domain?: string | null): string {
  if (domain) {
    const fromDomain = String(domain)
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9.-]+/g, "")
      .slice(0, 48);
    if (fromDomain) return fromDomain;
  }
  const fromName = String(name || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return fromName || "account";
}

/** Extract primary domain from an email address. */
export function domainFromEmail(email: string): string | null {
  const parts = String(email || "").trim().toLowerCase().split("@");
  if (parts.length !== 2 || !parts[1]) return null;
  return parts[1].replace(/^www\./, "");
}

export const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isAccountResearchFresh(metadata: AccountMetadata | undefined, inputHash: string): boolean {
  const r = metadata?.research;
  if (!r?.lastResearchedAt || r.inputHash !== inputHash) return false;
  return Date.now() - r.lastResearchedAt < RESEARCH_TTL_MS;
}
