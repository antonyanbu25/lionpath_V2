/** Timeline card — wireframe spine, inline markers, five-metric row. */
import assert from "node:assert/strict";

import {
  renderTimelineSection,
  resolveObjectionQa,
  renderObjectionQaRow,
  layoutSpineMarkerLabels,
} from "../call-view.js";

const videoSegments = [
  { source: "video", startS: 0, endS: 300, segmentType: "slides", label: "Intro deck" },
  { source: "video", startS: 300, endS: 900, segmentType: "product", label: "Product walkthrough" },
];

const transcriptSegments = [
  { source: "transcript", startS: 0, endS: 140, segmentType: "intro", label: "Intro and agenda" },
  { source: "transcript", startS: 140, endS: 520, segmentType: "discovery", label: "Discovery" },
  { source: "transcript", startS: 520, endS: 1240, segmentType: "demo", label: "Demo" },
];

const markers = [
  { atS: 200, kind: "objection", label: "objection" },
  { atS: 600, kind: "gap", label: "gap raised" },
  { atS: 900, kind: "win", label: "what worked" },
  { atS: 1200, kind: "weak_cta", label: "weak CTA" },
];

const scorecard = {
  lines: [
    {
      themeKey: "call_flow",
      evidence: "Clean sequencing, one 6m 40s monologue at 18:00 cost a point.",
    },
    {
      themeKey: "customer_engagement",
      evidence: "9 customer questions, both attendees spoke.",
    },
  ],
};

const videoFacts = {
  cameraOnPct: 100,
  attendeeCurveJson: [
    { name: "SE", role: "Solution Engineer", talkPct: 71, cameraOn: true },
    { name: "Alex", role: "customer", talkPct: 24, cameraOn: true },
    { name: "Sam", role: "customer", talkPct: 5, cameraOn: false },
  ],
};

function testVideoSpineWireframe() {
  const html = renderTimelineSection(
    true,
    { segments: videoSegments, markers, facts: { durationSec: 2880 } },
    "48 minutes",
    { videoFacts, scorecard, record: {} },
  );
  assert.match(html, /Product walkthrough/);
  assert.doesNotMatch(html, /feeds call flow scoring directly/);
  assert.doesNotMatch(html, /call-timeline-sub/);
  assert.match(html, /call-spine-legend/);
  assert.match(html, /Product \/ CDE/);
  assert.match(html, /call-spine-marker-legend/);
  assert.match(html, /mkl--objection/);
  assert.doesNotMatch(html, /call-timeline-list/);
  assert.doesNotMatch(html, /Built from transcript timestamps/);
}

function testTranscriptSpine() {
  const html = renderTimelineSection(false, { segments: transcriptSegments, markers });

  assert.match(html, /Intro and agenda/);
  assert.doesNotMatch(html, /feeds call flow scoring directly/);
  assert.match(html, /Conversation phases from the transcript clock/);
  assert.match(html, /require video analysis and stay unscored here/);
  assert.doesNotMatch(html, /call-timeline-list/);
}

function testInlineMarkersOnBar() {
  const html = renderTimelineSection(true, { segments: videoSegments, markers, facts: { durationSec: 900 } });
  assert.match(html, /gap raised/);
  assert.match(html, /what worked/);
  assert.match(html, /weak CTA/);
  assert.match(html, /mk--gap/);
  assert.match(html, /mk--objection/);
  assert.match(html, /call-spine-marker-legend/);
  assert.match(html, /Product gap/);
  assert.match(html, /Objection handled/);
}

function testNoMarkerLegendWhenEmpty() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: [],
    facts: { durationSec: 900 },
  });
  assert.doesNotMatch(html, /call-spine-marker-legend/);
  assert.doesNotMatch(html, /class="mk"/);
}

function testMarkersWithoutSpine() {
  const html = renderTimelineSection(false, { segments: [], markers });
  assert.match(html, /gap raised/);
  assert.doesNotMatch(html, /No timeline/);
}

function testEmptyStateIsHonest() {
  const html = renderTimelineSection(false, { segments: [], markers: [] });
  assert.match(html, /No timeline/);
  assert.match(html, /plain-text transcript has no clock/);
  assert.doesNotMatch(html, /This recording has transcript only/);
}

