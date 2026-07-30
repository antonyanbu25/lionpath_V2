import assert from "node:assert/strict";
import { applyPdfNameFallbacks } from "../src/prep/pdf-name-fallback.ts";
import type { Prep } from "../src/schema.ts";

const annaPdf =
  "Contact\nwww.linkedin.com/in/anna-thys\nAnna Thys\nProject Manager\n" + "x".repeat(50);
const bobPdf =
  "Contact\nwww.linkedin.com/in/bob-smith\nBob Smith\nEngineer\n" + "x".repeat(50);

const basePrep: Prep = {
  description: "test",
  about: "unknown",
  incumbent: { incumbent_name: "unknown", displacement: "unknown" },
  fitSnapshot: [],
  facts: [],
  signals: [],
  supportJD: { title: "unknown", sourceLabel: "S1", bullets: [] },
  likelyPains: [],
  industryUseCases: [],
  checklist: [],
  companySizeAgents: { agents: "unknown", estimated: true },
  businessContext: {
    market: "unknown",
    model: "unknown",
    users: "unknown",
    uptimeNeed: "unknown",
    fundingParent: "unknown",
    headOffice: "unknown",
    languages: "unknown",
  },
  discoveryKit: [],
  painCapabilityValue: [],
  attendees: [],
  prospects: [
    { name: "unknown", role: "unknown", totalExperience: "unknown", priorEmployers: [], competitorTouchpoints: [], sourceLabel: "S1" },
    { name: "unknown", role: "unknown", totalExperience: "unknown", priorEmployers: [], competitorTouchpoints: [], sourceLabel: "S1" },
  ],
  icpFit: {
    product: "unknown",
    verdict: "unknown",
    score: 0,
    highlights: [],
    gaps: [],
    frameworkRefs: [],
  },
  sources: [{ label: "LinkedIn PDF", title: "PDF", url: "linkedin-pdf:upload", confidence: 90 }],
  assets: [],
};

const patched = applyPdfNameFallbacks(
  basePrep,
  ["a@co.com", "b@co.com"],
  [
    { fileName: "p1.pdf", text: annaPdf },
    { fileName: "p2.pdf", text: bobPdf },
  ],
);

assert.equal(patched.prospects[0]?.name, "Anna Thys");
assert.equal(patched.prospects[1]?.name, "Bob Smith");
console.log("test-pdf-name-fallback.ts: ok");
