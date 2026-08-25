/**
 * Section-local resilience for the monolithic synthesize call (T2.6 / FM-14).
 *
 * The synthesis call emits ~19 required top-level fields in one JSON object. When
 * it truncates (maxTokens hit, RECITATION, or a partial write), `extractJson`
 * may still parse a *partial* object that is missing whole fields. The old
 * fallback was a monolithic re-run of the entire schema — which is exactly as
 * likely to truncate a second time, and which rewrites the fields that did
 * survive, so a repaired `likelyPains` could corrupt a previously-good `facts`.
 *
 * This module does the section-local version: detect which required top-level
 * fields are missing, and run a *targeted* repair call for each missing field
 * whose schema asks for ONLY that field. The repaired value is merged back into
 * the partial object; the surviving fields are never re-sent to the model, so a
 * truncation can no longer reinforce the hallucination modes (a thin brief that
 * gets filled with plausible filler is the failure this prevents).
 *
 * Pure helpers (missingFields, buildRepairSchema) are exported so the gate is
 * unit-testable without a provider.
 */

import type { LlmProvider } from "../providers/types";

/** The authoritative list of required top-level fields, mirrored from PREP_SCHEMA. */
export const REQUIRED_PREP_FIELDS = [
  "description",
  "about",
  "incumbent",
  "fitSnapshot",
  "facts",
  "signals",
  "supportJD",
  "likelyPains",
  "industryUseCases",
  "checklist",
  "companySizeAgents",
  "businessContext",
  "discoveryKit",
  "painCapabilityValue",
  "attendees",
  "prospects",
  "icpFit",
  "sources",
] as const;

export type RequiredPrepField = (typeof REQUIRED_PREP_FIELDS)[number];

/**
 * The required fields that are worth a targeted repair call when missing.
 *
 * An empty array/object is often an honest "we found nothing" (e.g. `facts: []`
 * on a thin account), so we do NOT repair those — repairing them would re-run
 * the LLM on every legitimately-thin brief and invite filler (the exact
 * failure mode T1.4 degrades on). We repair only fields whose ABSENCE means
 * truncation dropped them, AND whose presence the brief is not allowed to
 * omit silently. `sources` is never repaired — the real research table is
 * substituted deterministically in finalizePrep, so a missing model echo is
 * not a defect. The highest-risk fields (`fitSnapshot`, `likelyPains`) are
 * first because each repair call is independent and order does not affect
 * correctness, only which field is recovered first if a later call fails.
 */
const REPAIRABLE_FIELDS: ReadonlySet<RequiredPrepField> = new Set<RequiredPrepField>([
  "fitSnapshot",
  "likelyPains",
  "discoveryKit",
  "painCapabilityValue",
  "icpFit",
  "attendees",
  "checklist",
  "incumbent",
  "businessContext",
  "companySizeAgents",
  "industryUseCases",
  "supportJD",
]);

/**
 * Fields whose absence is most likely to invite fabricated filler (T2.6
 * rationale). Returned in priority order so a bounded repair budget recovers
 * the highest-risk fields first.
 */
export function repairableFieldsInPriorityOrder(): RequiredPrepField[] {
  return REQUIRED_PREP_FIELDS.filter((f) => REPAIRABLE_FIELDS.has(f));
}

/**
 * A field is "missing" when it is absent from the parsed object entirely — the
 * truncation signature. A present-but-empty array/string is the model's honest
 * "nothing found" and is NOT treated as missing (repairing it would re-run the
 * LLM on every thin brief and invite the filler T1.4 degrades on).
 */
export function missingFields(raw: Record<string, unknown> | null | undefined): RequiredPrepField[] {
  if (!raw || typeof raw !== "object") return [];
  const present = new Set(Object.keys(raw));
  return repairableFieldsInPriorityOrder().filter((f) => !present.has(f));
}

/**
 * Build a JSON schema that asks for ONLY one field, so the repair call cannot
 * rewrite the fields that survived the truncation. The shape is copied from
 * PREP_SCHEMA.properties.<field> so the repaired value validates against the
 * same constraints as the original.
 */
export function buildRepairSchema(
  field: RequiredPrepField,
  prepSchemaProperties: Record<string, unknown>,
): Record<string, unknown> {
  const prop = prepSchemaProperties[field];
  if (!prop) throw new Error(`buildRepairSchema: unknown field "${field}"`);
  return {
    type: "object",
    additionalProperties: false,
    required: [field],
    properties: { [field]: prop },
  };
}

/** The repair system prompt — reused across all targeted calls. */
export const REPAIR_SYSTEM_PROMPT =
  "A previous synthesis call truncated and is missing a single field. " +
  "Output ONLY valid JSON containing that one field, matching the given schema. " +
  "Use ONLY the provided research facts — do NOT web search, do NOT invent. " +
  "Where facts are missing, output 'unknown' or [] — never fabricate.";

/**
 * Run targeted repair calls for each missing field, merging the results into
 * `raw`. Each call is independent and bounded: a failed repair for one field
 * leaves that field absent (and the downstream normalizer/validator degrade it
 * to its honest empty form), but never corrupts another field. Repairs run
 * sequentially to keep the per-call token budget tight and avoid a burst of
 * near-duplicate calls; the number of missing fields on a truncation is small.
 */
export async function repairMissingSections(
  raw: Record<string, unknown>,
  provider: LlmProvider,
  prepSchemaProperties: Record<string, unknown>,
  context: {
    researchFactsBlock: string;
    companyName: string;
    companyDomain: string;
    userId?: string;
    callId?: string;
  },
): Promise<Record<string, unknown>> {
  const missing = missingFields(raw);
  if (!missing.length) return raw;
  const merged: Record<string, unknown> = { ...raw };
  for (const field of missing) {
    const schema = buildRepairSchema(field, prepSchemaProperties);
    let repairedText: string | null = null;
    try {
      const result = await provider.generate({
        system: REPAIR_SYSTEM_PROMPT,
        user: [
          `Company: ${context.companyName}`,
          context.companyDomain ? `Domain: ${context.companyDomain}` : "",
          "",
          "Extracted research facts (ONLY source for prospect/account claims):",
          context.researchFactsBlock,
          "",
          `Output ONLY the "${field}" field, as valid JSON matching the schema.`,
          JSON.stringify(schema),
        ]
          .filter(Boolean)
          .join("\n"),
        maxTokens: 2000,
        temperature: 0,
        research: false,
        effort: "low",
        jsonSchema: schema as unknown as Record<string, unknown>,
        step: `prep/synthesize-repair:${field}`,
        passName: "synthesize",
        userId: context.userId,
        callId: context.callId,
      });
      repairedText = result.text;
    } catch (err) {
      // A single failed repair must not abort the others — the downstream
      // normalizer degrades an absent field to its honest empty form.
      console.warn(`[prep/synthesize-repair] ${field} failed: ${(err as Error).message}`);
      continue;
    }
    try {
      const { extractJson } = await import("../json");
      const parsed = extractJson<Record<string, unknown>>(repairedText);
      if (parsed && parsed[field] != null) {
        merged[field] = parsed[field];
      }
    } catch (err) {
      console.warn(`[prep/synthesize-repair] ${field} unparsable: ${(err as Error).message}`);
    }
  }
  return merged;
}