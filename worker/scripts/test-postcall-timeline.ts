/**
 * Unit tests for the transcript timeline — phase spine + markers (no LLM, no network).
 * Run: tsx scripts/test-postcall-timeline.ts
 */

import assert from "node:assert/strict";
import {
  deriveCallTimeline,
  deriveMarkers,
  derivePhaseSpine,
  locateQuoteAtS,
} from "../src/postcall/timeline.ts";
import { parseTranscriptCues } from "../src/transcript.ts";

function cue(startS: number, endS: number, text: string) {
  const fmt = (s: number) =>
    `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;
  return `${fmt(startS)} --> ${fmt(endS)}\n${text}\n`;
}

const VTT = [
  "WEBVTT",
  "",
  cue(0, 50, "Priyal: Thanks for joining today, let me introduce the team."),
  cue(50, 140, "Priyal: Before we start, the agenda for today is a quick demo then next steps."),
  cue(140, 260, "Ravi: How do you currently handle ticket volume across the support team?"),
  cue(260, 380, "Customer: Tell me about the workflow — our process today is fully manual."),
  cue(380, 520, "Priyal: Let me show you. I'm sharing my screen now."),
  cue(520, 640, "Priyal: As you can see here, this dashboard routes by intent."),
  cue(640, 760, "Customer: My concern is the security review will take a quarter."),
  cue(760, 880, "Customer: We already have Zendesk, so compared to that this is a lift."),
  cue(880, 1000, "Ravi: On pricing, the cost per agent per month lands at forty dollars."),
  cue(1000, 1120, "Customer: That is over budget, we would need a discount."),
  cue(1120, 1240, "Priyal: Next steps — I'll send the recap and we'll schedule a follow up."),
].join("\n");

function testCueParsing() {
  const cues = parseTranscriptCues(VTT);
  assert.equal(cues.length, 11);
  assert.equal(cues[0].startS, 0);
  assert.equal(cues[0].speaker, "Priyal");
  assert.equal(cues[0].text, "Thanks for joining today, let me introduce the team.");
  assert.equal(cues[2].startS, 140);

  // The `[mm:ss]` form that formatTimestampedTranscript emits also parses.
  const bracketed = parseTranscriptCues("[00:30] Ravi: how do you currently do this\n[01:05] ok");
  assert.equal(bracketed.length, 2);
  assert.equal(bracketed[0].startS, 30);
  assert.equal(bracketed[1].startS, 65);

  // Plain text has no clock — must yield nothing rather than fake zeros.
  assert.deepEqual(parseTranscriptCues("Priyal: hello there\nRavi: hi"), []);
}

function testPhaseSpine() {
  const segments = derivePhaseSpine(parseTranscriptCues(VTT));
  const types = segments.map((s) => s.segmentType);

  assert.deepEqual(types, [
    "intro",
    "discovery",
    "demo",
    "objection_handling",
    "pricing",
    "next_steps",
  ]);

  assert.equal(segments[0].startS, 0);
  assert.equal(segments[0].label, "Intro and agenda");
  // Contiguous and non-overlapping — a call has one shape.
  for (let i = 1; i < segments.length; i += 1) {
    assert.ok(segments[i].startS >= segments[i - 1].endS - 1, `overlap at ${i}`);
    assert.ok(segments[i].endS > segments[i].startS);
  }
  assert.ok(segments.every((s) => s.source === "transcript"));
}

function testAgendaTalkStaysIntro() {
  // Naming future phases is what an agenda does — it must not move the spine.
  const agenda = [
    "WEBVTT",
    "",
    cue(0, 60, "Priyal: Thanks for joining."),
    cue(60, 200, "Priyal: The agenda is a demo, then pricing, then next steps."),
    cue(200, 400, "Ravi: How do you currently run this process?"),
  ].join("\n");
  const types = derivePhaseSpine(parseTranscriptCues(agenda)).map((s) => s.segmentType);
  assert.deepEqual(types, ["intro", "discovery"]);
}

function testShortRunsCollapse() {
  const noisy = [
    "WEBVTT",
    "",
    cue(0, 30, "Thanks for joining, agenda for today."),
    cue(30, 40, "On pricing, quickly."),
    cue(40, 300, "How do you currently handle this workflow?"),
  ].join("\n");
  const segments = derivePhaseSpine(parseTranscriptCues(noisy));
  // The 10-second pricing aside is noise, not a phase.
  assert.ok(!segments.some((s) => s.segmentType === "pricing"));
}

function testQuoteLocation() {
  const cues = parseTranscriptCues(VTT);
  assert.equal(locateQuoteAtS("My concern is the security review will take a quarter", cues), 640);
  // Paraphrased tail still lands via the prefix probe.
  assert.equal(locateQuoteAtS("we already have Zendesk, which changes things", cues), 760);
  // Punctuation and case are normalized away.
  assert.equal(locateQuoteAtS("THAT IS OVER BUDGET!!", cues), 1000);
  // Not in the transcript — must be dropped, not guessed.
  assert.equal(locateQuoteAtS("we love the mobile app", cues), null);
  assert.equal(locateQuoteAtS("too short", cues), null);
}

function testMarkers() {
  const cues = parseTranscriptCues(VTT);
  const markers = deriveMarkers(cues, {
    gaps: [
      { verbatim: "We already have Zendesk, so compared to that this is a lift", productArea: "integrations", subArea: "migration" },
      { verbatim: "a feature nobody mentioned on this call", productArea: "reporting", subArea: "exports" },
    ],
    whatWorks: [{ verbatim: "As you can see here, this dashboard routes by intent", productArea: "automation" }],
    objections: [
      { objectionText: "My concern is the security review will take a quarter", theme: "security", landed: false },
    ],
    scorecardLines: [
      {
        themeKey: "cta",
        score: 1,
        maxScore: 5,
        applicable: true,
        evidence: [{ atS: 1120, quote: "Next steps — I'll send the recap" }],
      },
    ],
  });

  const kinds = markers.map((m) => m.kind);
  assert.deepEqual(kinds, ["win", "objection", "gap", "weak_cta"]);
  assert.deepEqual(
    markers.map((m) => m.atS),
    [520, 640, 760, 1120],
  );
  // Unlocatable gap dropped rather than pinned at a guessed time.
  assert.equal(markers.filter((m) => m.kind === "gap").length, 1);
  assert.equal(markers[2].label, "integrations · migration");
  assert.ok(markers.every((m) => m.source === "transcript"));
}

function testWeakCtaOnlyWhenWeak() {
  const cues = parseTranscriptCues(VTT);
  const strong = deriveMarkers(cues, {
    scorecardLines: [
      { themeKey: "cta", score: 5, maxScore: 5, applicable: true, evidence: [{ atS: 1120 }] },
    ],
  });
  assert.equal(strong.length, 0, "a strong close is not a marker");

  const notApplicable = deriveMarkers(cues, {
    scorecardLines: [
      { themeKey: "cta", score: 0, maxScore: 5, applicable: false, evidence: [{ atS: 1120 }] },
    ],
  });
  assert.equal(notApplicable.length, 0, "non-applicable themes never render as a failing moment");
}

function testDedupe() {
  const cues = parseTranscriptCues(VTT);
  const markers = deriveMarkers(cues, {
    gaps: [
      { verbatim: "We already have Zendesk, so compared to that this is a lift", productArea: "a" },
      { verbatim: "We already have Zendesk, so compared to that", productArea: "b" },
    ],
  });
  assert.equal(markers.length, 1, "same moment described twice is one marker");
}

function testNoTimestampsIsHonest() {
  const draft = deriveCallTimeline("Priyal: hello\nRavi: hi there", {
    gaps: [{ verbatim: "hello", productArea: "x" }],
  });
  assert.equal(draft.hasTimestamps, false);
  assert.deepEqual(draft.segments, []);
  assert.deepEqual(draft.markers, []);
  assert.equal(draft.durationSec, null);
}

function testFullDraft() {
  const draft = deriveCallTimeline(VTT, {
    objections: [{ objectionText: "My concern is the security review will take a quarter", theme: "security" }],
  });
  assert.equal(draft.hasTimestamps, true);
  assert.equal(draft.source, "transcript");
  assert.equal(draft.durationSec, 1240);
  assert.ok(draft.segments.length >= 4);
  assert.equal(draft.markers.length, 1);
}

testCueParsing();
testPhaseSpine();
testAgendaTalkStaysIntro();
testShortRunsCollapse();
testQuoteLocation();
testMarkers();
testWeakCtaOnlyWhenWeak();
testDedupe();
testNoTimestampsIsHonest();
testFullDraft();
console.log("postcall-timeline tests passed");
