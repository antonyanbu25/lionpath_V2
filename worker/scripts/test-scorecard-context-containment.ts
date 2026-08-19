#!/usr/bin/env tsx
/**
 * v2.3 (Agent 4) — the scorecard prompt gets a structured, labelled context bundle
 * (confirmed identities / SE notes+attachments / Kaia summary), and none of it — SE notes,
 * attached documents, or a Kaia summary — can justify a sub-parameter score of 2 on its own.
 * Only a verbatim transcript (or legitimate video/deck) quote can. This is the anti-inflation
 * boundary: untrusted attachment text must never be able to inflate a score by itself.
 */
import assert from "node:assert/strict";
import { normalizeScorecardLines, userPromptForTest } from "../src/postcall/scorecard.ts";
import { QIP_PROFILES } from "../src/rubric-profiles.ts";

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;

function modelLineWithEvidence(
  themeKey: string,
  score: 0 | 1 | 2,
  evidence: Array<{ atS?: number | null; quote: string; source?: string }>,
) {
  return {
    themeKey,
    subParameters: [
      { score, evidence },
      { score: 0, evidence: [] },
      { score: 0, evidence: [] },
      { score: 0, evidence: [] },
      { score: 0, evidence: [] },
    ],
  };
}

function testSeNotesAloneCannotJustifyATwo() {
  const themeKey = demo.themes[0].key;
  const { lines } = normalizeScorecardLines({
    profile: demo,
    videoAvailable: false,
    deckPresent: false,
    modelLines: [
      modelLineWithEvidence(themeKey, 2, [
        { quote: "SE notes said the discovery went great.", source: "brief" },
      ]),
    ],
  });
  const line = lines.find((l) => l.themeKey === themeKey)!;
  assert.equal(line.subParameters[0].score, 1, "brief-only evidence downgraded from 2 to 1");
  console.log("testSeNotesAloneCannotJustifyATwo: ok");
}

function testTranscriptEvidenceStillJustifiesATwo() {
  const themeKey = demo.themes[0].key;
  const { lines } = normalizeScorecardLines({
    profile: demo,
    videoAvailable: false,
    deckPresent: false,
    modelLines: [
      modelLineWithEvidence(themeKey, 2, [
        { atS: 90, quote: "Asked about their current ticket routing setup.", source: "transcript" },
      ]),
    ],
  });
  const line = lines.find((l) => l.themeKey === themeKey)!;
  assert.equal(line.subParameters[0].score, 2, "real transcript evidence keeps the 2");
  console.log("testTranscriptEvidenceStillJustifiesATwo: ok");
}

function testBriefCanCorroborateAlongsideTranscript() {
  const themeKey = demo.themes[0].key;
  const { lines } = normalizeScorecardLines({
    profile: demo,
    videoAvailable: false,
    deckPresent: false,
    modelLines: [
      modelLineWithEvidence(themeKey, 2, [
        { atS: 90, quote: "Asked about their current ticket routing setup.", source: "transcript" },
        { quote: "SE notes confirm this was a planned discovery question.", source: "brief" },
      ]),
    ],
  });
  const line = lines.find((l) => l.themeKey === themeKey)!;
  assert.equal(line.subParameters[0].score, 2, "brief corroborates but transcript evidence alone already justifies the 2");
  console.log("testBriefCanCorroborateAlongsideTranscript: ok");
}

function testUnsourcedEvidenceDefaultsToTranscriptAndIsAccepted() {
  // normalizeEvidence() defaults a missing `source` to "transcript" — regression guard that
  // the new containment check doesn't accidentally downgrade ordinary model output that never
  // set a source field at all (the overwhelming common case).
  const themeKey = demo.themes[0].key;
  const { lines } = normalizeScorecardLines({
    profile: demo,
    videoAvailable: false,
    deckPresent: false,
    modelLines: [modelLineWithEvidence(themeKey, 2, [{ atS: 90, quote: "Specific evidenced moment." }])],
  });
  const line = lines.find((l) => l.themeKey === themeKey)!;
  assert.equal(line.subParameters[0].score, 2, "unsourced evidence defaults to transcript and is accepted");
  console.log("testUnsourcedEvidenceDefaultsToTranscriptAndIsAccepted: ok");
}

