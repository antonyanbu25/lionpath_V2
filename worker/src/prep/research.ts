import { getResearchProvider } from "../providers";
import type { LlmProvider } from "../providers/types";
import type { Env, ResearchSnippet } from "./types";
import { buildPlaybookQueries } from "./playbook";
import {
  dedupeCitations,
  normalizeCitations,
  resolveRedirectUrls,
  type VerifiedCitation,
} from "./citations";

const SEARCH_SYSTEM =
  "You are a research assistant. Run the web search implied by the user query and return a concise factual summary (max 400 words). Include specific URLs when found. If nothing useful is found, say so plainly.";

const PLAYBOOK_QUERY_CONCURRENCY = 4;

/** Run async tasks with bounded concurrency. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<ResearchSnippet>,
): Promise<ResearchSnippet[]> {
  if (!items.length) return [];
  const results: ResearchSnippet[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Run web-search queries with bounded concurrency; log and skip individual failures. */
export async function runResilientResearchQueries(
  provider: LlmProvider,
  queries: string[],
  input: { companyName: string; companyDomain: string },
  label: (query: string, index: number) => string,
  errorsOut?: string[],
): Promise<ResearchSnippet[]> {
  const fetchedAt = Date.now();

  const results = await runWithConcurrency(queries, PLAYBOOK_QUERY_CONCURRENCY, async (query, index) => {
    const step = label(query, index);
    try {
      const result = await provider.generate({
        system: SEARCH_SYSTEM,
        user: `Research query: ${query}\nCompany: ${input.companyName} (${input.companyDomain})`,
        maxTokens: 1200,
        temperature: 0,
        research: true,
        effort: "low",
        step,
      });
      const citations = dedupeCitations(normalizeCitations(result.citations));
      return {
        query,
        snippet: result.text.trim(),
        fetchedAt,
        origin: "grounded" as const,
        ...(citations.length ? { citations } : {}),
        ...(result.searchQueries?.length ? { searchQueries: result.searchQueries } : {}),
      };
    } catch (err) {
      const message = (err as Error).message;
      console.warn(`${step} (${query.slice(0, 80)}):`, message);
      errorsOut?.push(message);
      return { query, snippet: "", fetchedAt };
    }
  });

  const kept = results.filter((r) => r.snippet.length > 0);

  // Redirect links are short-lived, so resolve them now rather than storing
  // grounding redirects in a bundle that is cached for 30 days.
  return resolveSnippetCitations(kept);
}

/** Resolve grounding redirects across a snippet set in one bounded pass. */
async function resolveSnippetCitations(snippets: ResearchSnippet[]): Promise<ResearchSnippet[]> {
  const flat: VerifiedCitation[] = [];
  const spans: { start: number; count: number }[] = [];
  for (const s of snippets) {
    spans.push({ start: flat.length, count: s.citations?.length || 0 });
    if (s.citations?.length) flat.push(...s.citations);
  }
  if (!flat.length) return snippets;

  const resolved = await resolveRedirectUrls(flat);
  return snippets.map((s, i) => {
    const { start, count } = spans[i];
    if (!count) return s;
    return { ...s, citations: resolved.slice(start, start + count) };
  });
}

export async function runPlaybookResearch(
  env: Env,
  input: { companyName: string; companyDomain: string; emails: string[] },
  options?: { skipLinkedInForEmails?: Set<string> },
): Promise<ResearchSnippet[]> {
  const provider = getResearchProvider(env);
  const queries = buildPlaybookQueries(input, options);
  const errors: string[] = [];
  const snippets = await runResilientResearchQueries(
    provider,
    queries,
    { companyName: input.companyName, companyDomain: input.companyDomain },
    (_query, index) => `prep/research query ${index + 1}/${queries.length}`,
    errors,
  );

  if (!snippets.length) {
    throw new Error(
      `prep/research: all ${queries.length} queries failed — ${summarizeResearchFailure(errors)}`,
    );
  }

  return snippets;
}

/** Surface *why* every query failed; the raw provider error is otherwise only in worker logs. */
function summarizeResearchFailure(errors: string[]): string {
  if (!errors.length) return "no snippets returned";

  const joined = errors.join(" ");
  if (/API[_ ]KEY[_ ]INVALID|API key not valid/i.test(joined)) {
    return "the Gemini API key was rejected as invalid. The worker reads worker/.dev.vars only at startup, so restart it after changing GEMINI_API_KEY.";
  }
  if (/\b(401|403)\b|PERMISSION_DENIED|UNAUTHENTICATED/i.test(joined)) {
    return "the Gemini API key was rejected (not authorized). Check GEMINI_API_KEY and that the Generative Language API is enabled.";
  }
  if (/RESOURCE_EXHAUSTED|\b429\b|quota/i.test(joined)) {
    return "the Gemini API quota or rate limit was exceeded. Retry shortly or use a key with more quota.";
  }

  // Unknown cause — pass the provider's own first line through so it is diagnosable.
  const first = errors[0].replace(/\s+/g, " ").trim();
  return `no snippets returned. First error: ${first.slice(0, 300)}`;
}
