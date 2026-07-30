/**
 * Unit tests for Zoom Server-to-Server OAuth recording fetch (mocked fetch, no network).
 * Run: tsx scripts/test-zoom-api.ts
 */

import assert from "node:assert/strict";
import {
  extractShareStartTimeMs,
  fetchZoomRecordingViaApi,
  findRecordingByStartTime,
  getZoomApiToken,
  mediaFromRecording,
  resetZoomApiTokenCache,
  type ZoomApiError,
  type ZoomRecordingMeeting,
} from "../src/zoom-api.ts";
import { zoomApiConfigured } from "../src/zoom.ts";

const env = {
  ZOOM_ACCOUNT_ID: "acct_1",
  ZOOM_CLIENT_ID: "client_1",
  ZOOM_CLIENT_SECRET: "secret_1",
};

const START_MS = Date.parse("2026-07-24T09:00:00Z");

const MEETING: ZoomRecordingMeeting = {
  uuid: "abc==",
  topic: "Acme — technical deep dive",
  start_time: "2026-07-24T09:00:00Z",
  duration: 45,
  host_email: "se@freshworks.com",
  recording_files: [
    {
      file_type: "TRANSCRIPT",
      download_url: "https://zoom.us/rec/download/transcript.vtt",
      status: "completed",
    },
    {
      file_type: "MP4",
      recording_type: "shared_screen_with_speaker_view",
      file_size: 524_288_000,
      download_url: "https://zoom.us/rec/download/composite.mp4",
      status: "completed",
    },
    {
      file_type: "MP4",
      recording_type: "active_speaker",
      download_url: "https://zoom.us/rec/download/speaker.mp4",
      status: "completed",
    },
    {
      file_type: "M4A",
      download_url: "https://zoom.us/rec/download/audio.m4a",
      status: "completed",
    },
  ],
};

const VTT = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nSE: Thanks for joining.\n";

interface MockCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: string },
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function defaultHandler(url: string): { status?: number; body: string } {
  if (url.startsWith("https://zoom.us/oauth/token")) {
    return { body: JSON.stringify({ access_token: "tok_123", expires_in: 3600 }) };
  }
  if (url.includes("/accounts/me/recordings")) {
    return { body: JSON.stringify({ meetings: [MEETING], next_page_token: "" }) };
  }
  if (url.includes("transcript.vtt")) return { body: VTT };
  return { status: 404, body: "not found" };
}

function testConfigDetection() {
  assert.equal(zoomApiConfigured(env), true);
  assert.equal(zoomApiConfigured({ ZOOM_CLIENT_ID: "a", ZOOM_CLIENT_SECRET: "b" }), false);
  assert.equal(zoomApiConfigured({}), false);
}

function testStartTimeExtraction() {
  assert.equal(
    extractShareStartTimeMs("https://freshworks.zoom.us/rec/share/ABC.def?startTime=1784820709000"),
    1784820709000,
  );
  assert.equal(extractShareStartTimeMs("https://freshworks.zoom.us/rec/share/ABC.def"), undefined);
  assert.equal(extractShareStartTimeMs("not a url"), undefined);
  assert.equal(extractShareStartTimeMs("https://zoom.us/rec/share/A?startTime=0"), undefined);
}

async function testTokenFetchAndCache() {
  resetZoomApiTokenCache();
  const { fetch: f, calls } = mockFetch(defaultHandler);
  const first = await getZoomApiToken(env, f);
  const second = await getZoomApiToken(env, f);
  assert.equal(first, "tok_123");
  assert.equal(second, "tok_123");
  assert.equal(calls.length, 1, "second call must come from cache");

  const auth = (calls[0].init?.headers as Record<string, string>).Authorization;
  const expected = Buffer.from("client_1:secret_1", "utf8").toString("base64");
  assert.equal(auth, `Basic ${expected}`);
  assert.ok(calls[0].url.includes("grant_type=account_credentials"));
  assert.ok(calls[0].url.includes("account_id=acct_1"));
}

async function testTokenFailureSurfacesStatus() {
  resetZoomApiTokenCache();
  const { fetch: f } = mockFetch(() => ({ status: 401, body: "Invalid client" }));
  await assert.rejects(
    () => getZoomApiToken(env, f),
    (err: ZoomApiError) => {
      assert.match(err.message, /Zoom OAuth token failed \(401\)/);
      assert.equal(err.status, 502);
      return true;
    },
  );
}

async function testStartTimeMatching() {
  const { fetch: f, calls } = mockFetch(defaultHandler);
  const found = await findRecordingByStartTime("tok", START_MS, f);
  assert.equal(found?.topic, "Acme — technical deep dive");
  assert.ok(calls[0].url.includes("from=2026-07-23"));
  assert.ok(calls[0].url.includes("to=2026-07-25"));

  // Two hours off is a different call, not drift.
  const missed = await findRecordingByStartTime("tok", START_MS + 2 * 60 * 60 * 1000, f);
  assert.equal(missed, undefined);

  // A minute of drift still matches.
  const drifted = await findRecordingByStartTime("tok", START_MS + 60_000, f);
  assert.equal(drifted?.uuid, "abc==");
}

