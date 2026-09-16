/**
 * Pass 2 capability — ffmpeg frame sampling (VPS) or Gemini transcript inference (any runtime).
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { ProviderEnv } from "../providers/types";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

type VideoPassEnv = { VIDEO_PASS_ENABLED?: string };

let cachedBin: string | null | undefined;
let cachedOk: boolean | null = null;

export function videoPassEnvEnabled(env?: { VIDEO_PASS_ENABLED?: string }): boolean {
  const raw = (env?.VIDEO_PASS_ENABLED ?? process.env.VIDEO_PASS_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function geminiKey(env?: ProviderEnv): string | undefined {
  return env?.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
}

async function resolveFfmpegBinary(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin;
  if (process.env.FFMPEG_PATH?.trim()) {
    cachedBin = process.env.FFMPEG_PATH.trim();
    return cachedBin;
  }
  try {
    const fromPkg = require("ffmpeg-static") as string | null;
    if (fromPkg) {
      await access(fromPkg);
      cachedBin = fromPkg;
      return cachedBin;
    }
  } catch {
    // not installed
  }
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

export async function videoPassReady(env?: VideoPassEnv & ProviderEnv): Promise<{
  ready: boolean;
  mode?: "ffmpeg" | "gemini";
  reason?: string;
}> {
  if (!videoPassEnvEnabled(env)) {
    return { ready: false, reason: "VIDEO_PASS_ENABLED is off" };
  }
  // VPS Node + ffmpeg must win over GEMINI_API_KEY so visual consent uses frame sampling.
  if (isNodeRuntime() && (await ffmpegAvailable())) {
    return { ready: true, mode: "ffmpeg" };
  }
  if (geminiKey(env)) {
    return { ready: true, mode: "gemini" };
  }
  if (!isNodeRuntime()) {
    return {
      ready: false,
      reason: "Pass 2 needs GEMINI_API_KEY (transcript inference) or VPS Node with ffmpeg",
    };
  }
  return {
    ready: false,
    reason: "Pass 2 needs GEMINI_API_KEY or ffmpeg on PATH",
  };
}

export function videoDataRoot(): string {
  return (process.env.VIDEO_DATA_DIR || "/data/video").trim() || "/data/video";
}
