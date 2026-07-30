import { FRESHWORKS_KB } from "../kb";
import { extractJson } from "../json";
import { getProvider } from "../providers";
import { factsFromSeContext } from "./se-context-facts";
import type { Env, ResearchFact, ResearchSnippet } from "./types";

const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "sources"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value", "sourceLabel", "sourceUrl", "confidence", "category"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          sourceLabel: { type: "string" },
          sourceUrl: { type: "string" },
          confidence: { type: "number" },
          category: {
            type: "string",
            enum: ["account", "signal", "prospect", "support", "news"],
          },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "title", "url", "confidence"],
        properties: {
          label: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

function extractSystemPrompt(): string {
  return `Extract structured research facts from the provided web search snippets.
When SE context is provided, also emit category "signal" facts from SE context only (sourceLabel "SE", sourceUrl "se-context", confidence 85–92).
Do NOT invent facts beyond snippets and SE context. Use "unknown" for value when not supported.
Assign snippet sourceLabel S1, S2… matching sources[].label.
confidence: 0-100 based on source quality.
categories: account | signal | prospect | support | news

Freshworks product facts are NOT in snippets — ignore Freshworks claims here.

OUTPUT: single JSON object matching schema. No markdown.

${JSON.stringify(FACTS_SCHEMA)}`;
}

function extractUserPrompt(
  snippets: ResearchSnippet[],
  input: { companyName: string; companyDomain: string; emails: string[]; additionalContext?: string },
): string {
  const blocks = snippets.map(
    (s, i) => `--- Snippet ${i + 1} (query: ${s.query}) ---\n${s.snippet}`,
  );
  return [
    `Company: ${input.companyName}`,
    `Domain: ${input.companyDomain}`,
    `Prospect emails: ${input.emails.join(", ")}`,
    input.additionalContext ? `SE context:\n${input.additionalContext}` : "",
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
  },
): Promise<{ facts: ResearchFact[]; sources: import("./types").SourceRef[] }> {
  const seOnly = factsFromSeContext(input.additionalContext);
  const hasContext = !!String(input.additionalContext || "").trim();

  if (!snippets.length) {
    if (!hasContext) return { facts: [], sources: [] };
    return { facts: seOnly.facts, sources: seOnly.sources };
  }

  const provider = getProvider(env);
  let result;
  try {
    result = await provider.generate({
      system: extractSystemPrompt(),
      user: extractUserPrompt(snippets, input),
      maxTokens: 4000,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: FACTS_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/extract-facts",
    });
  } catch (err) {
    throw new Error(`prep/extract-facts: ${(err as Error).message}`);
  }

  const parsed = extractJson<{ facts: ResearchFact[]; sources: import("./types").SourceRef[] }>(
    result.text,
  );
  const facts = parsed.facts || [];
  const sources = parsed.sources || [];
  if (!seOnly.facts.length) {
    return { facts, sources };
  }
  const seen = new Set(facts.map((f) => `${f.category}:${f.key}:${f.value}`));
  for (const f of seOnly.facts) {
    const key = `${f.category}:${f.key}:${f.value}`;
    if (seen.has(key)) continue;
    facts.unshift(f);
  }
  const mergedSources = [...seOnly.sources];
  for (const s of sources) {
    if (!mergedSources.some((x) => x.label === s.label)) mergedSources.push(s);
  }
  return { facts, sources: mergedSources };
}

/** KB context string for synthesis (Freshworks facts only from KB). */
export function kbContextBlock(): string {
  return `=== FRESHWORKS KNOWLEDGE BASE ===\n${FRESHWORKS_KB}\n=== END ===`;
}
