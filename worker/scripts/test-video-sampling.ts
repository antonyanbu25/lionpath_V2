/**
 * Unit tests for strategic Pass 2 sampling windows and camera aggregation.
 * Run: tsx scripts/test-video-sampling.ts
 */

import assert from "node:assert/strict";
import { pickVisionKeyframes } from "../src/video/facts.ts";
import { buildFfmpegHttpHeaders, formatExecFileError } from "../src/video/ffmpeg.ts";
import {
  aggregateParticipantCamera,
  buildAttendeeCurveFromAggregated,
  computeStrategicSampleWindows,
  identityMatchesName,
  mergeAttendeeCurveTalk,
  parseVisionCameraResponse,
  seCameraOnPctFromParticipants,
} from "../src/video/sampling.ts";

function testBuildFfmpegHttpHeaders() {
  const headers = buildFfmpegHttpHeaders({
    referer: "https://freshworks.zoom.us/rec/play/abc?pwd=x",
    cookieHeader: "_zm_page_auth=abc123; cred=xyz",
  });
  assert.ok(headers.includes("Referer: https://freshworks.zoom.us/rec/play/abc?pwd=x\r\n"));
  assert.ok(headers.includes("User-Agent: Mozilla/5.0"));
  assert.ok(headers.includes("Cookie: _zm_page_auth=abc123; cred=xyz\r\n"));
  assert.ok(!headers.includes("Authorization:"));

  const withAuth = buildFfmpegHttpHeaders({
    referer: "https://zoom.us/",
    authHeader: "Bearer tok",
  });
  assert.ok(withAuth.includes("Authorization: Bearer tok\r\n"));
}

function testFormatExecFileErrorIncludesStderr() {
  const err = Object.assign(new Error("Command failed: ffmpeg -headers Referer: x"), {
    stderr: "HTTP error 403 Forbidden\nhttps://cdn.zoom.us/foo: Server returned 403",
  });
  const msg = formatExecFileError(err, "ffmpeg sample");
  assert.ok(msg.includes("403 Forbidden"), msg);
  assert.ok(msg.includes("stderr:"), msg);
}

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
    { atS: 0, path: "/a0.jpg", windowLabel: "opening_10pct" },
    { atS: 3, path: "/a1.jpg", windowLabel: "opening_10pct" },
    { atS: 6, path: "/a2.jpg", windowLabel: "opening_10pct" },
    { atS: 9, path: "/a3.jpg", windowLabel: "opening_10pct" },
    { atS: 900, path: "/b0.jpg", windowLabel: "pct_30" },
    { atS: 903, path: "/b1.jpg", windowLabel: "pct_30" },
    { atS: 906, path: "/b2.jpg", windowLabel: "pct_30" },
    { atS: 909, path: "/b3.jpg", windowLabel: "pct_30" },
    { atS: 1800, path: "/c0.jpg", windowLabel: "pct_60" },
    { atS: 1803, path: "/c1.jpg", windowLabel: "pct_60" },
    { atS: 1806, path: "/c2.jpg", windowLabel: "pct_60" },
    { atS: 1809, path: "/c3.jpg", windowLabel: "pct_60" },
    { atS: 2700, path: "/d0.jpg", windowLabel: "pct_90" },
    { atS: 2703, path: "/d1.jpg", windowLabel: "pct_90" },
    { atS: 2706, path: "/d2.jpg", windowLabel: "pct_90" },
    { atS: 2709, path: "/d3.jpg", windowLabel: "pct_90" },
    { atS: 3540, path: "/e0.jpg", windowLabel: "closing_1min" },
    { atS: 3543, path: "/e1.jpg", windowLabel: "closing_1min" },
    { atS: 3546, path: "/e2.jpg", windowLabel: "closing_1min" },
    { atS: 3549, path: "/e3.jpg", windowLabel: "closing_1min" },
  ];
  const picked10 = pickVisionKeyframes(samples, 10);
  const picked20 = pickVisionKeyframes(samples, 20);
  const labels10 = new Set(picked10.map((s) => s.windowLabel));
  const labels20 = new Set(picked20.map((s) => s.windowLabel));
  assert.equal(labels10.size, 5, "10-frame budget covers all strategic windows");
  assert.equal(labels20.size, 5, "20-frame budget covers all strategic windows");
  assert.ok(picked10.length <= 10, "10-frame cap honored");
  assert.ok(picked10.length >= labels10.size, "at least one frame per window at 10");
  assert.ok(picked20.length > picked10.length, "20 frames picks more than 10");
  assert.ok(picked20.length <= 20, "20-frame cap honored");
  // Marginal value: same window coverage, extra frames are within-window density only.
  assert.equal(labels10.size, labels20.size, "10 vs 20 — identical window coverage");
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

testBuildFfmpegHttpHeaders();
testFormatExecFileErrorIncludesStderr();
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
