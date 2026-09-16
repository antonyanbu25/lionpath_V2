import { applySeContextToDiscovery, parseSeDiscoveryHints } from "../src/prep/se-discovery-hints.ts";
import type { Prep } from "../src/schema.ts";

const NOTES =
  "channels:wa, instagram, facebook inqueries on visa, passpotr etc people ask about these queries users:5-10";

const hints = parseSeDiscoveryHints(NOTES);
if (!hints.channels.includes("WhatsApp")) throw new Error("expected WhatsApp channel");
if (!hints.channels.includes("Instagram")) throw new Error("expected Instagram channel");
if (!hints.channels.includes("Facebook")) throw new Error("expected Facebook channel");
if (!hints.inquiryThemes.includes("visa")) throw new Error("expected visa theme");
if (!hints.inquiryThemes.includes("passport")) throw new Error("expected passport theme");
if (hints.teamScale !== "5-10") throw new Error(`expected team scale 5-10, got ${hints.teamScale}`);
console.log("ok: parseSeDiscoveryHints");

const emptyPrep: Prep = {
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
  prospects: [],
  icpFit: {
    product: "unknown",
    verdict: "unknown",
    score: 0,
    highlights: [],
    gaps: [],
    frameworkRefs: [],
  },
  sources: [{ label: "S1", title: "test", url: "unknown", confidence: 50 }],
  assets: [],
};

const patched = applySeContextToDiscovery(emptyPrep, NOTES);
if (!patched.likelyPains?.length) throw new Error("expected likelyPains from SE notes");
if (!patched.discoveryKit?.length) throw new Error("expected discoveryKit from SE notes");

const painBlob = patched.likelyPains.join(" ").toLowerCase();
if (!/whatsapp|instagram|facebook|visa|passport/.test(painBlob)) {
  throw new Error("pains should reference channels or inquiry themes");
}

const kitBlob = patched.discoveryKit.map((k) => `${k.question} ${k.because}`).join(" ").toLowerCase();
if (!/whatsapp|instagram|facebook|visa|passport|5-10/.test(kitBlob)) {
  throw new Error("discovery kit should reference SE note facts");
}
console.log("ok: applySeContextToDiscovery");

const genericPrep = applySeContextToDiscovery(
  {
    ...emptyPrep,
    likelyPains: ["Slow ticket routing"],
    discoveryKit: [{ question: "How is support structured?", because: "Generic org question" }],
  },
  NOTES,
);
if (!genericPrep.likelyPains.some((p) => /whatsapp|visa|multi-channel/i.test(p))) {
  throw new Error("expected SE pains prepended over generic");
}
if (!genericPrep.discoveryKit.some((k) => /whatsapp|visa|instagram|5-10/i.test(`${k.question} ${k.because}`))) {
  throw new Error("expected SE kit prepended over generic");
}
console.log("ok: generic prep gets SE anchoring");

console.log("se-discovery-hints checks passed.");
