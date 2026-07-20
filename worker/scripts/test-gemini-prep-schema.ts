/** Regression: PREP schema must be convertible for Gemini (no maxItems: 0). */
import { PREP_SCHEMA } from "../src/schema.ts";
import { buildPrepSchemaForGemini } from "../src/gemini-schema.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const gemini = buildPrepSchemaForGemini(PREP_SCHEMA as unknown as Record<string, unknown>);
const json = JSON.stringify(gemini);
assert(!json.includes('"maxItems":0'), "Gemini prep schema must not contain maxItems: 0");
assert(gemini.type === "object", "root type object");
const props = gemini.properties as Record<string, unknown> | undefined;
assert(props?.meddpiccHints, "meddpiccHints included in Gemini schema");
const prospects = props?.prospects as Record<string, unknown> | undefined;
const items = prospects?.items as Record<string, unknown> | undefined;
const itemProps = items?.properties as Record<string, unknown> | undefined;
assert(itemProps?.discHint, "discHint included on prospect row for Gemini");

console.log("test-gemini-prep-schema: ok");
