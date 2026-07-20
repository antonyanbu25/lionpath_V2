// Gemini generationConfig.responseSchema uses the OpenAPI 3.0 Schema subset, not full JSON Schema.
// Strip unsupported keywords (e.g. additionalProperties, $schema) before sending to the API.

const GEMINI_RESPONSE_SCHEMA_KEYS = new Set([
  "type",
  "format",
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
  const requiredList = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_RESPONSE_SCHEMA_KEYS.has(key)) continue;

    if (key === "properties" && isPlainObject(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        let child = isPlainObject(propSchema) ? toGeminiResponseSchema(propSchema) : propSchema;
        if (isPlainObject(child) && !requiredList.includes(propName)) {
          child = { ...child, nullable: true };
        }
        props[propName] = child;
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

    if (key === "maxItems" && typeof value === "number" && value < 1) {
      continue;
    }

    out[key] = value;
  }

  return out;
}

/** Prep schema trimmed for Gemini responseSchema (strip unsupported JSON Schema keywords only). */
export function buildPrepSchemaForGemini(
  prepSchema: Record<string, unknown>,
): Record<string, unknown> {
  return toGeminiResponseSchema(structuredClone(prepSchema) as Record<string, unknown>);
}