function testMediaSelection() {
  const media = mediaFromRecording(MEETING, "tok_123");
  assert.ok(media);
  assert.equal(media!.preferredKind, "view_with_share");
  assert.equal(media!.streams[0].url, "https://zoom.us/rec/download/composite.mp4");
  assert.equal(media!.streams[1].kind, "view");
  assert.equal(media!.authHeader, "Bearer tok_123");
  assert.equal(media!.durationSec, 45 * 60);
  assert.equal(media!.fileSizeMb, 500);

  const audioOnly: ZoomRecordingMeeting = {
    ...MEETING,
    recording_files: MEETING.recording_files!.filter((f) => f.file_type !== "MP4"),
  };
  assert.equal(mediaFromRecording(audioOnly, "tok"), undefined);

  // Files still processing must not be handed to Pass 2.
  const processing: ZoomRecordingMeeting = {
    ...MEETING,
    recording_files: MEETING.recording_files!.map((f) =>
      f.file_type === "MP4" ? { ...f, status: "processing" } : f,
    ),
  };
  assert.equal(mediaFromRecording(processing, "tok"), undefined);
}

async function testEndToEndFetch() {
  resetZoomApiTokenCache();
  const { fetch: f, calls } = mockFetch(defaultHandler);
  const result = await fetchZoomRecordingViaApi(
    env,
    `https://freshworks.zoom.us/rec/share/WIttp.w8wL?startTime=${START_MS}`,
    f,
  );
  assert.equal(result.transcript, VTT);
  assert.equal(result.source, "transcript");
  assert.equal(result.topic, "Acme — technical deep dive");
  assert.equal(result.startTime, "2026-07-24T09:00:00Z");
  assert.equal(result.hostEmail, "se@freshworks.com");
  assert.equal(result.media?.streams.length, 2);

  const transcriptCall = calls.find((c) => c.url.includes("transcript.vtt"));
  assert.ok(transcriptCall, "transcript must be downloaded");
  assert.equal(
    (transcriptCall!.init?.headers as Record<string, string>).Authorization,
    "Bearer tok_123",
  );
}

async function testNoStartTimeFallsBack() {
  resetZoomApiTokenCache();
  const { fetch: f, calls } = mockFetch(defaultHandler);
  await assert.rejects(
    () => fetchZoomRecordingViaApi(env, "https://freshworks.zoom.us/rec/share/ABC.def", f),
    (err: ZoomApiError) => {
      assert.equal(err.fallback, true, "caller must be allowed to try the share scrape");
      assert.match(err.message, /startTime/);
      return true;
    },
  );
  assert.equal(calls.length, 0, "must not call Zoom without a matchable start time");
}

async function testUnconfiguredFallsBack() {
  await assert.rejects(
    () => fetchZoomRecordingViaApi({}, `https://zoom.us/rec/share/A?startTime=${START_MS}`),
    (err: ZoomApiError) => err.fallback === true,
  );
}

async function testNoMatchIsFallback() {
  resetZoomApiTokenCache();
  const { fetch: f } = mockFetch((url) => {
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return { body: JSON.stringify({ access_token: "tok_123", expires_in: 3600 }) };
    }
    return { body: JSON.stringify({ meetings: [] }) };
  });
  await assert.rejects(
    () => fetchZoomRecordingViaApi(env, `https://zoom.us/rec/share/A?startTime=${START_MS}`, f),
    (err: ZoomApiError) => {
      assert.equal(err.status, 404);
      assert.equal(err.fallback, true);
      return true;
    },
  );
}

async function testMissingTranscriptIsHardError() {
  resetZoomApiTokenCache();
  const { fetch: f } = mockFetch((url) => {
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return { body: JSON.stringify({ access_token: "tok_123", expires_in: 3600 }) };
    }
    if (url.includes("/accounts/me/recordings")) {
      const noTranscript = {
        ...MEETING,
        recording_files: MEETING.recording_files!.filter((x) => x.file_type !== "TRANSCRIPT"),
      };
      return { body: JSON.stringify({ meetings: [noTranscript] }) };
    }
    return { status: 404, body: "" };
  });
  await assert.rejects(
    () => fetchZoomRecordingViaApi(env, `https://zoom.us/rec/share/A?startTime=${START_MS}`, f),
    (err: ZoomApiError) => {
      assert.equal(err.fallback, undefined, "a real API answer must not silently fall back");
      assert.match(err.message, /no transcript/i);
      return true;
    },
  );
}

async function main() {
  testConfigDetection();
  testStartTimeExtraction();
  await testTokenFetchAndCache();
  await testTokenFailureSurfacesStatus();
  await testStartTimeMatching();
  testMediaSelection();
  await testEndToEndFetch();
  await testNoStartTimeFallsBack();
  await testUnconfiguredFallsBack();
  await testNoMatchIsFallback();
  await testMissingTranscriptIsHardError();
  console.log("zoom-api tests passed");
}

await main();
