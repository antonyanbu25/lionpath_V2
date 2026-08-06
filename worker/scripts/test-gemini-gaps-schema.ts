/** Regression: Pass 6 gaps responseSchema must convert cleanly for Gemini 3. */
import { toGeminiResponseSchema } from "../src/gemini-schema.ts";
import { GAPS_RESPONSE_SCHEMA } from "../src/postcall/gaps.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const gemini = toGeminiResponseSchema(GAPS_RESPONSE_SCHEMA as unknown as Record<string, unknown>);
const json = JSON.stringify(gemini);

assert(!json.includes('"maxItems":0'), "Gemini gaps schema must not contain maxItems: 0");
assert(gemini.type === "object", "root type object");

const gapItems = (
  (gemini.properties as Record<string, unknown>)?.productGaps as Record<string, unknown>
)?.items as Record<string, unknown>;
const gapProps = gapItems?.properties as Record<string, unknown> | undefined;
const gapRequired = Array.isArray(gapItems?.required) ? (gapItems.required as string[]) : [];
assert(!gapRequired.includes("competitorNamed"), "competitorNamed must be optional for Gemini 3");
assert(!gapRequired.includes("headline"), "headline must be optional — normalized server-side");
assert(!gapRequired.includes("crossCuttingTags"), "crossCuttingTags must be optional — defaults to []");
assert(gapProps?.competitorNamed != null, "competitorNamed property preserved");
assert(
  (gapProps?.competitorNamed as Record<string, unknown>)?.nullable === true,
  "optional competitorNamed gets nullable",
);

const winItems = (
  (gemini.properties as Record<string, unknown>)?.whatWorks as Record<string, unknown>
)?.items as Record<string, unknown>;
const winRequired = Array.isArray(winItems?.required) ? (winItems.required as string[]) : [];
assert(!winRequired.includes("headline"), "whatWorks headline must be optional");

console.log("test-gemini-gaps-schema: ok");
