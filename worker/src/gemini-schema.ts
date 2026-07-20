// Gemini generationConfig.responseSchema uses the OpenAPI 3.0 Schema subset, not full JSON Schema.
// Strip unsupported keywords (e.g. additionalProperties, $schema) before sending to the API.

import { PREP_SCHEMA } from "./schema";

const GEMINI_RESPONSE_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "minimum",
  "maximum",
  "properties",
  "required",
  "items",
  "propertyOrdering",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively remove JSON Schema keywords unsupported by Gemini responseSchema. */
export function toGeminiResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_RESPONSE_SCHEMA_KEYS.has(key)) continue;

    if (key === "properties" && isPlainObject(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = isPlainObject(propSchema)
          ? toGeminiResponseSchema(propSchema)
          : propSchema;
      }
      out[key] = props;
      continue;
    }

    if (key === "items") {
      if (isPlainObject(value)) {
        out[key] = toGeminiResponseSchema(value);
      } else if (Array.isArray(value)) {
        out[key] = value.map((item) => (isPlainObject(item) ? toGeminiResponseSchema(item) : item));
      } else {
        out[key] = value;
      }
      continue;
    }

    out[key] = value;
  }

  return out;
}

function stripSchemaDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema };
  delete out.description;

  if (isPlainObject(out.properties)) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [
        key,
        isPlainObject(value) ? stripSchemaDescriptions(value) : value,
      ]),
    );
  }

  if (isPlainObject(out.items)) {
    out.items = stripSchemaDescriptions(out.items);
  }

  return out;
}

/**
 * PREP_SCHEMA is too large/complex for gemini-3.1-flash-lite responseSchema when sent verbatim
 * (API 400 INVALID_ARGUMENT). Slim optional/heavy branches; keep full PREP_SCHEMA in the prompt.
 */
export function toPrepGeminiResponseSchema(
  schema: Record<string, unknown> = PREP_SCHEMA as unknown as Record<string, unknown>,
): Record<string, unknown> {
  const slim = stripSchemaDescriptions(structuredClone(schema));

  if (isPlainObject(slim.properties)) {
    delete slim.properties.meddpiccHints;

    // Deprecated field — always [] in output; drop nested useCaseRow to save schema budget.
    slim.properties.industryUseCases = {
      type: "array",
      items: { type: "object", properties: {} },
    };

    const prospects = slim.properties.prospects;
    if (isPlainObject(prospects) && isPlainObject(prospects.items)) {
      const items = prospects.items;
      if (isPlainObject(items.properties)) {
        delete items.properties.discHint;
      }
    }
  }

  return toGeminiResponseSchema(slim);
}
