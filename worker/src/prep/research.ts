import { getResearchProvider } from "../providers";
import type { LlmProvider } from "../providers/types";
import type { Env, ResearchSnippet } from "./types";
import { buildPlaybookQueries } from "./playbook";

const SEARCH_SYSTEM =
  "You are a research assistant. Run the web search implied by the user query and return a concise factual summary (max 400 words). Include specific URLs when found. If nothing useful is found, say so plainly.";

/** Run web-search queries in parallel; log and skip individual failures. */
export async function runResilientResearchQueries(
  provider: LlmProvider,
  queries: string[],
  input: { companyName: string; companyDomain: string },
  label: (query: string, index: number) => string,
): Promise<ResearchSnippet[]> {
  const fetchedAt = Date.now();

  const results = await Promise.all(
    queries.map(async (query, index) => {
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
        return { query, snippet: result.text.trim(), fetchedAt };
      } catch (err) {
        console.warn(`${step} (${query.slice(0, 80)}):`, (err as Error).message);
        return { query, snippet: "", fetchedAt };
      }
    }),
  );

  return results.filter((r) => r.snippet.length > 0);
}

export async function runPlaybookResearch(
  env: Env,
  input: { companyName: string; companyDomain: string; emails: string[] },
  options?: { skipLinkedInForEmails?: Set<string> },
): Promise<ResearchSnippet[]> {
  const provider = getResearchProvider(env);
  const queries = buildPlaybookQueries(input, options);
  const snippets = await runResilientResearchQueries(
    provider,
    queries,
    { companyName: input.companyName, companyDomain: input.companyDomain },
    (_query, index) => `prep/research query ${index + 1}/${queries.length}`,
  );

  if (!snippets.length) {
    throw new Error(
      `prep/research: all ${queries.length} queries failed — no snippets returned`,
    );
  }

  return snippets;
}
