import { extractJson } from "../json";
import { getProvider } from "../providers";
import { SE_SOURCE } from "./se-context-facts";
import type { Env, ResearchFact, SourceRef } from "./types";

const SE_EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value", "category"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          category: {
            type: "string",
            enum: ["account", "signal", "prospect", "support", "news"],
          },
        },
      },
    },
  },
} as const;

const CANONICAL_SIGNALS = new Set([
  "Incumbent tool",
  "Integrations",
  "Web chat widget",
  "AI in their current tech stack",
  "Support portal",
  "Hiring support roles",
]);

function trimWords(value: string, max = 12): string {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, max)
    .join(" ");
}

/** LLM extraction from SE notes — supplements regex-based se-context-facts. */
export async function extractSeContextFacts(
  env: Env,
  additionalContext: string | undefined,
): Promise<{ facts: ResearchFact[]; sources: SourceRef[] }> {
  const text = String(additionalContext || "").trim();
  if (text.length < 40) return { facts: [], sources: [] };

  const provider = getProvider(env);
  let result;
  try {
    result = await provider.generate({
      system: `Extract structured facts from SE additional context only.
Emit facts the SE stated explicitly — do NOT invent.
Use sourceLabel "SE" mentally; output key/value/category only.
For canonical signals use exact keys: ${[...CANONICAL_SIGNALS].join(", ")}.
Other keys: Champion, Timeline, Budget, Pain, Meeting type, etc. (max 4 words).
Values max 12 words. categories: account | signal | prospect | support | news.
OUTPUT: JSON matching schema. No markdown.`,
      user: `SE notes:\n${text.slice(0, 4000)}`,
      maxTokens: 1500,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: SE_EXTRACT_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/se-context-extract",
    });
  } catch (err) {
    console.warn("prep/se-context-extract skipped:", (err as Error).message);
    return { facts: [], sources: [] };
  }

  try {
    const parsed = extractJson<{ facts: Array<{ key: string; value: string; category: string }> }>(
      result.text,
    );
    const facts: ResearchFact[] = (parsed.facts || [])
      .filter((f) => f.key && f.value && f.value.toLowerCase() !== "unknown")
      .map((f) => ({
        key: f.key.trim(),
        value: trimWords(f.value),
        sourceLabel: "SE",
        sourceUrl: "se-context",
        confidence: 88,
        category: (f.category || "signal") as ResearchFact["category"],
      }));

    if (!facts.length) return { facts: [], sources: [] };
    return { facts, sources: [SE_SOURCE] };
  } catch {
    return { facts: [], sources: [] };
  }
}
