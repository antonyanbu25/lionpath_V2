/** Regression: Pass 6 gaps responseSchema must convert cleanly for Gemini 3. */
import { toGeminiResponseSchema } from "../src/gemini-schema.ts";
import {
  CROSS_CUTTING_TAGS,
  DEAL_IMPACTS,
  GAP_DISPOSITIONS,
  GAP_TYPES,
  PRODUCT_AREAS,
} from "../src/domain-model/product-taxonomy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const COMPETITOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "saidBetter"],
  properties: {
    name: { type: "string" },
    saidBetter: { type: "boolean" },
  },
};

const GAP_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "productArea",
    "subArea",
    "crossCuttingTags",
    "verbatim",
    "disposition",
    "dealImpact",
    "gapType",
  ],
  properties: {
    productArea: { type: "string", enum: [...PRODUCT_AREAS] },
    subArea: { type: "string" },
    crossCuttingTags: {
      type: "array",
      items: { type: "string", enum: [...CROSS_CUTTING_TAGS] },
    },
    verbatim: { type: "string" },
    disposition: { type: "string", enum: [...GAP_DISPOSITIONS] },
    dealImpact: { type: "string", enum: [...DEAL_IMPACTS] },
    gapType: { type: "string", enum: [...GAP_TYPES] },
    competitorNamed: COMPETITOR_SCHEMA,
  },
};

const GAPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["productGaps", "whatWorks"],
  properties: {
    productGaps: { type: "array", maxItems: 12, items: GAP_ITEM_SCHEMA },
    whatWorks: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productArea", "verbatim", "referenceCandidate"],
        properties: {
          productArea: { type: "string", enum: [...PRODUCT_AREAS] },
          verbatim: { type: "string" },
          referenceCandidate: { type: "boolean" },
        },
      },
    },
  },
};

const gemini = toGeminiResponseSchema(GAPS_SCHEMA as unknown as Record<string, unknown>);
const json = JSON.stringify(gemini);

assert(!json.includes('"maxItems":0'), "Gemini gaps schema must not contain maxItems: 0");
assert(gemini.type === "object", "root type object");

const gapItems = (
  (gemini.properties as Record<string, unknown>)?.productGaps as Record<string, unknown>
)?.items as Record<string, unknown>;
const gapProps = gapItems?.properties as Record<string, unknown> | undefined;
const gapRequired = Array.isArray(gapItems?.required) ? (gapItems.required as string[]) : [];
assert(!gapRequired.includes("competitorNamed"), "competitorNamed must be optional for Gemini 3");
assert(gapProps?.competitorNamed != null, "competitorNamed property preserved");
assert(
  (gapProps?.competitorNamed as Record<string, unknown>)?.nullable === true,
  "optional competitorNamed gets nullable",
);

console.log("test-gemini-gaps-schema: ok");
