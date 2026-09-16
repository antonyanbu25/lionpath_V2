/**
 * Unit tests for vision frame sizing (no network).
 * Run: tsx scripts/test-frame-image.ts
 */

import assert from "node:assert/strict";
import {
  exceedsGeminiTileLimit,
  GEMINI_TILE_MAX_PX,
  readJpegDimensions,
} from "../src/video/frame-image.ts";

function testTileLimit() {
  assert.equal(GEMINI_TILE_MAX_PX, 768);
  assert.equal(exceedsGeminiTileLimit(640, 360), false, "640×360 fits one tile");
  assert.equal(exceedsGeminiTileLimit(768, 768), false, "768×768 is one tile");
  assert.equal(exceedsGeminiTileLimit(800, 600), true, "800px width triggers downscale");
  assert.equal(exceedsGeminiTileLimit(640, 900), true, "tall frame triggers downscale");
}

// Minimal valid 1×1 JPEG (SOF0 marker with width/height).
function minimalJpeg(width: number, height: number): Buffer {
  const buf = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

function testReadJpegDimensions() {
  const dims = readJpegDimensions(minimalJpeg(640, 360));
  assert.ok(dims);
  assert.equal(dims!.width, 640);
  assert.equal(dims!.height, 360);
}

testTileLimit();
testReadJpegDimensions();
console.log("test-frame-image: ok");
