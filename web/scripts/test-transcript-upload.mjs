/** Transcript file upload guards for the post-call form (no DOM). */
globalThis.document = { getElementById: () => null };

import assert from "node:assert/strict";

const { readTranscriptFile } = await import("../postcall.js");

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Priyal: Thanks for making time today.
`;

function fileOf(name, body) {
  return new File([body], name, { type: "text/vtt" });
}

async function testAcceptsVtt() {
  const result = await readTranscriptFile(fileOf("GMT20260724-call.transcript.vtt", VTT));
  assert.equal(result.ok, true);
  // Cue markup stays — the worker's parseTranscript reads VTT directly.
  assert.match(result.text, /WEBVTT/);
  assert.match(result.text, /Priyal: Thanks for making time today\./);
}

async function testAcceptsTxtAndSrt() {
  assert.equal((await readTranscriptFile(fileOf("notes.txt", "SE: hello"))).ok, true);
  assert.equal((await readTranscriptFile(fileOf("cues.srt", "1\nSE: hello"))).ok, true);
}

async function testRejectsWrongExtension() {
  const result = await readTranscriptFile(fileOf("recording.mp4", "not a transcript"));
  assert.equal(result.ok, false);
  assert.match(result.error, /\.vtt/);
}

async function testRejectsEmpty() {
  const result = await readTranscriptFile(fileOf("empty.vtt", "   \n  "));
  assert.equal(result.ok, false);
  assert.match(result.error, /empty/i);
}

async function testRejectsOversize() {
  const big = "x".repeat(5 * 1024 * 1024 + 1);
  const result = await readTranscriptFile(fileOf("huge.vtt", big));
  assert.equal(result.ok, false);
  assert.match(result.error, /5 MB/);
}

async function testRejectsMissingFile() {
  const result = await readTranscriptFile(undefined);
  assert.equal(result.ok, false);
}

await testAcceptsVtt();
await testAcceptsTxtAndSrt();
await testRejectsWrongExtension();
await testRejectsEmpty();
await testRejectsOversize();
await testRejectsMissingFile();
console.log("test-transcript-upload: ok");
