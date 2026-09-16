/**
 * Unit tests for the zoomShare.ts NETWORK layer (mocked fetch, no live Zoom).
 *
 * Before this file, the entire ZoomSession / share-info / validate-passwd /
 * play-info / VTT-download chain in zoomShare.ts had zero test coverage —
 * only the pure URL/passcode parsers were tested (test-zoom-share-media.ts).
 * That gap included both CAPTCHA branches, the Microsoft-SSO-redirect sniff,
 * and the need-password retry loop (astra-audit finding, implementation
 * prompt P13 / T12).
 *
 * Not covered here: "duplicate re-analysis of the same meeting". That is a
 * dedupe/idempotency-key concern at the SQL layer (worker/src/routes.ts,
 * post_call.idempotency_key), not a network-layer concern of this module —
 * see docs/astra-audit/repros/repro-h2-dual-writer-idempotency-collision.ts
 * for that scenario instead.
 *
 * Run: tsx scripts/test-zoom-share-network.ts
 */

import assert from "node:assert/strict";
import { fetchTranscriptFromShareLink, ZOOM_RECAPTCHA_MSG } from "../src/zoomShare.ts";

const BASE = "https://freshworks.zoom.us";
const VTT_REAL = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nSE: Thanks for joining.\n";
const VTT_CHAPTERS_ONLY =
  "WEBVTT\n\nchapter-1\n00:00:00.000 --> 00:00:01.000\nRecording Started\n\nchapter-2\n00:05:00.000 --> 00:05:01.000\nSharing Started\n";

interface MockCall {
  url: string;
  method: string;
  body?: string;
}

/** @param handler (url, init, callIndexForThisUrl) => { status?, body } */
function mockFetch(
  handler: (url: string, init: RequestInit | undefined, callsSoFar: MockCall[]) => { status?: number; body: string },
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : init?.body?.toString();
    const { status = 200, body: respBody } = handler(url, init, calls);
    calls.push({ url, method, body });
    return new Response(respBody, { status });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function shareInfoOk(overrides: Record<string, unknown> = {}): { status?: number; body: string } {
  return {
    body: JSON.stringify({
      result: {
        componentName: "normal",
        meetingId: "m1",
        fileId: "f1",
        redirectUrl: "/rec/play/ABC123",
        ...overrides,
      },
    }),
  };
}

function playInfoOk(overrides: Record<string, unknown> = {}): { status?: number; body: string } {
  return {
    body: JSON.stringify({
      result: {
        transcriptUrl: "/nws/recording/download/vtt/f1",
        hasTranscript: true,
        meet: { topic: "Acme — deep dive" },
        ...overrides,
      },
    }),
  };
}

async function testHappyPathTranscriptReady() {
  const { fetch: f, calls } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk();
    if (url.includes("/play/info/")) return playInfoOk();
    if (url.includes("/download/vtt/")) return { body: VTT_REAL };
    if (url.includes("/rec/play/")) return { body: "<html><body>Zoom player</body></html>" };
    return { status: 404, body: "unexpected" };
  });
  const result = await fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123?pwd=mypwd`, undefined, f);
  assert.equal(result.transcript, VTT_REAL);
  assert.equal(result.source, "transcript");
  assert.equal(result.topic, "Acme — deep dive");
  // Embedded ?pwd= unlocked share-info directly -- no passcode validation call needed.
  assert.ok(!calls.some((c) => c.url.includes("validate-meeting-passwd")));
}

async function testTranscriptAbsentChapterMarkersOnly() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk();
    if (url.includes("/play/info/")) return playInfoOk({ transcriptUrl: undefined, ccUrl: undefined, hasTranscript: false });
    if (url.includes("/rec/play/")) return { body: "<html><body>Zoom player</body></html>" };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123?pwd=mypwd`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /only chapter markers/i);
      return true;
    },
  );
}

async function testTranscriptAbsentGeneric() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk();
    if (url.includes("/play/info/")) return playInfoOk({ transcriptUrl: undefined, ccUrl: undefined, hasTranscript: undefined });
    if (url.includes("/rec/play/")) return { body: "<html><body>Zoom player</body></html>" };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123?pwd=mypwd`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /no transcript file found/i);
      return true;
    },
  );
}

async function testChapterOnlyVttContentIsRejectedEvenIfUrlPresent() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk();
    if (url.includes("/play/info/")) return playInfoOk();
    if (url.includes("/download/vtt/")) return { body: VTT_CHAPTERS_ONLY };
    if (url.includes("/rec/play/")) return { body: "<html><body>Zoom player</body></html>" };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123?pwd=mypwd`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /chapter markers only/i);
      return true;
    },
  );
}

