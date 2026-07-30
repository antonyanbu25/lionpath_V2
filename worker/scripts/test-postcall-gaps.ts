/**
 * Unit tests for Pass 6 gaps normalize helpers (no LLM).
 */
import {
  normalizeProductGapsOutput,
  normalizeWhatWorksOutput,
} from "../src/postcall/gaps.ts";

const checks: [string, boolean][] = [];

const gaps = normalizeProductGapsOutput(
  [
    {
      productArea: "channels",
      subArea: "whatsapp",
      crossCuttingTags: ["data_residency", "security_compliance", "bogus_tag"],
      verbatim: "We cannot use WhatsApp unless data stays in Singapore.",
      disposition: "hard_blocker",
      dealImpact: "blocker",
      gapType: "real_gap",
      competitorNamed: { name: "Zendesk", saidBetter: true },
    },
    {
      productArea: "AI — agent facing",
      subArea: "Copilot",
      crossCuttingTags: [],
      verbatim: "I asked for copilot on tickets and you said we don't have that.",
      disposition: "SE didn't know",
      dealImpact: "friction",
      gapType: "real_gap",
      competitorNamed: null,
    },
    { productArea: "channels", subArea: "whatsapp", verbatim: "", disposition: "hard_blocker" },
  ],
  { arrEstimatePoint: 88000 },
);

checks.push(
  ["gaps length 2", gaps.length === 2],
  ["whatsapp subArea", gaps[0].subArea === "whatsapp"],
  ["crossCuttingTags filtered", gaps[0].crossCuttingTags.length === 2],
  ["arrTouched from snapshot", gaps[0].arrTouched === 88000],
  ["arrTouched on all gaps", gaps.every((g) => g.arrTouched === 88000)],
  ["competitorNamed preserved", gaps[0].competitorNamed?.name === "Zendesk"],
  ["competitor saidBetter", gaps[0].competitorNamed?.saidBetter === true],
  ["se_didnt_know disposition", gaps[1].disposition === "se_didnt_know"],
  ["se_didnt_know → enablement_gap", gaps[1].gapType === "enablement_gap"],
  ["taxonomyVersion set", gaps[0].taxonomyVersion === "1.0"],
  ["status draft", gaps[0].status === "draft"],
  ["empty verbatim dropped", !gaps.some((g) => !g.verbatim)],
);

const emptyGaps = normalizeProductGapsOutput([], { arrEstimatePoint: 50000 });
checks.push(["empty gaps array", emptyGaps.length === 0]);

const wins = normalizeWhatWorksOutput([
  {
    productArea: "knowledge",
    verbatim: "Your KB search actually found the answer on the first try.",
    referenceCandidate: true,
  },
  {
    productArea: "invalid_area",
    verbatim: "Nice demo.",
    referenceCandidate: false,
  },
  { productArea: "knowledge", verbatim: "   ", referenceCandidate: false },
]);

checks.push(
  ["whatWorks length 2", wins.length === 2],
  ["referenceCandidate true", wins[0].referenceCandidate === true],
  ["invalid area → other", wins[1].productArea === "other"],
  ["taxonomyVersion on wins", wins[0].taxonomyVersion === "1.0"],
  ["blank verbatim dropped", !wins.some((w) => !w.verbatim.trim())],
);

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${checks.length} failed`);
  process.exit(1);
}
console.log(`\n${checks.length} checks passed`);
