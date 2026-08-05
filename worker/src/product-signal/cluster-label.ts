/** Draft cluster label from representative verbatims — LLM optional, heuristic fallback. */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";

export function heuristicClusterLabel(verbatims: string[]): string {
  const primary = String(verbatims[0] || "").replace(/\s+/g, " ").trim();
  if (!primary) return "Untitled theme";
  if (primary.length <= 48) return primary;
  return `${primary.slice(0, 45)}…`;
}

export async function suggestClusterLabel(
  env: ProviderEnv,
  verbatims: string[],
  suggestWithLlm = true,
): Promise<string> {
  const samples = verbatims.filter((v) => v.trim()).slice(0, 5);
  if (!samples.length) return "Untitled theme";

  if (!suggestWithLlm || !env.GEMINI_API_KEY?.trim()) {
    return heuristicClusterLabel(samples);
  }

  const provider = getPostCallProvider(env);
  const prompt = samples.map((v, i) => `${i + 1}. "${v.slice(0, 280)}"`).join("\n");

  try {
    const result = await provider.generate({
      system:
        "You name product-gap themes for PM dashboards. Output JSON only: { \"label\": string }. " +
        "Label must be ≤8 words, describe the customer theme in plain language, " +
        "and must NOT use internal taxonomy enum names unless the customer said them.",
      user: `Customer verbatims from one cluster:\n${prompt}`,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: { label: { type: "string" } },
      },
      maxTokens: 256,
      passName: "cluster-label",
    });
    const parsed = extractJson<{ label?: string }>(result.text);
    const label = String(parsed.label || "").replace(/\s+/g, " ").trim();
    if (label.length >= 4 && label.length <= 80) return label;
  } catch (err) {
    console.warn("[cluster-label] LLM suggest failed:", err instanceof Error ? err.message : err);
  }

  return heuristicClusterLabel(samples);
}