function testPromptIncludesSeNotesBlockWhenPresent() {
  const prompt = userPromptForTest!(
    {
      transcript: "[00:01:00] SE: Hello.\n[00:01:05] Customer: Hi.",
      callType: "demo",
      videoAvailable: false,
      additionalContext: "SE notes: customer mentioned budget is tight this quarter.",
    },
    demo,
  );
  assert.ok(prompt.includes("=== SE NOTES & ATTACHED DOCUMENTS (context)"), "SE notes block present");
  assert.ok(prompt.includes("UNTRUSTED"), "SE notes block carries the untrusted-data label");
  assert.ok(prompt.includes("customer mentioned budget is tight"), "SE notes text included");
  console.log("testPromptIncludesSeNotesBlockWhenPresent: ok");
}

function testPromptOmitsSeNotesBlockWhenAbsent() {
  const prompt = userPromptForTest!(
    { transcript: "[00:01:00] SE: Hello.", callType: "demo", videoAvailable: false },
    demo,
  );
  assert.ok(!prompt.includes("SE NOTES & ATTACHED DOCUMENTS"), "no SE notes block when additionalContext absent");
  console.log("testPromptOmitsSeNotesBlockWhenAbsent: ok");
}

function testPromptIncludesKaiaSummaryBlockWhenPresent() {
  const prompt = userPromptForTest!(
    {
      transcript: "[00:01:00] SE: Hello.",
      callType: "demo",
      videoAvailable: false,
      kaiaSummary: "Team discussed pricing and next steps.",
    },
    demo,
  );
  assert.ok(prompt.includes("=== KAIA MEETING SUMMARY (corroborating)"), "Kaia summary block present");
  assert.ok(prompt.includes("UNTRUSTED"), "Kaia summary block carries the untrusted-data label");
  assert.ok(prompt.includes("Team discussed pricing"), "Kaia summary text included");
  console.log("testPromptIncludesKaiaSummaryBlockWhenPresent: ok");
}

function testPromptOmitsKaiaSummaryBlockWhenAbsent() {
  const prompt = userPromptForTest!(
    { transcript: "[00:01:00] SE: Hello.", callType: "demo", videoAvailable: false },
    demo,
  );
  assert.ok(!prompt.includes("KAIA MEETING SUMMARY"), "no Kaia summary block when kaiaSummary absent");
  console.log("testPromptOmitsKaiaSummaryBlockWhenAbsent: ok");
}

function testConfirmedIdentitiesBlockStillPresent() {
  // Pre-existing v2.2 block — must survive alongside the two new ones.
  const prompt = userPromptForTest!(
    {
      transcript: "[00:01:00] SE: Hello.",
      callType: "demo",
      videoAvailable: false,
      identitiesContext: "Confirmed call identities (authoritative for scoring):\n- Primary SE: Priyal Shah",
    },
    demo,
  );
  assert.ok(prompt.includes("=== CONFIRMED IDENTITIES ==="), "confirmed identities block unaffected by Agent 4");
  console.log("testConfirmedIdentitiesBlockStillPresent: ok");
}

testSeNotesAloneCannotJustifyATwo();
testTranscriptEvidenceStillJustifiesATwo();
testBriefCanCorroborateAlongsideTranscript();
testUnsourcedEvidenceDefaultsToTranscriptAndIsAccepted();
testPromptIncludesSeNotesBlockWhenPresent();
testPromptOmitsSeNotesBlockWhenAbsent();
testPromptIncludesKaiaSummaryBlockWhenPresent();
testPromptOmitsKaiaSummaryBlockWhenAbsent();
testConfirmedIdentitiesBlockStillPresent();

console.log("test-scorecard-context-containment: ok");
