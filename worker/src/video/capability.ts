/**
 * Pass 2 requires a Node runtime with ffmpeg (VPS Docker apk, PATH, or ffmpeg-static).
 * Cloudflare Workers always report unavailable.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

let cachedBin: string | null | undefined;
let cachedOk: boolean | null = null;

export function videoPassEnvEnabled(env?: { VIDEO_PASS_ENABLED?: string }): boolean {
  const raw = (env?.VIDEO_PASS_ENABLED ?? process.env.VIDEO_PASS_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

async function resolveFfmpegBinary(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin;
  if (process.env.FFMPEG_PATH?.trim()) {
    cachedBin = process.env.FFMPEG_PATH.trim();
    return cachedBin;
  }
  try {
    // Optional local dep for mac/agent shells without system ffmpeg
    const fromPkg = require("ffmpeg-static") as string | null;
    if (fromPkg) {
      await access(fromPkg);
      cachedBin = fromPkg;
      return cachedBin;
    }
  } catch {
    // not installed
  }
  // Prefer PATH (VPS apk)
  cachedBin = "ffmpeg";
  return cachedBin;
}

/** Absolute path or `ffmpeg` for PATH lookup. */
export async function ffmpegBinary(): Promise<string> {
  return (await resolveFfmpegBinary()) || "ffmpeg";
}

export async function ffmpegAvailable(): Promise<boolean> {
  if (cachedOk != null) return cachedOk;
  if (!isNodeRuntime()) {
    cachedOk = false;
    return false;
  }
  try {
    const bin = await ffmpegBinary();
    await execFileAsync(bin, ["-version"], { timeout: 5_000 });
    cachedOk = true;
  } catch {
    cachedOk = false;
  }
  return cachedOk;
}

export async function videoPassReady(env?: { VIDEO_PASS_ENABLED?: string }): Promise<{
  ready: boolean;
  reason?: string;
}> {
  if (!videoPassEnvEnabled(env)) {
    return { ready: false, reason: "VIDEO_PASS_ENABLED is off" };
  }
  if (!isNodeRuntime()) {
    return { ready: false, reason: "Pass 2 requires Node/VPS with ffmpeg (not Cloudflare Workers)" };
  }
  if (!(await ffmpegAvailable())) {
    return { ready: false, reason: "ffmpeg not found on PATH" };
  }
  return { ready: true };
}

export function videoDataRoot(): string {
  return (process.env.VIDEO_DATA_DIR || "/data/video").trim() || "/data/video";
}
