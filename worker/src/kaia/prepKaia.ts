import type { KaiaShareBundle, PrepInput } from "../prep/types";
import { ENRICH_LIMIT_KAIA } from "../contact/enrich-limits";
import { fetchKaiaShareContent, formatKaiaMetadataHeader } from "./fetchShareContent";

export function buildKaiaResearchContextBlock(bundle: KaiaShareBundle): string {
  const header = formatKaiaMetadataHeader(bundle);
  const body = bundle.summary.slice(0, ENRICH_LIMIT_KAIA);
  return header ? `${header}\n\n${body}` : body;
}

export async function resolveKaiaForPrepInput(input: PrepInput): Promise<{
  bundle?: KaiaShareBundle;
  researchContext?: string;
}> {
  if (input.kaiaContent?.summary) {
    return {
      bundle: input.kaiaContent,
      researchContext: buildKaiaResearchContextBlock(input.kaiaContent),
    };
  }

  if (input.kaiaSummary?.trim()) {
    const bundle: KaiaShareBundle = {
      summary: input.kaiaSummary.trim(),
      title: undefined,
    };
    return { bundle, researchContext: buildKaiaResearchContextBlock(bundle) };
  }

  const url = input.kaiaMeetingUrl?.trim();
  if (!url) return {};

  const result = await fetchKaiaShareContent(url);
  if (!result.ok) {
    console.log("Kaia research fetch skipped:", result.reason);
    return {};
  }

  return {
    bundle: result.bundle,
    researchContext: buildKaiaResearchContextBlock(result.bundle),
  };
}
