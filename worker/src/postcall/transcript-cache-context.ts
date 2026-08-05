/**
 * Post-call transcript cache lifecycle — variant text builders, prepare/release helpers.
 */

import {
  createTranscriptCache,
  postCallCacheTtlSeconds,
  releasePostCallTranscriptCaches,
  resolvePostCallCacheModel,
  type PostCallTranscriptCacheBundle,
  type PostCallTranscriptVariant,
} from "../providers/gemini-cache";
import type { ProviderEnv } from "../providers/types";
import { formatTimestampedTranscript, parseTranscript, trimTranscript } from "../transcript";

export type { PostCallTranscriptCacheBundle, PostCallTranscriptVariant };

const VARIANTS: PostCallTranscriptVariant[] = [
  "headTail2500",
  "tail6000",
  "timestamped5500",
  "timestampedSummarise",
];

/** Transcript block text exactly as embedded in pass user prompts today. */
export function buildVariantText(transcript: string, variant: PostCallTranscriptVariant): string {
  const parsed = parseTranscript(transcript);
  switch (variant) {
    case "headTail2500":
      return trimTranscript(parsed.text, 2500, "head_tail");
    case "tail6000":
      return trimTranscript(parsed.text, 6000, "tail");
    case "timestamped5500":
    case "timestampedSummarise":
      return formatTimestampedTranscript(transcript, 5500);
    default:
      return trimTranscript(parsed.text, 6000, "tail");
  }
}

/** Wrapper strings matching each pass's user prompt transcript section. */
export function buildCachedTranscriptPart(
  transcript: string,
  variant: PostCallTranscriptVariant,
): string {
  const body = buildVariantText(transcript, variant);
  switch (variant) {
    case "headTail2500":
      return ["=== TRANSCRIPT OPENING ===", body].join("\n");
    case "timestamped5500":
      return ["=== TIMESTAMPED TRANSCRIPT ===", body, "=== END TRANSCRIPT ==="].join("\n");
    case "timestampedSummarise":
      return ["=== TRANSCRIPT ===", body].join("\n");
    case "tail6000":
    default:
      return ["=== TRANSCRIPT ===", body, "=== END TRANSCRIPT ==="].join("\n");
  }
}

export function transcriptCacheHandle(
  bundle: PostCallTranscriptCacheBundle | null | undefined,
  variant: PostCallTranscriptVariant,
): string | undefined {
  return bundle?.caches?.[variant]?.name;
}

export interface PrepareTranscriptCachesInput {
  transcript: string;
  callId?: string;
  ttlSeconds?: number;
}

/** Create up to three variant caches in parallel; failures are skipped. */
export async function preparePostCallTranscriptCaches(
  env: ProviderEnv,
  input: PrepareTranscriptCachesInput,
): Promise<PostCallTranscriptCacheBundle> {
  const transcript = input.transcript?.trim();
  if (!transcript) {
    return { caches: {}, skipped: true };
  }

  const model = resolvePostCallCacheModel(env);
  const ttlSeconds = input.ttlSeconds ?? postCallCacheTtlSeconds(env);

  const results = await Promise.all(
    VARIANTS.map(async (variant) => {
      const formattedText = buildCachedTranscriptPart(transcript, variant);
      const handle = await createTranscriptCache(env, {
        transcript,
        callId: input.callId,
        ttlSeconds,
        model,
        variant,
        formattedText,
      });
      return [variant, handle] as const;
    }),
  );

  const caches: PostCallTranscriptCacheBundle["caches"] = {};
  for (const [variant, handle] of results) {
    if (handle) caches[variant] = handle;
  }

  return {
    caches,
    skipped: Object.keys(caches).length === 0,
  };
}

export { releasePostCallTranscriptCaches };

/** Run fn with prepared transcript caches; always releases in finally. */
export async function withPostCallTranscriptCache<T>(
  env: ProviderEnv,
  input: PrepareTranscriptCachesInput,
  fn: (bundle: PostCallTranscriptCacheBundle) => Promise<T>,
): Promise<T> {
  const bundle = await preparePostCallTranscriptCaches(env, input);
  try {
    return await fn(bundle);
  } finally {
    await releasePostCallTranscriptCaches(env, bundle);
  }
}
