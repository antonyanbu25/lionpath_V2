import { FRESHWORKS_KB } from "../kb";
import { extractJson } from "../json";
import { getProvider } from "../providers";
import { factsFromSeContext } from "./se-context-facts";
import {
  buildSourceTable,
  formatSnippetSources,
  pruneUnreferencedSources,
  type SourceTable,
} from "./source-table";
import type { Env, ResearchFact, ResearchSnippet, SourceRef } from "./types";

export interface ExtractFactsResult {
  facts: ResearchFact[];
  sources: SourceRef[];
  /** Pass as sourceOffset to the next extraction round to avoid label collisions. */
  nextSourceOffset: number;
}

/**
 * No `sources` property: the source table is built deterministically in
 * source-table.ts. Dropping it also removes `sourceUrl` from the model's output,
 * which is what used to come back as "unknown".
 */
const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value", "sourceLabel", "confidence", "category"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          sourceLabel: { type: "string" },
          confidence: { type: "number" },
          category: {
            type: "string",
            enum: ["account", "signal", "prospect", "support", "news"],
          },
        },
      },
    },
  },
} as const;

const EXTRACT_SYSTEM_PROMPT = `Extract structured research facts from the provided web search snippets.
When SE context is provided, also emit category "signal" facts from SE context only (sourceLabel "SE", confidence 85–92).
Do NOT invent facts beyond snippets and SE context. Use "unknown" for value when not supported.

sourceLabel rules — these are strict:
- Copy sourceLabel VERBATIM from the "Sources for this snippet:" line of the snippet the fact came from.
- Never invent, renumber, or guess a label. Never emit a label that was not listed.
- Do NOT output URLs anywhere. URLs are attached from the source table, not by you.
- If no listed source supports a fact, omit the fact.

confidence: 0-100 based on source quality.
categories: account | signal | prospect | support | news

news category — company-level events ONLY (from web search snippets):
- Funding rounds, acquisitions, leadership changes, product or business launches, partnerships, earnings, layoffs, expansions, regulatory items.
- Use key as a short headline (max 6 words) and value as the detail (max 12 words).
- NEVER categorize support stack, CRM, chat widgets, helpdesk tools, integrations, or hiring as news — those are signal or support.

Freshworks product facts are NOT in snippets — ignore Freshworks claims here.

OUTPUT: single JSON object matching schema. No markdown.

${JSON.stringify(FACTS_SCHEMA)}`;

function extractUserPrompt(
  snippets: ResearchSnippet[],
  table: SourceTable,
  input: { companyName: string; companyDomain: string; emails: string[]; additionalContext?: string },
): string {
  const blocks = snippets.map((s, i) => {
    const sourceLine = formatSnippetSources(table.labelsForSnippet[i] || [], table);
    return `--- Snippet ${i + 1} (query: ${s.query}) ---\n${sourceLine}\n${s.snippet}`;
  });
  return [
    `Company: ${input.companyName}`,
    `Domain: ${input.companyDomain}`,
    `Prospect emails: ${input.emails.join(", ")}`,
    input.additionalContext ? `SE context (sourceLabel "SE"):\n${input.additionalContext}` : "",
    "",
    "Search snippets:",
    blocks.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function extractFacts(
  env: Env,
  snippets: ResearchSnippet[],
  input: {
    companyName: string;
    companyDomain: string;
    emails: string[];
    additionalContext?: string;
    /** Label offset so a second extraction round does not re-issue S1… */
    sourceOffset?: number;
    userId?: string;
    callId?: string;
  },
): Promise<ExtractFactsResult> {
  const seOnly = factsFromSeContext(input.additionalContext);
  const hasContext = !!String(input.additionalContext || "").trim();
  const offset = input.sourceOffset ?? 0;

  if (!snippets.length) {
    if (!hasContext) return { facts: [], sources: [], nextSourceOffset: offset };
    return { facts: seOnly.facts, sources: seOnly.sources, nextSourceOffset: offset };
  }

  const table = buildSourceTable(snippets, { offset, seContext: hasContext });

  const provider = getProvider(env);
  let result;
  try {
    result = await provider.generate({
      system: EXTRACT_SYSTEM_PROMPT,
      user: extractUserPrompt(snippets, table, input),
      maxTokens: 4000,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: FACTS_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/extract-facts",
      passName: "extract-facts",
      userId: input.userId,
      callId: input.callId,
    });
  } catch (err) {
    throw new Error(`prep/extract-facts: ${(err as Error).message}`);
  }

  const parsed = extractJson<{ facts: ResearchFact[] }>(result.text);
  const facts = attachVerifiedSources(parsed.facts || [], table);

  if (!seOnly.facts.length) {
    return {
      facts,
      sources: pruneUnreferencedSources(table.sources, facts),
      nextSourceOffset: table.nextSourceOffset,
    };
  }
  const seen = new Set(facts.map((f) => `${f.category}:${f.key}:${f.value}`));
  for (const f of seOnly.facts) {
    const key = `${f.category}:${f.key}:${f.value}`;
    if (seen.has(key)) continue;
    facts.unshift(f);
  }
  const mergedSources = [...seOnly.sources];
  for (const s of pruneUnreferencedSources(table.sources, facts)) {
    if (!mergedSources.some((x) => x.label === s.label)) mergedSources.push(s);
  }
  return { facts, sources: mergedSources, nextSourceOffset: table.nextSourceOffset };
}

/**
 * Keep only facts whose label exists in the table, and take sourceUrl from the table
 * rather than the model. Dropping unattributable facts is deliberate: a fact whose
 * label we cannot resolve is exactly the kind that used to render as "unknown".
 */
export function attachVerifiedSources(
  facts: ResearchFact[],
  table: SourceTable,
): ResearchFact[] {
  const out: ResearchFact[] = [];
  let dropped = 0;
  for (const fact of facts) {
    const source = table.byLabel.get(fact.sourceLabel);
    if (!source) {
      dropped++;
      continue;
    }
    out.push({ ...fact, sourceUrl: source.url });
  }
  if (dropped) {
    console.warn(
      `[prep/extract-facts] dropped ${dropped}/${facts.length} facts with unknown sourceLabel`,
    );
  }
  return out;
}

/** KB context string for synthesis (Freshworks facts only from KB). */
export function kbContextBlock(): string {
  return `=== FRESHWORKS KNOWLEDGE BASE ===\n${FRESHWORKS_KB}\n=== END ===`;
}