async function testSeparatelyEnteredPasscodeUnlocksNeedPassword() {
  let shareInfoCalls = 0;
  const { fetch: f, calls } = mockFetch((url, init) => {
    if (url.includes("/play/share-info/")) {
      shareInfoCalls++;
      // First call: locked. Second call (after passcode validated): unlocked.
      return shareInfoCalls === 1 ? shareInfoOk({ componentName: "need-password" }) : shareInfoOk();
    }
    if (url.includes("validate-meeting-passwd")) {
      assert.ok(String(init?.body).includes("passwd=1234"));
      return { body: JSON.stringify({ status: true }) };
    }
    if (url.includes("/play/info/")) return playInfoOk();
    if (url.includes("/download/vtt/")) return { body: VTT_REAL };
    if (url.includes("/rec/play/")) return { body: "<html><body>Zoom player</body></html>" };
    return { status: 404, body: "unexpected" };
  });
  const result = await fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123`, "1234", f);
  assert.equal(result.transcript, VTT_REAL);
  assert.ok(calls.some((c) => c.url.includes("validate-meeting-passwd")));
}

async function testExpiredOrRevokedLinkIsNotFound() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return { body: JSON.stringify({ result: null }) };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/DELETED`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /recording not found/i);
      return true;
    },
  );
}

async function testPermissionDeniedSurfacesHttpStatus() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return { status: 403, body: JSON.stringify({ error: "forbidden" }) };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /403/);
      return true;
    },
  );
}

async function testMicrosoftSsoRedirectIsDetected() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk();
    if (url.includes("/rec/play/")) {
      return {
        body:
          "<html><head><title>Redirect</title></head><body>AADSTS50126: sign in failed. " +
          "Copyright (C) Microsoft Corporation. All rights reserved.</body></html>",
      };
    }
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123?pwd=mypwd`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /redirected to Microsoft sign-in/i);
      return true;
    },
  );
}

async function testRecaptchaOnFirstShareInfoCall() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return { body: JSON.stringify({ result: { needRecaptcha: true } }) };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123`, "1234", f),
    (err: Error) => {
      assert.equal(err.message, ZOOM_RECAPTCHA_MSG);
      return true;
    },
  );
}

async function testRecaptchaViaCaptchaErrorResult() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk({ componentName: "need-password" });
    if (url.includes("validate-meeting-passwd") || url.includes("validate-passwd-passwd")) {
      // Zoom's trap: status:true but result:"captcha_error" -- NOT a real success.
      return { body: JSON.stringify({ status: true, result: "captcha_error" }) };
    }
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123`, "1234", f),
    (err: Error) => {
      assert.equal(err.message, ZOOM_RECAPTCHA_MSG);
      return true;
    },
  );
}

async function testEmptyDownloadedTranscriptIsRejected() {
  const { fetch: f } = mockFetch((url) => {
    if (url.includes("/play/share-info/")) return shareInfoOk();
    if (url.includes("/play/info/")) return playInfoOk();
    if (url.includes("/download/vtt/")) return { body: "   " };
    if (url.includes("/rec/play/")) return { body: "<html><body>Zoom player</body></html>" };
    return { status: 404, body: "unexpected" };
  });
  await assert.rejects(
    () => fetchTranscriptFromShareLink(`${BASE}/rec/share/ABC123?pwd=mypwd`, undefined, f),
    (err: Error) => {
      assert.match(err.message, /was empty/i);
      return true;
    },
  );
}

async function main() {
  await testHappyPathTranscriptReady();
  await testTranscriptAbsentChapterMarkersOnly();
  await testTranscriptAbsentGeneric();
  await testChapterOnlyVttContentIsRejectedEvenIfUrlPresent();
  await testSeparatelyEnteredPasscodeUnlocksNeedPassword();
  await testExpiredOrRevokedLinkIsNotFound();
  await testPermissionDeniedSurfacesHttpStatus();
  await testMicrosoftSsoRedirectIsDetected();
  await testRecaptchaOnFirstShareInfoCall();
  await testRecaptchaViaCaptchaErrorResult();
  await testEmptyDownloadedTranscriptIsRejected();
  console.log("zoom-share-network tests passed");
}

await main();