function testVideoWinsWhenBothExist() {
  const html = renderTimelineSection(true, {
    segments: [...videoSegments, ...transcriptSegments],
    markers: [],
  });
  assert.match(html, /Product walkthrough/);
  assert.doesNotMatch(html, /Conversation phases from the transcript clock/);
}

function testObjectionQaFormat() {
  const merged = resolveObjectionQa({
    objectionText:
      "Customer expressed concern that Zendesk was promised to do many things but failed to deliver. SE and AE emphasized that Freshdesk is straightforward to migrate.",
    landed: true,
  });
  assert.match(merged.question, /Zendesk was promised/i);
  assert.match(merged.answer, /Freshdesk is straightforward/i);
  assert.doesNotMatch(merged.question, /Customer expressed/i);

  const html = renderObjectionQaRow({
    objectionText: "Do you support SSO with Okta?",
    handling: "Walked through SAML setup and shared admin guide.",
    landed: true,
    theme: "security",
    atS: 2100,
  });
  assert.match(html, /call-qa-label/);
  assert.match(html, /Do you support SSO/);
  assert.match(html, /Walked through SAML/);
  assert.match(html, /pill green/);
  assert.match(html, /35:00/);
}

function testEscaping() {
  const html = renderTimelineSection(false, {
    segments: [],
    markers: [{ atS: 10, kind: "gap", label: '<img src=x onerror="alert(1)">' }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
}

function testSpineHasInlineLayout() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: [],
    facts: { durationSec: 900 },
  });
  assert.match(html, /call-spine spine" style="[^"]*height:56px/);
  assert.match(html, /class="seg" style="[^"]*position:absolute/);
}

function testSpineSurvivesBadDuration() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: [],
    facts: { durationSec: 9_999_999 },
  });
  const widths = [...html.matchAll(/width:([0-9.]+)%/g)].map((m) => Number(m[1]));
  assert.ok(widths.some((w) => w > 10), "segments stay visible when duration metadata is wrong");
}

function testMarkerLabelsStaggerRows() {
  const dense = [
    { atS: 100, kind: "gap", label: "font_gap" },
    { atS: 130, kind: "gap", label: "ai_customer_f" },
    { atS: 160, kind: "objection", label: "reporting_ana" },
    { atS: 400, kind: "win", label: "what worked" },
  ];
  const { placements, hidden } = layoutSpineMarkerLabels(dense, 900);
  const labeled = placements.filter((p) => p.label);
  assert.ok(labeled.length >= 2, "some labels remain visible");
  const rows = new Set(labeled.map((p) => p.label.row));
  assert.ok(rows.size >= 2 || labeled.some((p) => p.label.clusterExtra), "labels stagger or cluster");
  assert.equal(hidden.length, 0, "moderate density should not overflow");
}

function testClusterBadgeForDenseEnd() {
  const clustered = [
    { atS: 850, kind: "gap", label: "font_gap" },
    { atS: 860, kind: "gap", label: "knowledge_gap" },
    { atS: 870, kind: "objection", label: "pricing_push" },
    { atS: 880, kind: "win", label: "demo_win" },
  ];
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: clustered,
    facts: { durationSec: 900 },
  });
  assert.match(html, /mkl-more/);
  assert.match(html, /\+3 more/);
  assert.match(html, /font_gap/);
}

function testOverflowListWhenLabelsHidden() {
  const many = Array.from({ length: 14 }, (_, i) => ({
    atS: 820 + i * 2,
    kind: i % 2 ? "gap" : "objection",
    label: `event_${i}`,
  }));
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: many,
    facts: { durationSec: 900 },
  });
  assert.match(html, /call-spine-marker-overflow/);
  assert.match(html, /event_13/);
}

function testMarkerLabelRowClasses() {
  const html = renderTimelineSection(true, { segments: videoSegments, markers, facts: { durationSec: 900 } });
  assert.match(html, /mkl--row-/);
}

testVideoSpineWireframe();
testTranscriptSpine();
testInlineMarkersOnBar();
testNoMarkerLegendWhenEmpty();
testMarkersWithoutSpine();
testEmptyStateIsHonest();
testVideoWinsWhenBothExist();
testObjectionQaFormat();
testEscaping();
testSpineHasInlineLayout();
testSpineSurvivesBadDuration();
testMarkerLabelsStaggerRows();
testClusterBadgeForDenseEnd();
testOverflowListWhenLabelsHidden();
testMarkerLabelRowClasses();
console.log("test-call-timeline-render: ok");
