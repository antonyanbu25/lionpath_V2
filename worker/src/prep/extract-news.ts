import { extractFacts } from "./extract-facts";
import type { Env, ResearchFact, ResearchSnippet, SourceRef } from "./types";

const UNKNOWN = "unknown";

/** Playbook queries aimed at company news (must stay in sync with playbook.ts). */
const NEWS_QUERY =
  /news\s+OR\s+funding|acquisition\s+OR\s+partnership|CEO\s+OR\s+launches/i;

function isUnknown(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s === UNKNOWN || s === "-";
}

export function isNewsResearchQuery(query: string): boolean {
  return NEWS_QUERY.test(String(query || ""));
}

export function newsResearchSnippets(snippets: ResearchSnippet[]): ResearchSnippet[] {
  return (snippets || []).filter(
    (s) => isNewsResearchQuery(s.query) && !isUnknown(s.snippet),
  );
}

export function hasNewsCategoryFacts(facts: ResearchFact[]): boolean {
  return (facts || []).some((f) => f.category === "news" && !isUnknown(f.value));
}

/**
 * When the main extract pass omits category "news", run a focused pass on news-query
 * snippets only and force category news on every fact returned.
 */
export async function supplementNewsFacts(
  env: Env,
  snippets: ResearchSnippet[],
  facts: ResearchFact[],
  sources: SourceRef[],
  input: {
    companyName: string;
    companyDomain: string;
    emails: string[];
    additionalContext?: string;
  },
): Promise<{ facts: ResearchFact[]; sources: SourceRef[] }> {
  if (hasNewsCategoryFacts(facts)) {
    return { facts, sources };
  }

  const newsSnippets = newsResearchSnippets(snippets);
  if (!newsSnippets.length) {
    return { facts, sources };
  }

  const extracted = await extractFacts(env, newsSnippets, {
    ...input,
    sourceOffset: sources.length,
  });

  const newsFacts = (extracted.facts || []).map((f) => ({
    ...f,
    category: "news" as const,
  }));
  if (!newsFacts.length) {
    return { facts, sources };
  }

  const seen = new Set(facts.map((f) => `${f.category}:${f.key}:${f.value}`));
  const mergedFacts = [...facts];
  for (const f of newsFacts) {
    const key = `${f.category}:${f.key}:${f.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mergedFacts.push(f);
  }

  const byLabel = new Map(sources.map((s) => [s.label, s]));
  for (const s of extracted.sources) {
    if (!byLabel.has(s.label)) byLabel.set(s.label, s);
  }

  return { facts: mergedFacts, sources: [...byLabel.values()] };
}
