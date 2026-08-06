/** Timeline card — wireframe spine, event list, combined legend. */
import assert from "node:assert/strict";

import {
  renderTimelineSection,
  resolveObjectionQa,
  renderObjectionQaRow,
  humanizeMarkerLabel,
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

const themeMarkers = [
  { atS: 400, kind: "gap", label: "product_gap" },
  { atS: 800, kind: "win", label: "ai_agent_facing" },
  { atS: 1200, kind: "objection", label: "admin_console" },
];

function testHumanizeLabels() {
  assert.equal(humanizeMarkerLabel("product_gap", "gap"), "Product Gap");
  assert.equal(humanizeMarkerLabel("ai_agent_facing", "win"), "AI Agent Facing");
  assert.equal(humanizeMarkerLabel("admin_console", "objection"), "Admin Console");
  assert.match(humanizeMarkerLabel("ai_platform · training_tuning", "gap"), /AI Platform/);
}

function testVideoSpineWireframe() {
  const html = renderTimelineSection(
    true,
    { segments: videoSegments, markers, facts: { durationSec: 2880 } },
    "48 minutes",
  );
  assert.match(html, /Product walkthrough/);
  assert.match(html, /call-spine-legend/);
  assert.match(html, /Product \/ CDE/);
  assert.match(html, /Product gap/);
  assert.match(html, /call-spine-events/);
  assert.doesNotMatch(html, /class="mk /);
  assert.doesNotMatch(html, /class="mkl /);
  assert.doesNotMatch(html, /call-timeline-list/);
}

function testTranscriptSpine() {
  const html = renderTimelineSection(false, { segments: transcriptSegments, markers });
  assert.match(html, /Intro and agenda/);
  assert.match(html, /Conversation phases from the transcript clock/);
}

function testEventListReadable() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: themeMarkers,
    facts: { durationSec: 3824 },
  });
  assert.match(html, /Product Gap/);
  assert.match(html, /AI Agent Facing/);
  assert.match(html, /Admin Console/);
  assert.doesNotMatch(html, /product_gap/);
  assert.doesNotMatch(html, /ai_agent/);
  assert.match(html, /call-spine-dot/);
}

function testNoMarkerLegendWhenEmpty() {
  const html = renderTimelineSection(true, {
    segments: videoSegments,
    markers: [],
    facts: { durationSec: 900 },
  });
  assert.doesNotMatch(html, /call-spine-events/);
  assert.doesNotMatch(html, /call-spine-dot/);
}

function testMarkersWithoutSpine() {
  const html = renderTimelineSection(false, { segments: [], markers });
  assert.match(html, /gap raised/);
}

function testEmptyStateIsHonest() {
  const html = renderTimelineSection(false, { segments: [], markers: [] });
  assert.match(html, /No timeline/);
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
      "Customer expressed concern that Zendesk was promised to do many things but failed to deliver. SE emphasized Freshdesk is straightforward to migrate.",
    landed: true,
  });
  assert.match(merged.question, /Zendesk was promised/i);
  assert.doesNotMatch(merged.question, /Customer expressed/i);
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
}

testHumanizeLabels();
testVideoSpineWireframe();
testTranscriptSpine();
testEventListReadable();
testNoMarkerLegendWhenEmpty();
testMarkersWithoutSpine();
testEmptyStateIsHonest();
testVideoWinsWhenBothExist();
testObjectionQaFormat();
testEscaping();
testSpineHasInlineLayout();
console.log("test-call-timeline-render: ok");
