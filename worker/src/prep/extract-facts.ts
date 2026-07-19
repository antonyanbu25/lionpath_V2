import { FRESHWORKS_KB } from "../kb";
import { extractJson } from "../json";
import { getProvider } from "../providers";
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
          confidence: { type: "integer" },
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
          confidence: { type: "integer" },
        },
      },
    },
  },
} as const;

function extractSystemPrompt(): string {
  return `Extract structured research facts from the provided web search snippets ONLY.
Do NOT invent facts. Use "unknown" for value when not supported by snippets.
Assign sourceLabel S1, S2… matching sources[].label.
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
  if (!snippets.length) {
    return { facts: [], sources: [] };
  }

  const provider = getProvider(env);
  const result = await provider.generate({
    system: extractSystemPrompt(),
    user: extractUserPrompt(snippets, input),
    maxTokens: 4000,
    temperature: 0,
    research: false,
    effort: "low",
    jsonSchema: FACTS_SCHEMA as unknown as Record<string, unknown>,
  });

  const parsed = extractJson<{ facts: ResearchFact[]; sources: import("./types").SourceRef[] }>(
    result.text,
  );
  return {
    facts: parsed.facts || [],
    sources: parsed.sources || [],
  };
}

/** KB context string for synthesis (Freshworks facts only from KB). */
export function kbContextBlock(): string {
  return `=== FRESHWORKS KNOWLEDGE BASE ===\n${FRESHWORKS_KB}\n=== END ===`;
}
