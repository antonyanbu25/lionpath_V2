/**
 * Unit tests for Zoom share media URL extraction (no live network).
 * Run: tsx scripts/test-zoom-share-media.ts
 */

import assert from "node:assert/strict";
import {
  extractZoomEmbeddedPasscode,
  parseRecordingPaste,
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

testPickMediaStreamsCookie();
testPicksCompositePreferred();
testRelativeUrlsResolved();
testShareOnly();
testNoMediaUndefined();
testEmptyStringsIgnored();
testDisableDownloadStillReturnsStreams();
testPathTokenIsNotMeetingPasscode();
testEmbeddedPasscodeFromPwdQuery();
console.log("test-zoom-share-media: ok");
