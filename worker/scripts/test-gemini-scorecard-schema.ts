/** Regression: scorecard responseSchema must stringify numeric enums and avoid nested min/max bounds. */
import { QIP_PROFILES } from "../src/rubric-profiles.ts";
import { toGeminiResponseSchema } from "../src/gemini-schema.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;
const themeKeys = demo.themes.map((t) => t.key);

const subParamSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score"],
  properties: {
    score: { type: "integer", enum: [0, 1, 2] },
    evidence: {
      type: "array",
      maxItems: 2,
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
  },
};

const rawSchema = {
  type: "object",
  required: ["lines", "analysisConfidence", "dealRiskFlags"],
  properties: {
    analysisConfidence: { type: "number", minimum: 0, maximum: 1 },
    dealRiskFlags: { type: "array", items: { type: "object", properties: {} } },
    lines: {
      type: "array",
      items: {
        type: "object",
        required: ["themeKey", "subParameters", "confidence", "coachingNote"],
        properties: {
          themeKey: { type: "string", enum: themeKeys },
          subParameters: {
            type: "array",
            items: subParamSchema,
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          coachingNote: { type: "string" },
        },
      },
    },
  },
};

const gemini = toGeminiResponseSchema(rawSchema);
const lines = gemini.properties?.lines as Record<string, unknown> | undefined;
const lineItems = lines?.items as Record<string, unknown> | undefined;
const lineProps = lineItems?.properties as Record<string, unknown> | undefined;
const subParams = lineProps?.subParameters as Record<string, unknown> | undefined;
const subItems = subParams?.items as Record<string, unknown> | undefined;
const subProps = subItems?.properties as Record<string, unknown> | undefined;
const score = subProps?.score as Record<string, unknown> | undefined;

assert(gemini.type === "object", "root type object");
assert(score?.type === "string", "numeric score enum must become type string for Gemini");
assert(
  Array.isArray(score?.enum) && score.enum.every((v) => typeof v === "string"),
  "score enum values must be strings",
);
assert(
  JSON.stringify(score?.enum) === '["0","1","2"]',
  `score enum expected ["0","1","2"], got ${JSON.stringify(score?.enum)}`,
);
assert(themeKeys.length === 16, "demo profile has 16 themes");

console.log("test-gemini-scorecard-schema: ok");
