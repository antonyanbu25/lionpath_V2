/** Timeline card — compact spine, dot markers, combined legend. */
import assert from "node:assert/strict";

import {
  renderTimelineSection,
  resolveObjectionQa,
  humanizeMarkerLabel,
  resolveSpineDuration,
} from "../call-view.js";

const videoSegments = [
  { source: "video", startS: 0, endS: 300, segmentType: "slides", label: "Intro deck" },
  { source: "video", startS: 300, endS: 900, segmentType: "product", label: "Product walkthrough" },
];

const markers = [
  { atS: 200, kind: "objection", label: "pricing" },
  { atS: 600, kind: "gap", label: "product_gap" },
  { atS: 900, kind: "win", label: "ai_agent_facing" },
];

function testHumanizeLabels() {
  assert.equal(humanizeMarkerLabel("product_gap", "gap"), "Product Gap");
  assert.equal(humanizeMarkerLabel("ai_agent_facing", "win"), "AI Agent Facing");
}

function testCompactSpine() {
  const html = renderTimelineSection(
    true,
    { segments: videoSegments, markers, facts: { durationSec: 3824 } },
    "63 minutes",
  );
  assert.match(html, /mk-dot/);
  assert.match(html, /call-spine-dot/);
  assert.doesNotMatch(html, /call-spine-events/);
  assert.doesNotMatch(html, /class="mk /);
  assert.doesNotMatch(html, /class="mkl /);
  assert.match(html, /title="[^"]*Product Gap/);
}

function testNoEventListExpansion() {
  const many = Array.from({ length: 12 }, (_, i) => ({
    atS: 100 + i * 200,
    kind: "win",
    label: `theme_key_${i}`,
  }));
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: many,
    facts: { durationSec: 3824 },
  });
  assert.doesNotMatch(html, /call-spine-events/);
  assert.ok((html.match(/mk-dot--/g) || []).length === 12);
}

/** Markers after video share window must extend the spine scale (not clip off-bar). */
function testMarkerDurationScale() {
  const lateMarkers = [
    { atS: 1200, kind: "gap", label: "product_gap" },
    { atS: 2400, kind: "objection", label: "pricing" },
  ];
  const total = resolveSpineDuration(3824, videoSegments, lateMarkers);
  assert.ok(total >= 2400, `expected spine to include late markers, got ${total}`);
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: lateMarkers,
    facts: { durationSec: 3824 },
  });
  assert.match(html, /mk-dot mk-dot--gap/);
  assert.match(html, /mk-dot mk-dot--objection/);
  const gapLeft = html.match(/mk-dot mk-dot--gap" style="left:([\d.]+)%"/);
  assert.ok(gapLeft, "gap dot should render on bar");
  assert.ok(Number(gapLeft[1]) > 0 && Number(gapLeft[1]) <= 100);
}

function testAlternateAtField() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: [{ atSec: 450, kind: "win", label: "demo_flow" }],
    facts: { durationSec: 900 },
  });
  assert.match(html, /mk-dot mk-dot--win/);
}

testHumanizeLabels();
testCompactSpine();
testNoEventListExpansion();
testMarkerDurationScale();
testAlternateAtField();
console.log("test-call-timeline-render: ok");
