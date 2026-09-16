/** Draft cluster label from representative verbatims — LLM optional, heuristic fallback. */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { BatchGenerateItem } from "../providers/gemini-batch";
import type { ProviderEnv } from "../providers/types";

export const CLUSTER_LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: { label: { type: "string" } },
};

export function heuristicClusterLabel(verbatims: string[]): string {
  const primary = String(verbatims[0] || "").replace(/\s+/g, " ").trim();
  if (!primary) return "Untitled theme";
  if (primary.length <= 48) return primary;
  return `${primary.slice(0, 45)}…`;
}

function clusterLabelSamples(verbatims: string[]): string[] {
  return verbatims.filter((v) => v.trim()).slice(0, 5);
}

export function clusterLabelSystemPrompt(): string {
  return (
    "You name product-gap themes for PM dashboards. Output JSON only: { \"label\": string }. " +
    "Label must be ≤8 words, describe the customer theme in plain language, " +
    "and must NOT use internal taxonomy enum names unless the customer said them."
  );
}

export function clusterLabelUserPrompt(verbatims: string[]): string {
  const samples = clusterLabelSamples(verbatims);
  const prompt = samples.map((v, i) => `${i + 1}. "${v.slice(0, 280)}"`).join("\n");
  return `Customer verbatims from one cluster:\n${prompt}`;
}

/** Build a batch generate item for one cluster label request. */
export function buildClusterLabelBatchItem(clusterId: string, verbatims: string[]): BatchGenerateItem {
  return {
    key: clusterId,
    system: clusterLabelSystemPrompt(),
    user: clusterLabelUserPrompt(verbatims),
    jsonSchema: CLUSTER_LABEL_SCHEMA,
    maxTokens: 256,
  };
}

export function parseClusterLabelText(text: string): string | null {
  try {
    const parsed = extractJson<{ label?: string }>(text);
    const label = String(parsed.label || "").replace(/\s+/g, " ").trim();
    if (label.length >= 4 && label.length <= 80) return label;
  } catch {
    /* fall through */
  }
  return null;
}

export async function suggestClusterLabel(
  env: ProviderEnv,
  verbatims: string[],
  suggestWithLlm = true,
): Promise<string> {
  const samples = clusterLabelSamples(verbatims);
  if (!samples.length) return "Untitled theme";

  if (!suggestWithLlm || !env.GEMINI_API_KEY?.trim()) {
    return heuristicClusterLabel(samples);
  }

  const provider = getPostCallProvider(env);
  const item = buildClusterLabelBatchItem("inline", samples);

  try {
    const result = await provider.generate({
      system: item.system,
      user: item.user,
      jsonSchema: item.jsonSchema,
      maxTokens: item.maxTokens || 256,
      passName: "cluster-label",
    });
    const label = parseClusterLabelText(result.text);
    if (label) return label;
  } catch (err) {
    console.warn("[cluster-label] LLM suggest failed:", err instanceof Error ? err.message : err);
  }

  return heuristicClusterLabel(samples);
}
