/**
 * Unit tests for Pass 2 fact builders (no ffmpeg / network).
 * Run: tsx scripts/test-video-facts.ts
 */

import assert from "node:assert/strict";
import {
  buildSceneSegments,
  buildVideoFactsDraft,
  pickKeyframes,
  type SampleFrame,
} from "../src/video/facts.ts";

function samples(): SampleFrame[] {
  return [
    { atS: 0, path: "/f/0.jpg", sceneDelta: 0 },
    { atS: 10, path: "/f/10.jpg", sceneDelta: 5 },
    { atS: 20, path: "/f/20.jpg", sceneDelta: 40 },
    { atS: 30, path: "/f/30.jpg", sceneDelta: 35 },
    { atS: 40, path: "/f/40.jpg", sceneDelta: 4 },
    { atS: 50, path: "/f/50.jpg", sceneDelta: 3 },
  ];
}

function testPickKeyframes() {
  const picked = pickKeyframes(samples(), 4);
  assert.ok(picked.length <= 4);
  assert.equal(picked[0].atS, 0);
  assert.ok(picked.some((p) => p.sceneDelta && p.sceneDelta >= 35));
}

function testSceneSegments() {
  const segs = buildSceneSegments(samples(), 60, 18);
  assert.ok(segs.length >= 2);
  assert.ok(segs.some((s) => s.segmentType === "scene_change"));
  assert.ok(segs.some((s) => s.segmentType === "none"));
}

function testDraftReady() {
  const draft = buildVideoFactsDraft({
    status: "ready",
    samples: samples(),
    durationSec: 60,
    streamKind: "view_with_share",
    cameraOnPct: 82.4,
  });
  assert.equal(draft.status, "ready");
  assert.equal(draft.cameraOnPct, 82);
  assert.ok(draft.keyframeRefs.length > 0);
  assert.ok(draft.segments.length > 0);
  assert.equal(draft.streamKind, "view_with_share");
}

function testDraftUnavailable() {
  const draft = buildVideoFactsDraft({
    status: "unavailable",
    samples: [],
    errorMessage: "no ffmpeg",
  });
  assert.equal(draft.status, "unavailable");
  assert.equal(draft.keyframeRefs.length, 0);
  assert.equal(draft.segments.length, 0);
}

function testDraftWithSegmentsOverride() {
  const draft = buildVideoFactsDraft({
    status: "ready",
    samples: [],
    streamKind: "transcript_infer",
    segments: [{ startS: 0, endS: 120, segmentType: "slides", label: "Opening deck" }],
    shareOnPct: 65,
  });
  assert.equal(draft.segments.length, 1);
  assert.equal(draft.segments[0].segmentType, "slides");
  assert.equal(draft.shareOnPct, 65);
}

testPickKeyframes();
testSceneSegments();
testDraftReady();
testDraftUnavailable();
testDraftWithSegmentsOverride();
console.log("test-video-facts: ok");
