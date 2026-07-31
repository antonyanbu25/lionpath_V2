import type { ValidatedResearchContext } from "../research/types";
import { DIRECT_FETCH_CONFIDENCE, citationDomain } from "./citations";
import { sourceDisplayName } from "./source-display";
import type { ResearchFact, ResearchSnippet, SourceRef } from "./types";

export function orchestratorToSnippets(ctx: ValidatedResearchContext): ResearchSnippet[] {
  const fetchedAt = Date.now();
  const out: ResearchSnippet[] = [];

  if (ctx.companyPages?.length) {
    // One snippet per fetched page, so each carries the URL it came from. We fetched
    // these ourselves, so they need no redirect resolution.
    for (const page of ctx.companyPages) {
      const domain = citationDomain(page.url);
      out.push({
        query: `company_web:${page.url}`,
        snippet: page.snippet.slice(0, 2000),
        fetchedAt,
        origin: "company_web",
        citations: [
          {
            uri: page.url,
            domain,
            title: domain || "Company website",
            confidence: page.confidence || DIRECT_FETCH_CONFIDENCE,
          },
        ],
      });
    }
  } else if (ctx.companySnippets.length) {
    // Fallback for contexts built before companyPages existed.
    out.push({
      query: "orchestrator:company_web",
      snippet: ctx.companySnippets.join("\n\n").slice(0, 2000),
      fetchedAt,
      origin: "company_web",
    });
  }

  for (const p of ctx.prospects) {
    const parts = [
      p.name !== "unknown" ? `Name: ${p.name}` : "",
      p.role !== "unknown" ? `Role: ${p.role}` : "",
      p.totalExperience !== "unknown" ? `Experience: ${p.totalExperience}` : "",
      p.experienceSummary !== "unknown" ? p.experienceSummary : "",
      p.priorEmployers.length ? `Employers: ${p.priorEmployers.join(", ")}` : "",
      p.competitorTouchpoints.length ? `Competitors: ${p.competitorTouchpoints.join(", ")}` : "",
    ].filter(Boolean);
    if (!parts.length) continue;
    const url = /^https?:\/\//i.test(p.sourceUrl || "") ? p.sourceUrl : "";
    const domain = url ? citationDomain(url) : "";
    out.push({
      query: `orchestrator:prospect:${p.email}`,
      snippet: parts.join(". "),
      fetchedAt,
      origin: "orchestrator",
      ...(url
        ? {
            citations: [
              {
                uri: url,
                domain,
                title: domain || "Web / LinkedIn research",
                confidence: p.confidence || 60,
              },
            ],
          }
        : {}),
    });
  }

  if (ctx.promptBlock) {
    out.push({
      query: "orchestrator:prompt_block",
      snippet: ctx.promptBlock.slice(0, 2500),
      fetchedAt,
    });
  }

  return out;
}

export function orchestratorToFacts(ctx: ValidatedResearchContext): {
  facts: ResearchFact[];
  sources: SourceRef[];
} {
  const facts: ResearchFact[] = [];
  const sources: SourceRef[] = [];

  for (const p of ctx.prospects) {
    const label = p.sourceLabel || "Orchestrator";
    if (!sources.some((s) => s.label === label)) {
      const source: SourceRef = {
        label,
        title: "Web / LinkedIn research",
        url: p.sourceUrl || "orchestrator",
        confidence: p.confidence || 60,
      };
      source.displayName = sourceDisplayName(source);
      sources.push(source);
    }
    if (p.name && p.name !== "unknown") {
      facts.push({
        key: `prospect:${p.email}:name`,
        value: p.name,
        sourceLabel: label,
        sourceUrl: p.sourceUrl || "orchestrator",
        confidence: p.confidence || 60,
        category: "prospect",
      });
    }
    if (p.role && p.role !== "unknown") {
      facts.push({
        key: `prospect:${p.email}:role`,
        value: p.role,
        sourceLabel: label,
        sourceUrl: p.sourceUrl || "orchestrator",
        confidence: p.confidence || 60,
        category: "prospect",
      });
    }
    if (p.experienceSummary && p.experienceSummary !== "unknown") {
      facts.push({
        key: `prospect:${p.email}:experience`,
        value: p.experienceSummary,
        sourceLabel: label,
        sourceUrl: p.sourceUrl || "orchestrator",
        confidence: p.confidence || 60,
        category: "prospect",
      });
    }
  }

  if (ctx.companySnippets.length && !sources.some((s) => s.label === "Orchestrator")) {
    sources.push({
      label: "Orchestrator",
      title: "Company website",
      url: "company-web",
      confidence: 65,
      displayName: "Company website",
    });
  }

  return { facts, sources };
}
