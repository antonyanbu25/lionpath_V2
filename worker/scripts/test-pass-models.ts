/**
 * Per-pass model resolution — cost-safe defaults (flash-lite unless explicit opt-in).
 * Usage: tsx worker/scripts/test-pass-models.ts
 */

import assert from "node:assert/strict";
import {
  DEFAULT_MODEL,
  PREMIUM_MODEL,
  resolveDefaultModel,
  resolvePassModel,
  resolveResearchModel,
  resolveSynthesizeModel,
} from "../src/providers/pass-models.ts";
import {
  canReuseNewsGrounding,
  newsGroundedSnippets,
} from "../src/prep/grounded-context.ts";

const empty = {};

assert.equal(resolvePassModel("research", empty), DEFAULT_MODEL);
assert.equal(resolvePassModel("extract-facts", empty), DEFAULT_MODEL);
assert.equal(resolvePassModel("synthesize", empty), PREMIUM_MODEL);

// Missing RESEARCH_MODEL must not fall through to premium — even when MODEL is premium.
const premiumModelOnly = { MODEL: "gemini-3.6-flash" };
assert.equal(resolvePassModel("research", premiumModelOnly), DEFAULT_MODEL);
assert.equal(resolvePassModel("gap-research", premiumModelOnly), DEFAULT_MODEL);
assert.equal(resolveResearchModel(premiumModelOnly), DEFAULT_MODEL);

// Explicit RESEARCH_MODEL opt-in applies to all grounding passes.
const researchOptIn = { RESEARCH_MODEL: "gemini-3.6-flash" };
assert.equal(resolvePassModel("research", researchOptIn), "gemini-3.6-flash");
assert.equal(resolvePassModel("company-news", researchOptIn), "gemini-3.6-flash");
assert.equal(resolvePassModel("synthesize", researchOptIn), PREMIUM_MODEL);

// SYNTHESIZE_MODEL opt-in is synthesize-only.
const synthOptIn = { SYNTHESIZE_MODEL: "gemini-3.5-flash" };
assert.equal(resolveSynthesizeModel(synthOptIn), "gemini-3.5-flash");
assert.equal(resolvePassModel("research", synthOptIn), DEFAULT_MODEL);

// MODEL applies to extraction passes when non-premium.
assert.equal(resolvePassModel("extract-facts", { MODEL: "gemini-2.0-flash" }), "gemini-2.0-flash");
assert.equal(
  resolvePassModel("extract-facts", { MODEL: "gemini-3.6-flash" }),
  DEFAULT_MODEL,
  "premium MODEL must not silently upgrade extraction passes",
);

assert.equal(resolveDefaultModel(empty), DEFAULT_MODEL);

// Grounding reuse: news snippets with citations enable company-news skip.
const reusable = newsGroundedSnippets([
  {
    query: "Acme news OR funding",
    snippet: "Acme raised Series B",
    citations: [{ uri: "https://techcrunch.com/acme", title: "TC", domain: "techcrunch.com" }],
  },
]);
assert.ok(canReuseNewsGrounding(reusable));
assert.equal(canReuseNewsGrounding([]), false);
assert.equal(canReuseNewsGrounding([{ query: "Acme news OR funding", snippet: "text only" }]), false);

console.log("test-pass-models.ts: ok");
