/** Timeline card — video spine, transcript spine, markers, empty states. */
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
  { atS: 200, kind: "objection", label: "security review", quote: "the security review" },
  { atS: 600, kind: "gap", label: "integrations · migration" },
  { atS: 900, kind: "win", label: "automation" },
  { atS: 1200, kind: "weak_cta", label: "no owner named" },
];

function testVideoSpineUnchanged() {
  const html = renderTimelineSection(true, { segments: videoSegments, markers: [] });
  assert.match(html, /Product walkthrough/);
  assert.match(html, /feeds call flow scoring directly/);
  assert.doesNotMatch(html, /Built from transcript timestamps/);
}

function testTranscriptSpine() {
  const html = renderTimelineSection(false, { segments: transcriptSegments, markers });

  assert.match(html, /Intro and agenda/);
  assert.match(html, /Discovery/);
  // Subtitle must not claim a screen-share source or scoring impact.
  assert.doesNotMatch(html, /feeds call flow scoring directly/);
  assert.match(html, /Conversation phases from the transcript clock/);
  assert.match(html, /Camera, CDE, call flow and engagement stay unscored/);
}

function testMarkersNestUnderTheirPhase() {
  const html = renderTimelineSection(false, { segments: transcriptSegments, markers });

  // The objection at 3:20 belongs to discovery (140–520), not intro.
  const introIdx = html.indexOf("Intro and agenda");
  const discoveryIdx = html.indexOf("Discovery");
  const objectionIdx = html.indexOf("security review");
  assert.ok(discoveryIdx > introIdx);
  assert.ok(objectionIdx > discoveryIdx, "objection renders inside the discovery phase");

  assert.match(html, /3:20/);
  assert.match(html, /integrations · migration/);
  assert.match(html, /Weak close/);
  assert.match(html, /pill--win/);
}

function testMarkersWithoutSpine() {
  const html = renderTimelineSection(false, { segments: [], markers });
  assert.match(html, /integrations · migration/);
  assert.doesNotMatch(html, /No timeline/);
}

function testEmptyStateIsHonest() {
  const html = renderTimelineSection(false, { segments: [], markers: [] });
  assert.match(html, /No timeline/);
  assert.match(html, /plain-text transcript has no clock/);
  // The old copy blamed missing video even when a VTT would have worked.
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

testVideoSpineUnchanged();
testTranscriptSpine();
testMarkersNestUnderTheirPhase();
testMarkersWithoutSpine();
testEmptyStateIsHonest();
testVideoWinsWhenBothExist();
testEscaping();
console.log("test-call-timeline-render: ok");
