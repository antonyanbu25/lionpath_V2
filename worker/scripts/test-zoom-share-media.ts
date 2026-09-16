/**
 * Unit tests for Zoom share media URL extraction (no live network).
 * Run: tsx scripts/test-zoom-share-media.ts
 */

import assert from "node:assert/strict";
import {
  extractZoomEmbeddedPasscode,
  parseRecordingPaste,
  parseZoomShareUrl,
  pickMediaStreams,
  preferredMediaStream,
  type PlayInfoResult,
} from "../src/zoomShare.ts";

const REFERER = "https://freshworks.zoom.us/";

function testPickMediaStreamsCookie() {
  const data = {
    viewMp4Url: "https://cdn.example/view.mp4?sig=1",
  };
  const media = pickMediaStreams(data, REFERER, "_zm_page_auth=abc");
  assert.ok(media);
  assert.equal(media!.cookieHeader, "_zm_page_auth=abc");
}

function testPicksCompositePreferred() {
  const data: PlayInfoResult = {
    viewMp4Url: "https://cdn.example/view.mp4?sig=1",
    shareMp4Url: "https://cdn.example/share.mp4?sig=2",
    viewMp4WithshareUrl: "https://cdn.example/composite.mp4?sig=3",
    duration: 2700,
    disableDownload: false,
    recording: { fileSizeInMB: "412.5" },
    totalClips: 1,
  };
  const media = pickMediaStreams(data, REFERER);
  assert.ok(media);
  assert.equal(media!.streams.length, 3);
  assert.equal(media!.preferredKind, "view_with_share");
  assert.equal(media!.durationSec, 2700);
  assert.equal(media!.fileSizeMb, 412.5);
  assert.equal(media!.disableDownload, false);
  assert.equal(media!.referer, REFERER);
  assert.equal(preferredMediaStream(media)!.url, "https://cdn.example/composite.mp4?sig=3");
}

function testRelativeUrlsResolved() {
  const data: PlayInfoResult = {
    viewMp4Url: "/replay/view.mp4?token=abc",
  };
  const media = pickMediaStreams(data, REFERER);
  assert.ok(media);
  assert.equal(media!.streams.length, 1);
  assert.equal(media!.preferredKind, "view");
  assert.equal(media!.streams[0].url, "https://freshworks.zoom.us/replay/view.mp4?token=abc");
}

function testShareOnly() {
  const data: PlayInfoResult = {
    shareMp4Url: "https://cdn.example/share-only.mp4",
    numOfClipFile: 2,
  };
  const media = pickMediaStreams(data, REFERER);
  assert.ok(media);
  assert.equal(media!.preferredKind, "share");
  assert.equal(media!.totalClips, 2);
  assert.equal(preferredMediaStream(media)!.kind, "share");
}

function testNoMediaUndefined() {
  const data: PlayInfoResult = {
    transcriptUrl: "/nws/recording/1.0/play/vtt?fid=x",
    hasTranscript: true,
  };
  assert.equal(pickMediaStreams(data, REFERER), undefined);
  assert.equal(preferredMediaStream(undefined), undefined);
}

function testEmptyStringsIgnored() {
  const data: PlayInfoResult = {
    viewMp4Url: "  ",
    shareMp4Url: "",
  };
  assert.equal(pickMediaStreams(data, REFERER), undefined);
}

function testDisableDownloadStillReturnsStreams() {
  // Host may hide the Download button while play/info still exposes stream URLs.
  const data: PlayInfoResult = {
    viewMp4WithshareUrl: "https://cdn.example/c.mp4",
    disableDownload: true,
  };
  const media = pickMediaStreams(data, REFERER);
  assert.ok(media);
  assert.equal(media!.disableDownload, true);
  assert.equal(media!.streams.length, 1);
}

