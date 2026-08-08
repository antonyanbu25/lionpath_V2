/** Timeline card — wireframe spine, inline markers, five-metric row. */
import assert from "node:assert/strict";

import {
  renderTimelineSection,
  resolveObjectionQa,
  renderObjectionQaRow,
  humanizeMarkerLabel,
  mergeSupplementalTimelineMarkers,
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
  assert.match(html, /call-spine-legend--head/);
  assert.match(html, /Product \/ CDE/);
  assert.ok(
    html.indexOf("call-timeline-head") < html.indexOf("call-spine-legend--head"),
    "segment legend in timeline header",
  );
  assert.match(html, /mkl--objection/);
  assert.doesNotMatch(html, /call-timeline-list/);
  assert.doesNotMatch(html, /Built from transcript timestamps/);
  assert.doesNotMatch(html, /mkl-more/);
  assert.doesNotMatch(html, /call-spine-marker-overflow/);
  assert.doesNotMatch(html, /call-spine-marker-legend/);
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
  assert.doesNotMatch(html, /what worked/i);
  assert.doesNotMatch(html, /mk--win/);
  assert.doesNotMatch(html, />What worked</);
  assert.match(html, /weak CTA/);
  assert.match(html, /mk--gap/);
  assert.match(html, /mk--objection/);
  assert.doesNotMatch(html, /call-spine-marker-legend/);
  assert.doesNotMatch(html, />Product gap</);
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

function testHumanizedGapMarkerLabel() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: [{ atS: 420, kind: "gap", label: "ticketing_workflow · sla_escalation" }],
    facts: { durationSec: 900 },
  });
  assert.match(html, /Ticketing Workflow › Sla Escalation|Ticketing Workflow › SLA/i);
  assert.doesNotMatch(html, /ticketing_workflow/);
}

function testSupplementalMarkersFromPass6() {
  const merged = mergeSupplementalTimelineMarkers([], {
    productGaps: [
      {
        atS: 612,
        headline: "AI value unproven",
        productArea: "ai_customer_facing",
        subArea: "deflection",
        verbatim: "We need proof AI works",
      },
    ],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "AI value unproven");
  assert.equal(merged[0].kind, "gap");
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

function testMarkerLabelsStaggerOrCluster() {
  const dense = [
    { atS: 100, kind: "gap", label: "E-commerce Chatbot Integration" },
    { atS: 130, kind: "gap", label: "AI Value Unproven" },
    { atS: 160, kind: "objection", label: "pricing pushback" },
    { atS: 400, kind: "gap", label: "Product gap" },
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
    { atS: 850, kind: "gap", label: "E-commerce Chatbot Integration" },
    { atS: 860, kind: "gap", label: "AI Value Unproven" },
    { atS: 870, kind: "gap", label: "pricing pushback" },
  ];
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: clustered,
    facts: { durationSec: 900 },
  });
  assert.match(html, /3 product gaps/);
  assert.match(html, /mkl--anchor-end/);
  assert.doesNotMatch(html, /call-spine-marker-overflow/);
  assert.ok((html.match(/class="mk /g) || []).length === 3, "all ticks still render");
}

function testLateMarkersDoNotStretchBar() {
  const html = renderTimelineSection(true, {
    segments: [
      { source: "video", startS: 0, endS: 600, segmentType: "slides", label: "Introductions and discovery" },
      { source: "video", startS: 600, endS: 1500, segmentType: "product", label: "Product demo of Freshdesk" },
      { source: "video", startS: 1500, endS: 1980, segmentType: "product", label: "Pricing and closing" },
    ],
    markers: [
      { atS: 2185, kind: "gap", label: "E-commerce Chatbot Integration" },
      { atS: 2220, kind: "gap", label: "AI Value Unproven" },
    ],
    facts: { durationSec: 1980 },
  });
  assert.match(html, /33:00/);
  assert.match(html, /call-spine-axis">[\s\S]*<span>33:00<\/span>/);
  assert.doesNotMatch(html, /call-spine-axis">[\s\S]*37:00/);
  assert.match(html, /2 product gaps/);
  assert.match(html, /mkl--anchor-end/);
  assert.doesNotMatch(html, /call-spine-marker-overflow/);
  assert.doesNotMatch(html, /gap raised/);
  const tickLefts = [...html.matchAll(/class="mk[^"]*" style="left:([0-9.]+)%"/g)].map((m) => Number(m[1]));
  assert.ok(tickLefts.every((p) => p <= 100), "ticks stay on the bar");
  assert.ok(tickLefts.every((p) => p >= 99), "late markers clamp to the end");
}

function testEndLabelsStayInsideBar() {
  const { placements } = layoutSpineMarkerLabels(
    [
      { atS: 2200, kind: "gap", label: "AI Value Unproven" },
      { atS: 2210, kind: "gap", label: "E-commerce Chatbot Integration" },
    ],
    1980,
  );
  for (const p of placements) {
    assert.ok(p.tickLeftPct <= 100, "tick stays on bar");
  }
  const labeled = placements.find((x) => x.label);
  assert.ok(labeled?.label?.anchor === "end", "end cluster right-anchors");
  assert.ok(labeled.label.leftPct <= 100);
  assert.match(labeled.label.text, /2 product gaps/);
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
testHumanizedGapMarkerLabel();
testSupplementalMarkersFromPass6();
testMarkerLabelsStaggerOrCluster();
testClusterBadgeForDenseEnd();
testLateMarkersDoNotStretchBar();
testEndLabelsStayInsideBar();
console.log("test-call-timeline-render: ok");
