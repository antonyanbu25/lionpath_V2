/** Timeline card — wireframe spine, inline markers, five-metric row. */
import assert from "node:assert/strict";

import { renderTimelineSection } from "../call-view.js";

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
  assert.match(html, /SE talk ratio/);
  assert.match(html, /Customer questions/);
  assert.match(html, /Longest monologue/);
  assert.match(html, /6m 40s/);
  assert.match(html, /SE camera on/);
  assert.match(html, /Customer cameras/);
  assert.match(html, /1 of 2/);
  assert.match(html, /class="mkl"/);
  assert.doesNotMatch(html, /call-timeline-list/);
  assert.doesNotMatch(html, /Built from transcript timestamps/);
}

function testTranscriptSpine() {
  const html = renderTimelineSection(false, { segments: transcriptSegments, markers });

  assert.match(html, /Intro and agenda/);
  assert.doesNotMatch(html, /feeds call flow scoring directly/);
  assert.match(html, /Conversation phases from the transcript clock/);
  assert.match(html, /Camera, CDE, call flow and engagement stay unscored/);
  assert.doesNotMatch(html, /call-timeline-list/);
}

function testInlineMarkersOnBar() {
  const html = renderTimelineSection(true, { segments: videoSegments, markers, facts: { durationSec: 900 } });
  assert.match(html, /gap raised/);
  assert.match(html, /what worked/);
  assert.match(html, /weak CTA/);
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

function testEscaping() {
  const html = renderTimelineSection(false, {
    segments: [],
    markers: [{ atS: 10, kind: "gap", label: '<img src=x onerror="alert(1)">' }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
}

testVideoSpineWireframe();
testTranscriptSpine();
testInlineMarkersOnBar();
testMarkersWithoutSpine();
testEmptyStateIsHonest();
testVideoWinsWhenBothExist();
testEscaping();
console.log("test-call-timeline-render: ok");
