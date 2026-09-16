/**
 * Unit test for the client-side deck shape gate (v2.3).
 * Tests computeDeckShapeVerdict logic (including exact boundary values) + the
 * "Deck not scored" chip in renderQipScorecard.
 * Deterministic — no LLM calls, no DOM (except the minimal stub for the import).
 * Tag: unit.
 */
globalThis.document = { getElementById: () => null };

const { renderQipScorecard, computeDeckShapeVerdict } = await import("../postcall.js");

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function assertContains(html, needle, msg) {
  if (!html.includes(needle)) throw new Error(`FAIL: ${msg} — expected "${needle}" in output`);
}

function assertNotContains(html, needle, msg) {
  if (html.includes(needle)) throw new Error(`FAIL: ${msg} — unexpected "${needle}" in output`);
}

// ---------------------------------------------------------------------------
// computeDeckShapeVerdict boundary values — landscapePct >= 0.6,
// medianWordsPerPage <= 250, 1 < pageCount <= 120.
// ---------------------------------------------------------------------------
const goodShape = { landscapePct: 0.8, medianWordsPerPage: 100, pageCount: 20 };

assert(
  computeDeckShapeVerdict(goodShape) === "likely_deck",
  "baseline landscape/sparse/multi-page shape is likely_deck",
);

// pageCount: exactly 1 is rejected (a single-page export, not a deck); 2 is fine.
assert(computeDeckShapeVerdict({ ...goodShape, pageCount: 1 }) === "unlikely_deck", "pageCount === 1 rejected");
assert(computeDeckShapeVerdict({ ...goodShape, pageCount: 2 }) === "likely_deck", "pageCount === 2 accepted");
// pageCount: exactly 120 is fine, 121 is rejected.
assert(computeDeckShapeVerdict({ ...goodShape, pageCount: 120 }) === "likely_deck", "pageCount === 120 accepted");
assert(computeDeckShapeVerdict({ ...goodShape, pageCount: 121 }) === "unlikely_deck", "pageCount === 121 rejected");

// landscapePct: exactly 0.6 is fine (>= threshold), just under is rejected.
assert(
  computeDeckShapeVerdict({ ...goodShape, landscapePct: 0.6 }) === "likely_deck",
  "landscapePct === 0.6 accepted",
);
assert(
  computeDeckShapeVerdict({ ...goodShape, landscapePct: 0.5999 }) === "unlikely_deck",
  "landscapePct just under 0.6 rejected",
);

// medianWordsPerPage: exactly 250 is fine (<= threshold), 251 is rejected.
assert(
  computeDeckShapeVerdict({ ...goodShape, medianWordsPerPage: 250 }) === "likely_deck",
  "medianWordsPerPage === 250 accepted",
);
assert(
  computeDeckShapeVerdict({ ...goodShape, medianWordsPerPage: 251 }) === "unlikely_deck",
  "medianWordsPerPage === 251 rejected",
);

console.log("computeDeckShapeVerdict boundary tests: ok");

// ---------------------------------------------------------------------------
// Minimal scorecard fixture for rendering tests
// ---------------------------------------------------------------------------
const baseScorecard = {
  rubricId: "demo@1.0",
  callType: "demo",
  rubricVersion: "1.0",
  provisional: false,
  overall: 6.5,
  totalCredits: 20,
  includedCredits: 20,
  categoryScores: { discovery: 6, execution: 7, relationship: 6 },
  confidence: 0.8,
  lines: [],
  dealRiskFlags: [],
};

// ---------------------------------------------------------------------------
// Test 1: No deckVerdict → no "Deck not scored" chip
// ---------------------------------------------------------------------------
const htmlNoDeckVerdict = renderQipScorecard(baseScorecard, {}, { context: "call-record" });
assertNotContains(htmlNoDeckVerdict, "Deck not scored", "no deckVerdict → chip absent");
assertNotContains(htmlNoDeckVerdict, "qip-deck-rejected-pill", "no deckVerdict → chip class absent");

// ---------------------------------------------------------------------------
// Test 2: deckVerdict = "deck_valid" → no chip
// ---------------------------------------------------------------------------
const htmlDeckValid = renderQipScorecard(
  baseScorecard,
  { deckVerdict: "deck_valid" },
  { context: "call-record" },
);
assertNotContains(htmlDeckValid, "Deck not scored", "deck_valid → chip absent");

// ---------------------------------------------------------------------------
// Test 3: deckVerdict = "deck_absent" → no chip
// ---------------------------------------------------------------------------
const htmlDeckAbsent = renderQipScorecard(
  baseScorecard,
  { deckVerdict: "deck_absent" },
  { context: "call-record" },
);
assertNotContains(htmlDeckAbsent, "Deck not scored", "deck_absent → chip absent");

// ---------------------------------------------------------------------------
// Test 4: deckVerdict = "deck_rejected" → "Deck not scored" chip rendered
// ---------------------------------------------------------------------------
const rejectionReason = "Not a relevant slide deck — wrong company";
const htmlDeckRejected = renderQipScorecard(
  baseScorecard,
  { deckVerdict: "deck_rejected", deckRejectionReason: rejectionReason },
  { context: "call-record" },
);
assertContains(htmlDeckRejected, "Deck not scored", "deck_rejected → chip present");
assertContains(htmlDeckRejected, "qip-deck-rejected-pill", "deck_rejected → chip class present");
assertContains(htmlDeckRejected, rejectionReason, "deck_rejected → rejection reason in tooltip");

// ---------------------------------------------------------------------------
// Test 5: deck_rejected without reason → fallback tooltip text
// ---------------------------------------------------------------------------
const htmlDeckRejectedNoReason = renderQipScorecard(
  baseScorecard,
  { deckVerdict: "deck_rejected" },
  { context: "call-record" },
);
assertContains(htmlDeckRejectedNoReason, "Deck not scored", "deck_rejected (no reason) → chip present");
// Tooltip should fall back gracefully
assertContains(
  htmlDeckRejectedNoReason,
  "deck scoring was skipped",
  "deck_rejected no-reason → fallback tooltip",
);

// ---------------------------------------------------------------------------
// Test 6: chip in full-page (non-wireframe) render
// ---------------------------------------------------------------------------
const htmlFull = renderQipScorecard(
  baseScorecard,
  { deckVerdict: "deck_rejected", deckRejectionReason: "Annual report, not a deck" },
  {},
);
assertContains(htmlFull, "Deck not scored", "deck_rejected full render → chip present");

// ---------------------------------------------------------------------------
// Test 7: existing chips still present alongside deck-rejected chip
// ---------------------------------------------------------------------------
const htmlWithAllChips = renderQipScorecard(
  { ...baseScorecard, overall: 8.5, leadershipShareable: true },
  { deckVerdict: "deck_rejected" },
  { context: "call-record" },
);
assertContains(htmlWithAllChips, "Leadership-shareable", "leadership chip still present");
assertContains(htmlWithAllChips, "Deck not scored", "deck rejected chip also present");

console.log("test-deck-shape-gate: ok");
