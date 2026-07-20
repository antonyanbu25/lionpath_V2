import { getProvider } from "../providers";
import type { Env, ResearchSnippet } from "./types";
import { buildPlaybookQueries } from "./playbook";

const SEARCH_SYSTEM =
  "You are a research assistant. Run the web search implied by the user query and return a concise factual summary (max 400 words). Include specific URLs when found. If nothing useful is found, say so plainly.";

export async function runPlaybookResearch(
  env: Env,
  input: { companyName: string; companyDomain: string; emails: string[] },
  options?: { skipLinkedInForEmails?: Set<string> },
): Promise<ResearchSnippet[]> {
  const provider = getProvider(env);
  const queries = buildPlaybookQueries(input, options);
  const fetchedAt = Date.now();

  const results = await Promise.all(
    queries.map(async (query, index) => {
      try {
        const result = await provider.generate({
          system: SEARCH_SYSTEM,
          user: `Research query: ${query}\nCompany: ${input.companyName} (${input.companyDomain})`,
          maxTokens: 800,
          temperature: 0,
          research: true,
          effort: "low",
          step: `prep/research query ${index + 1}/${queries.length}`,
        });
        return { query, snippet: result.text.trim(), fetchedAt };
      } catch (err) {
        const msg = (err as Error).message;
        throw new Error(
          `prep/research query ${index + 1}/${queries.length} (${query.slice(0, 80)}): ${msg}`,
        );
      }
    }),
  );

  return results.filter((r) => r.snippet.length > 0);
}
