import { getResearchProvider } from "../providers";
import { SIGNAL_LABELS } from "../schema";
import { extractFacts } from "./extract-facts";
import { runResilientResearchQueries } from "./research";
import type { Env, ResearchFact, ResearchSnippet, SourceRef } from "./types";

const MAX_GAP_QUERIES = 3;

function isUnknown(value: unknown): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  return !s || s === "unknown" || s === "-";
}

export function buildGapQueries(input: {
  companyName: string;
  companyDomain: string;
  emails: string[];
  facts: ResearchFact[];
}): string[] {
  const queries: string[] = [];
  const { companyName, companyDomain, emails } = input;

  const signalFacts = new Set(
    input.facts.filter((f) => f.category === "signal").map((f) => f.key),
  );
  for (const label of SIGNAL_LABELS) {
    if (signalFacts.has(label)) continue;
    if (label === "Incumbent tool") {
      queries.push(`site:${companyDomain} (zendesk OR intercom OR freshdesk OR "help center")`);
    } else if (label === "Hiring support roles") {
      queries.push(`site:${companyDomain} (careers OR jobs OR hiring) support`);
    } else if (queries.length < MAX_GAP_QUERIES) {
      queries.push(`"${companyName}" ${label.toLowerCase()} support`);
    }
    if (queries.length >= MAX_GAP_QUERIES) break;
  }

  const hasProspectName = input.facts.some(
    (f) => f.category === "prospect" && f.key.includes(":name") && !isUnknown(f.value),
  );
  if (!hasProspectName && emails.length && queries.length < MAX_GAP_QUERIES) {
    const email = emails[0];
    const local = email.split("@")[0]?.replace(/[.+]/g, " ").trim();
    if (local) {
      queries.push(`"${local}" "${companyName}" site:linkedin.com/in`);
    }
  }

  return queries.slice(0, MAX_GAP_QUERIES);
}

async function runGapQueries(
  env: Env,
  queries: string[],
  companyName: string,
  companyDomain: string,
): Promise<ResearchSnippet[]> {
  if (!queries.length) return [];
  const provider = getResearchProvider(env);
  return runResilientResearchQueries(
    provider,
    queries,
    { companyName, companyDomain },
    (query) => `prep/gap-research: ${query.slice(0, 60)}`,
  );
}

/** Targeted follow-up searches for remaining gaps; merges new facts. */
export async function fillResearchGaps(
  env: Env,
  input: {
    companyName: string;
    companyDomain: string;
    emails: string[];
    additionalContext?: string;
  },
  snippets: ResearchSnippet[],
  facts: ResearchFact[],
  sources: SourceRef[],
): Promise<{ snippets: ResearchSnippet[]; facts: ResearchFact[]; sources: SourceRef[] }> {
  const gapQueries = buildGapQueries({
    companyName: input.companyName,
    companyDomain: input.companyDomain,
    emails: input.emails,
    facts,
  });
  if (!gapQueries.length) return { snippets, facts, sources };

  const gapSnippets = await runGapQueries(
    env,
    gapQueries,
    input.companyName,
    input.companyDomain,
  );
  if (!gapSnippets.length) return { snippets, facts, sources };

  const extracted = await extractFacts(env, gapSnippets, {
    companyName: input.companyName,
    companyDomain: input.companyDomain,
    emails: input.emails,
    additionalContext: input.additionalContext,
  });

  const seen = new Set(facts.map((f) => `${f.category}:${f.key}:${f.value}`));
  const mergedFacts = [...facts];
  for (const f of extracted.facts) {
    const key = `${f.category}:${f.key}:${f.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mergedFacts.push(f);
  }

  const byLabel = new Map(sources.map((s) => [s.label, s]));
  for (const s of extracted.sources) {
    if (!byLabel.has(s.label)) byLabel.set(s.label, s);
  }

  return {
    snippets: [...snippets, ...gapSnippets],
    facts: mergedFacts,
    sources: [...byLabel.values()],
  };
}
