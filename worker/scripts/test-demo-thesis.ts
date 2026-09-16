/**
 * Demo thesis shaping and grounding — pure, no network.
 *
 * Usage: tsx worker/scripts/test-demo-thesis.ts
 */

import assert from "node:assert/strict";

import {
  shapeDemoThesis,
  isThinBrief,
  hasThesisGrounding,
  buildDemoThesisPrompt,
} from "../src/prep/demo-thesis.ts";

let checks = 0;
const ok = (c: unknown, m: string) => {
  assert.ok(c, m);
  checks++;
};
const eq = (a: unknown, b: unknown, m: string) => {
  assert.deepEqual(a, b, m);
  checks++;
};

{
  const shaped = shapeDemoThesis(
    {
      headline: "Email inbox → structured ticketing platform",
      sub: "Zendesk entrenched — lead with routing",
    },
    "Endurance Doors manufactures commercial door systems.",
  );
  eq(shaped?.headline, "Email inbox → structured ticketing platform", "keeps theme headline");
  eq(shaped?.sub, "Zendesk entrenched — lead with routing", "keeps sub");
}

{
  const rejected = shapeDemoThesis(
    {
      headline: "Commercial door manufacturer serving healthcare facilities",
      sub: "Strong fit for Freshdesk",
    },
    "Commercial door manufacturer serving healthcare facilities across North America.",
  );
  eq(rejected, null, "rejects company-description headline");
}

{
  const trimmed = shapeDemoThesis(
    {
      headline: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen",
      sub: "a b c d e f g h i j k l m n o p q",
    },
    "",
  );
  ok(trimmed?.headline.split(/\s+/).length === 16, "headline word cap 16");
  ok(trimmed?.sub.split(/\s+/).length === 14, "sub word cap 14");
}

{
  eq(shapeDemoThesis({ headline: "", sub: "x" }, ""), null, "empty headline rejected");
  eq(shapeDemoThesis(null, ""), null, "null raw rejected");
}

{
  const about = "Endurance Doors manufactures commercial door systems.";
  eq(
    shapeDemoThesis(
      {
        headline: "Endurance Doors manufactures commercial door",
        sub: "Lead with routing",
      },
      about,
    ),
    null,
    "rejects headline overlapping about prefix",
  );
}

{
  const thin = {
    facts: [
      { key: "Industry", value: "unknown", sourceLabel: "S1" },
      { key: "Head office", value: "—", sourceLabel: "S2" },
      { key: "Company size", value: "unknown", sourceLabel: "S3" },
    ],
  };
  ok(isThinBrief(thin), "thin when most facts unknown");
}

{
  const rich = {
    facts: [
      { key: "Industry", value: "Manufacturing", sourceLabel: "S1" },
      { key: "Head office", value: "Chicago", sourceLabel: "S2" },
      { key: "Company size", value: "500", sourceLabel: "S3" },
    ],
  };
  ok(!isThinBrief(rich), "not thin when facts sourced");
}

{
  const oneOfThree = {
    facts: [
      { key: "Industry", value: "Manufacturing", sourceLabel: "S1" },
      { key: "Head office", value: "unknown", sourceLabel: "S2" },
      { key: "Company size", value: "unknown", sourceLabel: "S3" },
    ],
  };
  ok(isThinBrief(oneOfThree), "thin at 33% sourced (1 of 3)");
}

{
  const twoOfThree = {
    facts: [
      { key: "Industry", value: "Manufacturing", sourceLabel: "S1" },
      { key: "Head office", value: "Chicago", sourceLabel: "S2" },
      { key: "Company size", value: "unknown", sourceLabel: "S3" },
    ],
  };
  ok(!isThinBrief(twoOfThree), "not thin at 67% sourced (2 of 3)");
}

{
  ok(
    hasThesisGrounding({
      incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
      facts: [],
      likelyPains: [],
      fitSnapshot: [],
      signals: [],
      painCapabilityValue: [],
    } as never),
    "incumbent grounds thesis",
  );
  ok(
    !hasThesisGrounding({
      incumbent: { incumbent_name: "unknown", displacement: "greenfield" },
      facts: [],
      likelyPains: [],
      fitSnapshot: [],
      signals: [],
      painCapabilityValue: [],
    } as never),
    "no grounding without signals",
  );
  ok(
    hasThesisGrounding(
      {
        incumbent: { incumbent_name: "unknown", displacement: "greenfield" },
        facts: [],
        likelyPains: [],
        fitSnapshot: [
          {
            label: "Channel coverage",
            thisCompany: "Email only",
            industryNorm: "Omnichannel",
            gap: "large",
            gapVerdict: "Behind",
          },
        ],
        signals: [],
        painCapabilityValue: [],
      } as never,
    ),
    "fitSnapshot gap grounds thesis",
  );
  ok(
    hasThesisGrounding(
      {
        incumbent: { incumbent_name: "unknown", displacement: "greenfield" },
        facts: [],
        likelyPains: [],
        fitSnapshot: [],
        signals: [],
        painCapabilityValue: [],
      } as never,
      "They want to move off shared inbox and need routing.",
    ),
    "AE notes ground thesis when long enough",
  );
}

{
  const prompt = buildDemoThesisPrompt(
    {
      about: "Door manufacturer.",
      incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
      likelyPains: ["Slow ticket routing"],
      fitSnapshot: [
        {
          label: "Channel coverage",
          thisCompany: "Email only",
          industryNorm: "Omnichannel",
          gap: "large",
          gapVerdict: "Behind",
        },
      ],
      signals: [{ label: "Incumbent tool", value: "Zendesk Suite" }],
      painCapabilityValue: [],
      facts: [],
    } as never,
    "They want to move off shared inbox.",
  );
  ok(prompt.includes("Incumbent: Zendesk"), "prompt includes incumbent");
  ok(prompt.includes("Pain: Slow ticket routing"), "prompt includes pain");
  ok(prompt.includes("shared inbox"), "prompt includes AE notes");
}

console.log(`test-demo-thesis.ts: ok (${checks} checks)`);
