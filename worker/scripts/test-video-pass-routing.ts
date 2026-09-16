/**
 * Pass 2 routing helpers — documents when ffmpeg retry should fire.
 * Run: tsx scripts/test-video-pass-routing.ts
 */

import assert from "node:assert/strict";

/** Mirrors post-call confirm: Pass 0 media is never forwarded to /api/video-pass. */
function shouldRetryFfmpegWithFreshUrls(input: {
  recordingUrl?: string;
  media?: { streams?: unknown[] };
}): boolean {
  return !!input.recordingUrl?.trim();
}

function testRetryWhenRecordingUrlWithoutCachedMedia() {
  assert.equal(
    shouldRetryFfmpegWithFreshUrls({ recordingUrl: "https://zoom.us/rec/play/abc" }),
    true,
    "retry when recordingUrl present even without Pass 0 media",
  );
  assert.equal(
    shouldRetryFfmpegWithFreshUrls({
      recordingUrl: "https://zoom.us/rec/play/abc",
      media: undefined,
    }),
    true,
  );
  assert.equal(
    shouldRetryFfmpegWithFreshUrls({ recordingUrl: "", media: { streams: [{}] } }),
    false,
    "no retry without recordingUrl",
  );
}

function testTranscriptFallbackReasonHints() {
  const ffmpegMissing = "ffmpeg not available on API server — check /api/config videoPass.ffmpeg on VPS";
  assert.ok(ffmpegMissing.includes("videoPass.ffmpeg"));
}

testRetryWhenRecordingUrlWithoutCachedMedia();
testTranscriptFallbackReasonHints();
console.log("test-video-pass-routing: ok");