function testPathTokenIsNotMeetingPasscode() {
  const url =
    "https://freshworks.zoom.us/rec/share/wZtVwIaG1_6sB7Z-u7Y6B0LeKtPueQYQJq4m4WGFNauX6vriJiEJ32s1vvG7I7Q.SyKHamSvFFj5Z7to?startTime=1784820709000";
  const u = new URL(url);
  const id =
    "wZtVwIaG1_6sB7Z-u7Y6B0LeKtPueQYQJq4m4WGFNauX6vriJiEJ32s1vvG7I7Q.SyKHamSvFFj5Z7to";
  const extracted = extractZoomEmbeddedPasscode(id, u);
  // Path .token stays on rawId — it is NOT treated as the meeting passcode.
  assert.equal(extracted.rawId, id);
  assert.equal(extracted.pathToken, "SyKHamSvFFj5Z7to");
  assert.equal(extracted.queryPwd, undefined);
  const pasted = parseRecordingPaste(url);
  assert.equal(pasted.passcode, undefined);
}

function testEmbeddedPasscodeFromPwdQuery() {
  const url =
    "https://freshworks.zoom.us/rec/share/abc123def456ghi789jkl012mno345?pwd=yNYIS408EJygs7rE5vVsJwXIz4-VW7MH";
  const pasted = parseRecordingPaste(url);
  assert.equal(pasted.passcode, "yNYIS408EJygs7rE5vVsJwXIz4-VW7MH");
}

function testParseZoomShareUrlAcceptsVanityAndWrappers() {
  const id =
    "6MEJ2k7HpXytcPxctK3QbdjAXa5Ia8HKudeGuaCXLCzvJR6kGukUbvTPPVPtzrNK.6vmMiETOazxB3hML";
  const clean = `https://freshworks.zoom.us/rec/share/${id}?startTime=1784820709000`;
  const parsed = parseZoomShareUrl(clean);
  assert.equal(parsed.origin, "https://freshworks.zoom.us");
  assert.equal(parsed.type, "share");
  assert.equal(parsed.rawId, id);
  assert.equal(parsed.url.searchParams.get("startTime"), "1784820709000");

  const noProto = parseZoomShareUrl(`freshworks.zoom.us/rec/share/${id}`);
  assert.equal(noProto.origin, "https://freshworks.zoom.us");
  assert.equal(noProto.rawId, id);

  const wrapped = parseZoomShareUrl(`Recording\n${clean}\nPasscode: 1aB2cD`);
  assert.equal(wrapped.rawId, id);

  const zwsp = parseZoomShareUrl(`\u200b${clean}`);
  assert.equal(zwsp.rawId, id);

  const outlook = parseZoomShareUrl(
    `https://nam.safelinks.protection.outlook.com/?url=${encodeURIComponent(clean)}&data=1`,
  );
  assert.equal(outlook.rawId, id);
  assert.equal(outlook.url.searchParams.get("startTime"), "1784820709000");
}

function testParseZoomShareUrlRejectsJoinLinks() {
  try {
    parseZoomShareUrl("https://freshworks.zoom.us/j/123456789?pwd=abc");
    assert.fail("expected join-link error");
  } catch (err) {
    assert.equal((err as Error).message.includes("meeting join link"), true);
    assert.equal((err as { status?: number }).status, 400);
  }
}

function testParseZoomShareUrlInvalidIs400() {
  try {
    parseZoomShareUrl("https://example.com/not-zoom");
    assert.fail("expected invalid-link error");
  } catch (err) {
    assert.equal((err as { status?: number }).status, 400);
    assert.match((err as Error).message, /Invalid Zoom recording link/);
  }
}

testPickMediaStreamsCookie();
testPicksCompositePreferred();
testRelativeUrlsResolved();
testShareOnly();
testNoMediaUndefined();
testEmptyStringsIgnored();
testDisableDownloadStillReturnsStreams();
testPathTokenIsNotMeetingPasscode();
testEmbeddedPasscodeFromPwdQuery();
testParseZoomShareUrlAcceptsVanityAndWrappers();
testParseZoomShareUrlRejectsJoinLinks();
testParseZoomShareUrlInvalidIs400();
console.log("test-zoom-share-media: ok");
