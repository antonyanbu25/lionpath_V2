/**
 * v2.3 (Agent 4) — "Summary only — not fully scored" chip in renderQipScorecard, surfaced
 * when analysisMeta.summaryOnly is set (a Kaia-summary-only call with no real transcript).
 * Deterministic — no LLM calls, no DOM (except the minimal stub for the import). Tag: unit.
 */
globalThis.document = { getElementById: () => null };

const { renderQipScorecard } = await import("../postcall.js");

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function assertContains(html, needle, msg) {
  if (!html.includes(needle)) throw new Error(`FAIL: ${msg} — expected "${needle}" in output`);
}

function assertNotContains(html, needle, msg) {
  if (html.includes(needle)) throw new Error(`FAIL: ${msg} — unexpected "${needle}" in output`);
}

const baseScorecard = {
  rubricId: "demo@1.0",
  callType: "demo",
  rubricVersion: "1.0",
  provisional: false,
  overall: 4.5,
  totalCredits: 20,
  includedCredits: 20,
  categoryScores: { discovery: 4, execution: 5, relationship: 4 },
  confidence: 0.35,
  lines: [],
  dealRiskFlags: [],
};

const htmlSummaryOnly = renderQipScorecard(baseScorecard, { summaryOnly: true }, { context: "call-record" });
assertContains(htmlSummaryOnly, "Summary only — not fully scored", "summaryOnly → chip present");
assertContains(htmlSummaryOnly, "qip-summary-only-pill", "summaryOnly → chip class present");
assertContains(htmlSummaryOnly, "Attach the transcript", "summaryOnly → prompts SE to attach transcript");

const htmlNormal = renderQipScorecard(baseScorecard, {}, { context: "call-record" });
assertNotContains(htmlNormal, "Summary only — not fully scored", "no summaryOnly → chip absent");
assertNotContains(htmlNormal, "qip-summary-only-pill", "no summaryOnly → chip class absent");

const htmlFull = renderQipScorecard(baseScorecard, { summaryOnly: true }, {});
assertContains(htmlFull, "Summary only — not fully scored", "summaryOnly full-page render → chip present");

const htmlWithOtherChips = renderQipScorecard(
  { ...baseScorecard, overall: 8.5, leadershipShareable: true },
  { summaryOnly: true, deckVerdict: "deck_rejected" },
  { context: "call-record" },
);
assertContains(htmlWithOtherChips, "Leadership-shareable", "leadership chip still present alongside summaryOnly");
assertContains(htmlWithOtherChips, "Deck not scored", "deck-rejected chip still present alongside summaryOnly");
assertContains(htmlWithOtherChips, "Summary only — not fully scored", "summaryOnly chip present alongside the others");

console.log("test-postcall-summary-only-chip: ok");
