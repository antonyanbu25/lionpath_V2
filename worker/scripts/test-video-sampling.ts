/**
 * Unit tests for strategic Pass 2 sampling windows.
 * Run: tsx scripts/test-video-sampling.ts
 */

import assert from "node:assert/strict";
import {
  aggregateParticipantCamera,
  computeStrategicSampleWindows,
  seCameraOnPctFromParticipants,
} from "../src/video/sampling.ts";

function testWindows() {
  const windows = computeStrategicSampleWindows(3600);
  assert.equal(windows.length, 5);
  assert.equal(windows[0].startS, 0);
  assert.ok(windows[0].endS <= 15);
  assert.equal(windows[4].label, "closing_1min");
  assert.equal(windows[4].startS, 3600 - 60);
}

function testAggregateCameraMajority() {
  const rows = aggregateParticipantCamera([
    { name: "Alex Lee", role: "se", secondsOn: 40, secondsOff: 20 },
    { name: "Alex Lee", role: "se", secondsOn: 5, secondsOff: 25 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Alex Lee");
  assert.equal(rows[0].cameraOn, true, "45s on vs 45s off — tie goes to on");
}

function testAggregateCameraOffWins() {
  const rows = aggregateParticipantCamera([
    { name: "Pat", role: "customer", secondsOn: 10, secondsOff: 50 },
  ]);
  assert.equal(rows[0].cameraOn, false);
}

function testSeCameraPct() {
  const pct = seCameraOnPctFromParticipants(
    [{ name: "Sam SE", role: "se", secondsOn: 30, secondsOff: 90, cameraOn: false }],
    "Sam SE",
  );
  assert.equal(pct, 25);
}

testWindows();
testAggregateCameraMajority();
testAggregateCameraOffWins();
testSeCameraPct();
console.log("test-video-sampling: ok");
