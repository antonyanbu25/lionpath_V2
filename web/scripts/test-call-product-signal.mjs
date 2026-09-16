/** Product signal tab — wireframe layout + pass6 data resolution. */
import { resolveCallProductSignal, renderCallProductSignalTab } from "../call-product-signal.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const record = {
  id: "call_test",
  analysis: {
    signals: {
      painsConfirmed: [
        "Zendesk features not working properly",
        "Overcomplicated system configuration",
      ],
      objectionsOpen: ["Not convinced your AI fits us"],
      competitors: ["Zoho"],
    },
  },
};

const objections = [
  {
    theme: "product_gap",
    objectionText:
      "Zendesk was promised to do many things but never delivered — it ended up complicated to actually use.",
    handling:
      "SE and AE positioned Freshdesk as straightforward to configure, with complimentary onboarding sessions included.",
    landed: true,
    atS: 420,
  },
  {
    theme: "product_gap",
    objectionText: "Not convinced AI would help, since their responses are never standard.",
    handling: "SE framed AI as optional — it can be layered in later if the team decides they want it.",
    landed: true,
  },
];

const bundle = resolveCallProductSignal(record, {
  productGaps: [
    {
      productArea: "ticketing_workflow",
      subArea: "routing",
      headline: "AI value unproven",
      verbatim: "Not convinced your AI fits us — our replies are never standard.",
      gapType: "real_gap",
      disposition: "hard_blocker",
      dealImpact: "blocker",
      atS: 900,
      competitorNamed: { name: "Zendesk", saidBetter: true },
    },
  ],
  whatWorks: [
    {
      productArea: "automation",
      headline: "Easy to configure",
      verbatim: "Setup looks a lot simpler than what we're running now.",
      referenceCandidate: true,
      atS: 860,
    },
    {
      productArea: "onboarding",
      headline: "Complimentary onboarding",
      verbatim: "If onboarding's really included, that's a real plus for us.",
      referenceCandidate: false,
      atS: 1325,
    },
  ],
  objections,
});

assert(bundle.wins.length === 2, "pass6 wins");
assert(bundle.asks.length === 2, "objections → asks");
assert(bundle.competitors.length >= 2, "competitors from gaps + signals");
assert(bundle.voicePositive.length === 2, "positive voice lines");
assert(bundle.winPills.includes("Easy to configure"), "win pills");

const html = renderCallProductSignalTab(record, {
  productGaps: bundle.gaps,
  whatWorks: bundle.wins,
  objections,
});

assert(html.includes("Product signal"), "page title");
assert(html.includes("Competitors mentioned"), "comp bar");
assert(html.includes("Customer voice"), "voice section");
assert(html.includes("Asks &amp; objections"), "asks section");
assert(html.includes("Confirmed incumbent pains"), "pains section");
assert(html.includes("ps-ask resolved"), "resolved ask card");
assert(html.includes("Raised"), "raised well");
assert(html.includes("SE response"), "response well");
assert(html.includes("Easy to configure"), "win pill");
assert(html.includes("AI value unproven"), "loss pill");
assert(html.includes("ps-signal-card--wireframe"), "full card tile");
assert(html.includes("ps-main-grid"), "main grid layout");
assert(html.includes("ps-bottom-grid"), "bottom grid layout");
assert(html.includes("Integrations needed"), "integrations section");

const empty = renderCallProductSignalTab({ id: "x" }, {});
assert(empty.includes("Nothing product-specific"), "empty state");

console.log("test-call-product-signal: ok");
