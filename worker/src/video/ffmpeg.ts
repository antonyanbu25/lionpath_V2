/**
 * ffmpeg helpers for Pass 2 — Node only.
 * Streams from a signed Zoom URL with Referer; does not keep the full mp4.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_SAMPLE_INTERVAL_S, type SampleFrame } from "./facts";
import { ffmpegBinary, videoDataRoot } from "./capability";
import {
  computeStrategicSampleWindows,
  STRATEGIC_WINDOW_SAMPLE_INTERVAL_S,
} from "./sampling";

const execFileAsync = promisify(execFile);

export interface SampleJobInput {
  callId: string;
  mediaUrl: string;
  referer: string;
  /** Bearer header for Zoom API download URLs; absent for signed share-link streams. */
  authHeader?: string;
  durationSec?: number;
  sampleIntervalS?: number;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function jobDir(callId: string): string {
  const safe = callId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return path.join(videoDataRoot(), safe || "unknown");
}

/** Mean absolute difference between two JPEG buffers (coarse scene delta). */
export function jpegSceneDelta(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length, 48_000);
  if (n < 100) return 0;
  let sum = 0;
  // Sample every 17th byte to stay cheap
  for (let i = 0; i < n; i += 17) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / (n / 17);
}

/**
 * Extract one JPEG every `sampleIntervalS` seconds via ffmpeg HTTP input.
 * Returns sample metadata; frames land under /data/video/{callId}/frames/.
 */
export async function sampleFramesFromUrl(input: SampleJobInput): Promise<{
  samples: SampleFrame[];
  workDir: string;
  framesDir: string;
}> {
  const interval = input.sampleIntervalS ?? DEFAULT_SAMPLE_INTERVAL_S;
  const workDir = jobDir(input.callId);
  const framesDir = path.join(workDir, "frames");
  const stagingDir = path.join(workDir, "staging");
  await rm(framesDir, { recursive: true, force: true }).catch(() => {});
  await ensureDir(framesDir);
  await ensureDir(stagingDir);

  await writeFile(
    path.join(stagingDir, "note.txt"),
    `Pass 2 sample for ${input.callId}\n`,
  );

  const outPattern = path.join(framesDir, "frame_%05d.jpg");
  const fps = `1/${interval}`;
  const headerStr =
    `Referer: ${input.referer}\r\n` +
    `User-Agent: Mozilla/5.0 (compatible; LionpathPass2/1.0)\r\n` +
    (input.authHeader ? `Authorization: ${input.authHeader}\r\n` : "");

  // Cap wall samples — 45min @ 10s = 270; hard cap 360
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-headers",
    headerStr,
    "-i",
    input.mediaUrl,
    "-vf",
    `fps=${fps},scale=640:-2`,
    "-q:v",
    "5",
    "-frames:v",
    "360",
    outPattern,
  ];

  try {
    const bin = await ffmpegBinary();
    await execFileAsync(bin, args, {
      timeout: 15 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffmpeg sample failed: ${msg.slice(0, 400)}`);
  }

  const names = (await readdir(framesDir))
    .filter((n) => n.endsWith(".jpg"))
    .sort();

  const samples: SampleFrame[] = [];
  let prev: Buffer | null = null;
  for (let i = 0; i < names.length; i++) {
    const filePath = path.join(framesDir, names[i]);
    const buf = await readFile(filePath);
    const delta = prev ? jpegSceneDelta(prev, buf) : 0;
    prev = buf;
    samples.push({
      atS: i * interval,
      path: filePath,
      sceneDelta: Math.round(delta * 10) / 10,
    });
  }

  return { samples, workDir, framesDir };
}

/**
 * Extract JPEG frames only from strategic windows (opening 10%, 30/60/90%, closing 1min).
 * Much faster than scanning the entire recording at a fixed interval.
 */
export async function sampleStrategicWindowsFromUrl(input: SampleJobInput): Promise<{
  samples: SampleFrame[];
  workDir: string;
  framesDir: string;
}> {
  const durationSec = Math.max(60, Math.round(input.durationSec ?? 0));
  const interval = STRATEGIC_WINDOW_SAMPLE_INTERVAL_S;
  const windows = computeStrategicSampleWindows(durationSec);
  const workDir = jobDir(input.callId);
  const framesDir = path.join(workDir, "frames");
  const stagingDir = path.join(workDir, "staging");
  await rm(framesDir, { recursive: true, force: true }).catch(() => {});
  await ensureDir(framesDir);
  await ensureDir(stagingDir);

  await writeFile(
    path.join(stagingDir, "note.txt"),
    `Pass 2 strategic sample for ${input.callId}\n`,
  );

  const headerStr =
    `Referer: ${input.referer}\r\n` +
    `User-Agent: Mozilla/5.0 (compatible; LionpathPass2/1.0)\r\n` +
    (input.authHeader ? `Authorization: ${input.authHeader}\r\n` : "");

  const bin = await ffmpegBinary();
  const samples: SampleFrame[] = [];
  let prev: Buffer | null = null;

  for (const win of windows) {
    const clipDur = win.endS - win.startS;
    if (clipDur <= 0) continue;
    const outPattern = path.join(framesDir, `win_${win.label}_%05d.jpg`);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-headers",
      headerStr,
      "-ss",
      String(win.startS),
      "-t",
      String(clipDur),
      "-i",
      input.mediaUrl,
      "-vf",
      `fps=1/${interval},scale=640:-2`,
      "-q:v",
      "5",
      outPattern,
    ];

    try {
      await execFileAsync(bin, args, {
        timeout: 3 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ffmpeg strategic sample failed (${win.label}): ${msg.slice(0, 300)}`);
    }

    const names = (await readdir(framesDir))
      .filter((n) => n.startsWith(`win_${win.label}_`) && n.endsWith(".jpg"))
      .sort();

    for (let i = 0; i < names.length; i++) {
      const filePath = path.join(framesDir, names[i]);
      const buf = await readFile(filePath);
      const delta = prev ? jpegSceneDelta(prev, buf) : 0;
      prev = buf;
      const atS = win.startS + i * interval;
      samples.push({
        atS,
        path: filePath,
        sceneDelta: Math.round(delta * 10) / 10,
        windowLabel: win.label,
      });
    }
  }

  if (!samples.length) {
    throw new Error("ffmpeg strategic sample produced no frames");
  }

  return { samples, workDir, framesDir };
}

export async function cleanupStaging(callId: string): Promise<void> {
  const staging = path.join(jobDir(callId), "staging");
  await rm(staging, { recursive: true, force: true }).catch(() => {});
}

/** Stable hash for tests / cache keys — not used for security. */
export function mediaUrlFingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}
