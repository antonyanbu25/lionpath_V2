import type { ValidatedResearchContext } from "../research/types";
import type { ResearchFact, ResearchSnippet, SourceRef } from "./types";

export function orchestratorToSnippets(ctx: ValidatedResearchContext): ResearchSnippet[] {
  const fetchedAt = Date.now();
  const out: ResearchSnippet[] = [];

  if (ctx.companySnippets.length) {
    out.push({
      query: "orchestrator:company_web",
      snippet: ctx.companySnippets.join("\n\n").slice(0, 2000),
      fetchedAt,
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
    out.push({
      query: `orchestrator:prospect:${p.email}`,
      snippet: parts.join(". "),
      fetchedAt,
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
      sources.push({
        label,
        title: "Web / LinkedIn research",
        url: p.sourceUrl || "orchestrator",
        confidence: p.confidence || 60,
      });
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
    });
  }

  return { facts, sources };
}
