/** Regression: scorecard responseSchema must not use lines array min/max bounds (Gemini 400). */
import { RUBRIC_PROFILES } from "../src/rubric-profiles.ts";
import { toGeminiResponseSchema } from "../src/gemini-schema.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const demo = RUBRIC_PROFILES.find((p) => p.callType === "demo")!;
const themeKeys = demo.themes.map((t) => t.themeKey);

const rawSchema = {
  type: "object",
  required: ["lines", "analysisConfidence"],
  properties: {
    analysisConfidence: { type: "number", minimum: 0, maximum: 1 },
    lines: {
      type: "array",
      items: {
        type: "object",
        required: ["themeKey", "score", "applicable", "confidence", "evidence", "coachingNote"],
        properties: {
          themeKey: { type: "string", enum: themeKeys },
          score: { type: "number", minimum: 0, maximum: 100 },
          applicable: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          notApplicableReason: { type: "string", nullable: true },
          evidence: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              required: ["quote"],
              properties: {
                atS: { type: "number", nullable: true },
                quote: { type: "string" },
                source: {
                  type: "string",
                  enum: ["transcript", "video", "brief", "artifact"],
                  nullable: true,
                },
              },
            },
          },
          coachingNote: { type: "string" },
        },
      },
    },
  },
};

const gemini = toGeminiResponseSchema(rawSchema);
const json = JSON.stringify(gemini);
const lines = gemini.properties?.lines as Record<string, unknown> | undefined;

assert(gemini.type === "object", "root type object");
assert(!("minItems" in (lines || {})), "scorecard lines must not set minItems (Gemini 400 with nested schema)");
assert(!("maxItems" in (lines || {})), "scorecard lines must not set maxItems (Gemini 400 with nested schema)");
assert(json.includes('"enum"'), "themeKey enum preserved");
assert(themeKeys.length === 16, "demo profile has 16 themes");

console.log("test-gemini-scorecard-schema: ok");
