/**
 * Unit tests for strategic Pass 2 sampling windows and camera aggregation.
 * Run: tsx scripts/test-video-sampling.ts
 */

import assert from "node:assert/strict";
import { pickVisionKeyframes } from "../src/video/facts.ts";
import {
  aggregateParticipantCamera,
  buildAttendeeCurveFromAggregated,
  computeStrategicSampleWindows,
  identityMatchesName,
  mergeAttendeeCurveTalk,
  parseVisionCameraResponse,
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

function testIdentityFuzzyMatch() {
  assert.equal(identityMatchesName("Sathish Kuttan", "Sathish K"), true);
  assert.equal(identityMatchesName("Priyal | AE @Freshworks", "Priyal"), true);
}

function testParseVisionWindows() {
  const aggregated = parseVisionCameraResponse(
    {
      windows: [
        {
          label: "opening_10pct",
          windowSeconds: 15,
          participants: {
            SE: { secondsOn: 15, secondsOff: 0, cameraOn: true },
            AE: { secondsOn: 0, secondsOff: 15, cameraOn: false },
          },
        },
        {
          label: "pct_30",
          windowSeconds: 15,
          participants: {
            SE: { secondsOn: 10, secondsOff: 5 },
            AE: true,
          },
        },
      ],
    },
    { seIdentity: "Sathish Kuttan", aeIdentity: "Priyal | AE @Freshworks" },
  );
  assert.equal(aggregated.length, 2);
  const se = aggregated.find((p) => p.role === "se");
  assert.ok(se?.cameraOn);
  assert.equal(seCameraOnPctFromParticipants(aggregated, "Sathish Kuttan"), 83);
}

function testParseVisionFlatParticipants() {
  const aggregated = parseVisionCameraResponse(
    {
      participants: [
        { name: "Alex Lee", role: "se", cameraOnPct: 80 },
        { name: "Jordan", role: "customer", cameraOn: false },
      ],
    },
    { seIdentity: "Alex Lee" },
  );
  assert.equal(aggregated.length, 2);
  assert.equal(seCameraOnPctFromParticipants(aggregated, "Alex Lee"), 80);
}

function testBuildAttendeeCurveCanonicalNames() {
  const aggregated = parseVisionCameraResponse(
    {
      windows: [
        {
          label: "opening_10pct",
          windowSeconds: 15,
          participants: {
            SE: { secondsOn: 12, secondsOff: 3 },
            AE: { secondsOn: 0, secondsOff: 15 },
          },
        },
      ],
    },
    { seIdentity: "Sathish Kuttan", aeIdentity: "Priyal | AE @Freshworks" },
  );
  const curve = buildAttendeeCurveFromAggregated(aggregated, {
    seIdentity: "Sathish Kuttan",
    aeIdentity: "Priyal | AE @Freshworks",
  });
  assert.equal(curve[0].name, "Sathish Kuttan");
  assert.equal(curve[0].cameraOnPct, 80);
  assert.equal(curve[1].name, "Priyal | AE @Freshworks");
  assert.equal(curve[1].cameraOn, false);
}

function testPickVisionKeyframesPerWindow() {
  const samples = [
    { atS: 0, path: "/a.jpg", windowLabel: "opening_10pct" },
    { atS: 3, path: "/b.jpg", windowLabel: "opening_10pct" },
    { atS: 6, path: "/c.jpg", windowLabel: "opening_10pct" },
    { atS: 900, path: "/d.jpg", windowLabel: "pct_30" },
    { atS: 903, path: "/e.jpg", windowLabel: "pct_30" },
    { atS: 1800, path: "/f.jpg", windowLabel: "pct_60" },
    { atS: 2700, path: "/g.jpg", windowLabel: "pct_90" },
    { atS: 3540, path: "/h.jpg", windowLabel: "closing_1min" },
  ];
  const picked = pickVisionKeyframes(samples, 20);
  const labels = new Set(picked.map((s) => s.windowLabel));
  assert.equal(labels.size, 5, "every strategic window represented");
}

function testMergeAttendeeCurveTalk() {
  const camera = [
    { name: "Sathish Kuttan", role: "se", cameraOn: true, cameraOnPct: 88, talkPct: null },
    { name: "Priyal | AE @Freshworks", role: "ae", cameraOn: false, cameraOnPct: 0, talkPct: null },
  ];
  const talk = [
    { name: "Sathish Kuttan", role: "se", talkPct: 70, cameraOn: false },
    { name: "Priyal", role: "ae", talkPct: 5, cameraOn: false },
    { name: "Harshveer", role: "customer", talkPct: 25, cameraOn: false },
  ];
  const merged = mergeAttendeeCurveTalk(camera, talk, {
    seIdentity: "Sathish Kuttan",
    aeIdentity: "Priyal | AE @Freshworks",
  });
  assert.ok(merged);
  assert.equal(merged![0].talkPct, 70);
  assert.equal(merged![0].cameraOnPct, 88);
  assert.equal(merged![1].talkPct, 5);
  assert.equal(merged![1].cameraOn, false);
}

function testParseVisionTopLevelParticipantsObject() {
  const aggregated = parseVisionCameraResponse(
    {
      participants: {
        SE: { secondsOn: 90, secondsOff: 30, cameraOn: true },
        AE: { secondsOn: 0, secondsOff: 120, cameraOn: false },
      },
    },
    { seIdentity: "Sathish Kuttan", aeIdentity: "Pradeep Solai" },
  );
  assert.equal(aggregated.length, 2);
  const curve = buildAttendeeCurveFromAggregated(aggregated, {
    seIdentity: "Sathish Kuttan",
    aeIdentity: "Pradeep Solai",
  });
  assert.equal(curve[0].name, "Sathish Kuttan");
  assert.equal(curve[0].cameraOn, true);
  assert.equal(curve[1].cameraOn, false);
}

testWindows();
testAggregateCameraMajority();
testAggregateCameraOffWins();
testSeCameraPct();
testIdentityFuzzyMatch();
testParseVisionWindows();
testParseVisionFlatParticipants();
testParseVisionTopLevelParticipantsObject();
testBuildAttendeeCurveCanonicalNames();
testPickVisionKeyframesPerWindow();
testMergeAttendeeCurveTalk();
console.log("test-video-sampling: ok");
