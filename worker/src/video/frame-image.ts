/**
 * Vision frame sizing — Gemini bills images in 768×768 tiles.
 * ffmpeg samples at 640px wide; this module downscales before upload when needed.
 */

import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ffmpegBinary } from "./capability";

const execFileAsync = promisify(execFile);

/** Max width/height before Gemini splits an image into multiple billed tiles. */
export const GEMINI_TILE_MAX_PX = 768;

export function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9) break;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) break;
    i += 2 + segLen;
  }
  return null;
}

export function exceedsGeminiTileLimit(
  width: number,
  height: number,
  max = GEMINI_TILE_MAX_PX,
): boolean {
  return Math.max(width, height) > max;
}

/** Read a JPEG; downscale via ffmpeg when either dimension exceeds the tile limit. */
export async function prepareVisionFrameBytes(filePath: string): Promise<Buffer> {
  const bytes = await readFile(filePath);
  const dims = readJpegDimensions(bytes);
  if (!dims || !exceedsGeminiTileLimit(dims.width, dims.height)) return bytes;

  const bin = await ffmpegBinary();
  const outPath = path.join(
    tmpdir(),
    `vision_frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
  );
  try {
    await execFileAsync(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        filePath,
        "-vf",
        `scale='min(${GEMINI_TILE_MAX_PX},iw)':'min(${GEMINI_TILE_MAX_PX},ih)':force_original_aspect_ratio=decrease`,
        "-q:v",
        "5",
        "-frames:v",
        "1",
        outPath,
      ],
      { timeout: 30_000 },
    );
    return await readFile(outPath);
  } finally {
    await rm(outPath, { force: true }).catch(() => {});
  }
}
