/**
 * Live Pass 2 against a Zoom share link (requires ffmpeg + network).
 *
 * Usage:
 *   source scripts/agent-env.sh   # from repo root, if needed
 *   cd worker
 *   VIDEO_DATA_DIR=/tmp/lionpath-video \
 *     node --import tsx scripts/test-video-pass-live.mjs '<share-url>' '<passcode>' [--consent]
 *
 * Without a URL, checks ffmpeg capability only and exits 0.
 */

import { mkdir } from "node:fs/promises";
import { videoPassReady } from "../src/video/capability.ts";
import { runVideoPass } from "../src/video/pass2.ts";

const url = process.argv[2];
const pwd = process.argv[3];
const consent = process.argv.includes("--consent");

process.env.VIDEO_DATA_DIR = process.env.VIDEO_DATA_DIR || "/tmp/lionpath-video";
process.env.VIDEO_PASS_ENABLED = process.env.VIDEO_PASS_ENABLED || "1";
await mkdir(process.env.VIDEO_DATA_DIR, { recursive: true });

const cap = await videoPassReady({ VIDEO_PASS_ENABLED: "1" });
console.log("capability:", cap);

if (!url) {
  if (!cap.ready) {
    console.error("ffmpeg not ready — install ffmpeg or run on VPS image.");
    process.exit(2);
  }
  console.log("ffmpeg ready. Pass a Zoom share URL to run a live sample.");
  process.exit(0);
}

const result = await runVideoPass(
  {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    POSTCALL_MODEL: process.env.POSTCALL_MODEL || "gemini-3.1-flash-lite",
    VIDEO_PASS_ENABLED: "1",
  },
  {
    callId: `call_live_${Date.now()}`,
    recordingUrl: url,
    recordingPassword: pwd,
    visualAnalysisConsent: consent,
    skipVision: !process.env.GEMINI_API_KEY,
  },
);

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      unavailable: result.unavailable,
      reason: result.reason,
      status: result.videoFacts.status,
      cameraOnPct: result.videoFacts.cameraOnPct,
      cdeCustomized: result.videoFacts.cdeCustomized,
      cdeEvidence: result.videoFacts.cdeEvidence,
      shareOnPct: result.videoFacts.shareOnPct,
      streamKind: result.videoFacts.streamKind,
      keyframes: result.videoFacts.keyframeRefs.length,
      segments: result.videoFacts.segments.length,
      consent: result.videoFacts.visualAnalysisConsent,
      error: result.videoFacts.errorMessage,
    },
    null,
    2,
  ),
);

process.exit(result.ok || result.unavailable ? 0 : 1);
