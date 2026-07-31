import type { Env, ResearchFact, SourceRef } from "../prep/types";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

interface ApolloOrgResponse {
  organization?: {
    name?: string;
    industry?: string;
    estimated_num_employees?: number;
    country?: string;
    city?: string;
    linkedin_url?: string;
    website_url?: string;
  };
}

interface ApolloPersonResponse {
  person?: {
    name?: string;
    title?: string;
    linkedin_url?: string;
    employment_history?: { organization_name?: string }[];
  };
}

export interface ApolloEnrichmentResult {
  facts: ResearchFact[];
  sources: SourceRef[];
  firmographics?: {
    industry?: string;
    employeeRange?: string;
    hqCountry?: string;
  };
  creditsUsed: number;
}

function employeeRange(n?: number): string | undefined {
  if (!n || n <= 0) return undefined;
  if (n < 50) return "1-49";
  if (n < 200) return "50-199";
  if (n < 1000) return "200-999";
  return "1000+";
}

async function apolloFetch(
  apiKey: string,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; data?: unknown; status: number }> {
  const url = new URL(`${APOLLO_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
    },
  });

  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  return { ok: true, data, status: res.status };
}

/** Apollo org + people enrich — skipped when APOLLO_API_KEY is unset. */
export async function enrichWithApollo(
  env: Env,
  companyDomain: string,
  emails: string[],
): Promise<ApolloEnrichmentResult> {
  const apiKey = env.APOLLO_API_KEY;
  if (!apiKey) {
    return { facts: [], sources: [], creditsUsed: 0 };
  }

  const facts: ResearchFact[] = [];
  const sources: SourceRef[] = [];
  let creditsUsed = 0;
  let firmographics: ApolloEnrichmentResult["firmographics"];

  const orgRes = await apolloFetch(apiKey, "/organizations/enrich", { domain: companyDomain });
  if (orgRes.ok) {
    creditsUsed += 1;
    const org = (orgRes.data as ApolloOrgResponse).organization;
    if (org) {
      const label = "S-Apollo";
      sources.push({
        label,
        title: "Apollo organization enrich",
        url: org.linkedin_url || org.website_url || `https://${companyDomain}`,
        confidence: 85,
      });

      if (org.industry) {
        facts.push({
          key: "Industry",
          value: org.industry,
          sourceLabel: label,
          sourceUrl: org.linkedin_url || org.website_url,
          confidence: 85,
          category: "account",
        });
      }
      const range = employeeRange(org.estimated_num_employees);
      if (range) {
        facts.push({
          key: "Company size",
          value: range,
          sourceLabel: label,
          sourceUrl: org.linkedin_url || org.website_url,
          confidence: 80,
          category: "account",
        });
      }
      firmographics = {
        industry: org.industry,
        employeeRange: range,
        hqCountry: org.country,
      };
    }
  }

  const personResults = await Promise.all(
    emails.slice(0, 5).map(async (email) => {
      const personRes = await apolloFetch(apiKey, "/people/match", { email });
      if (!personRes.ok) return null;
      return { email, person: (personRes.data as ApolloPersonResponse).person };
    }),
  );

  for (const hit of personResults) {
    if (!hit?.person?.name) continue;
    creditsUsed += 1;
    const { email, person } = hit;
    const label = `S-Apollo-${email.split("@")[0]}`;
    sources.push({
      label,
      title: `Apollo person: ${person.name}`,
      url: person.linkedin_url || "unknown",
      confidence: 80,
    });

    facts.push({
      key: `Prospect: ${email}`,
      value: `${person.name}${person.title ? ` — ${person.title}` : ""}`,
      sourceLabel: label,
      sourceUrl: person.linkedin_url,
      confidence: 80,
      category: "prospect",
    });
  }

  return { facts, sources, firmographics, creditsUsed };
}
