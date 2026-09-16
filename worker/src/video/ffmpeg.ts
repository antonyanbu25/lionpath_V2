/**
 * ffmpeg helpers for Pass 2 — Node only.
 * Streams from a signed Zoom URL with Referer; does not keep the full mp4.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_SAMPLE_INTERVAL_S, type SampleFrame } from "./facts";
import { ffmpegBinary, videoDataRoot } from "./capability";
import { withFfmpegSlot } from "./ffmpeg-semaphore";
import {
  computeStrategicSampleWindows,
  STRATEGIC_WINDOW_SAMPLE_INTERVAL_S,
} from "./sampling";
import { ZOOM_HTTP_USER_AGENT } from "../zoomShare";

const execFileAsync = promisify(execFile);

export interface FfmpegHttpHeaderInput {
  referer: string;
  authHeader?: string;
  cookieHeader?: string;
  userAgent?: string;
}

/** Build ffmpeg `-headers` value — CRLF-separated HTTP headers for Zoom CDN. */
export function buildFfmpegHttpHeaders(input: FfmpegHttpHeaderInput): string {
  const ua = input.userAgent?.trim() || ZOOM_HTTP_USER_AGENT;
  let headers = `Referer: ${input.referer}\r\nUser-Agent: ${ua}\r\n`;
  if (input.authHeader?.trim()) {
    headers += `Authorization: ${input.authHeader.trim()}\r\n`;
  }
  if (input.cookieHeader?.trim()) {
    headers += `Cookie: ${input.cookieHeader.trim()}\r\n`;
  }
  return headers;
}

/** Include stderr tail from execFile failures — Node omits it from err.message. */
export function formatExecFileError(err: unknown, label = "ffmpeg"): string {
  if (!(err instanceof Error)) return `${label} failed: ${String(err)}`;
  const e = err as Error & { stderr?: string | Buffer };
  const stderr = e.stderr ? String(e.stderr).trim() : "";
  const tail = stderr ? stderr.slice(-600) : "";
  const base = e.message || `${label} failed`;
  if (tail && !base.includes(tail.slice(-80))) {
    return `${label} failed: ${base} | stderr: ${tail}`;
  }
  return `${label} failed: ${base}`;
}

export interface SampleJobInput {
  callId: string;
  /** Per-invocation suffix — isolates concurrent jobs for the same callId. */
  jobSuffix?: string;
  mediaUrl: string;
  referer: string;
  /** Bearer header for Zoom API download URLs; absent for signed share-link streams. */
  authHeader?: string;
  /** Session cookies from Zoom passcode unlock — required on Freshworks Zoom CDN. */
  cookieHeader?: string;
  durationSec?: number;
  sampleIntervalS?: number;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

/** Unique suffix for one Pass 2 ffmpeg job directory. */
export function createJobSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function jobDir(callId: string, jobSuffix: string): string {
  const safe = callId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const suffix = jobSuffix.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
  return path.join(videoDataRoot(), `${safe || "unknown"}__${suffix}`);
}

/** Resolve the on-disk work directory for a call + job suffix (tests / sweep). */
export function resolveJobDir(callId: string, jobSuffix: string): string {
  return jobDir(callId, jobSuffix);
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

async function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<void> {
  await withFfmpegSlot(() =>
    execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    }),
  );
}

/**
 * Extract one JPEG every `sampleIntervalS` seconds via ffmpeg HTTP input.
 * Returns sample metadata; frames land under /data/video/{callId}__{suffix}/frames/.
 */
export async function sampleFramesFromUrl(input: SampleJobInput): Promise<{
  samples: SampleFrame[];
  workDir: string;
  framesDir: string;
  jobSuffix: string;
}> {
  const interval = input.sampleIntervalS ?? DEFAULT_SAMPLE_INTERVAL_S;
  const jobSuffix = input.jobSuffix?.trim() || createJobSuffix();
  const workDir = jobDir(input.callId, jobSuffix);
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
  const headerStr = buildFfmpegHttpHeaders({
    referer: input.referer,
    authHeader: input.authHeader,
    cookieHeader: input.cookieHeader,
  });

  // Cap wall samples — 45min @ 10s = 270; hard cap 360
  // Cap linear fallback — full 45min scans timeout on Zoom HTTP inputs.
  const capSec = Math.min(90, Math.max(30, Math.round(input.durationSec ?? 90)));
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-headers",
    headerStr,
    "-i",
    input.mediaUrl,
    "-t",
    String(capSec),
    "-vf",
    // 640px wide keeps frames under Gemini's 768px tiling threshold (1 tile/frame).
    `fps=${fps},scale=640:-2`,
    "-q:v",
    "5",
    "-frames:v",
    "360",
    outPattern,
  ];

  try {
    const bin = await ffmpegBinary();
    await runFfmpeg(bin, args, 15 * 60 * 1000);
  } catch (err) {
    throw new Error(formatExecFileError(err, "ffmpeg sample"));
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

  return { samples, workDir, framesDir, jobSuffix };
}

/**
 * Extract JPEG frames only from strategic windows (opening 10%, 30/60/90%, closing 1min).
 * Much faster than scanning the entire recording at a fixed interval.
 */
export async function sampleStrategicWindowsFromUrl(input: SampleJobInput): Promise<{
  samples: SampleFrame[];
  workDir: string;
  framesDir: string;
  jobSuffix: string;
}> {
  const durationSec = Math.max(60, Math.round(input.durationSec ?? 0));
  const interval = STRATEGIC_WINDOW_SAMPLE_INTERVAL_S;
  const windows = computeStrategicSampleWindows(durationSec);
  const jobSuffix = input.jobSuffix?.trim() || createJobSuffix();
  const workDir = jobDir(input.callId, jobSuffix);
  const framesDir = path.join(workDir, "frames");
  const stagingDir = path.join(workDir, "staging");
  await rm(framesDir, { recursive: true, force: true }).catch(() => {});
  await ensureDir(framesDir);
  await ensureDir(stagingDir);

  await writeFile(
    path.join(stagingDir, "note.txt"),
    `Pass 2 strategic sample for ${input.callId}\n`,
  );

  const headerStr = buildFfmpegHttpHeaders({
    referer: input.referer,
    authHeader: input.authHeader,
    cookieHeader: input.cookieHeader,
  });

  const bin = await ffmpegBinary();
  const samples: SampleFrame[] = [];
  let prev: Buffer | null = null;

  async function extractWindowFrames(
    win: { startS: number; endS: number; label: string },
    interval: number,
  ): Promise<SampleFrame[]> {
    const clipDur = win.endS - win.startS;
    if (clipDur <= 0) return [];
    const outPattern = path.join(framesDir, `win_${win.label}_%05d.jpg`);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-headers",
      headerStr,
      "-ss",
      String(win.startS),
      "-i",
      input.mediaUrl,
      "-t",
      String(clipDur),
      "-vf",
      // 640px wide — under Gemini 768px tile limit; see frame-image.ts for upload guard.
      `fps=1/${interval},scale=640:-2`,
      "-q:v",
      "5",
      outPattern,
    ];
    try {
      await runFfmpeg(bin, args, 5 * 60 * 1000);
    } catch (err) {
      console.warn(
        `[video/ffmpeg] window ${win.label} failed: ${formatExecFileError(err, "ffmpeg").slice(0, 400)}`,
      );
      return [];
    }
    const names = (await readdir(framesDir))
      .filter((n) => n.startsWith(`win_${win.label}_`) && n.endsWith(".jpg"))
      .sort();
    const out: SampleFrame[] = [];
    for (let i = 0; i < names.length; i++) {
      const filePath = path.join(framesDir, names[i]);
      const buf = await readFile(filePath);
      const delta = prev ? jpegSceneDelta(prev, buf) : 0;
      prev = buf;
      out.push({
        atS: win.startS + i * interval,
        path: filePath,
        sceneDelta: Math.round(delta * 10) / 10,
        windowLabel: win.label,
      });
    }
    return out;
  }

  for (const win of windows) {
    const winFrames = await extractWindowFrames(win, interval);
    samples.push(...winFrames);
  }

  if (!samples.length) {
    console.warn("[video/ffmpeg] strategic windows empty; trying opening 60s fallback");
    const openEnd = Math.min(60, durationSec);
    const opening = await extractWindowFrames(
      { startS: 0, endS: openEnd, label: "opening_fallback" },
      interval,
    );
    samples.push(...opening);
  }

  if (!samples.length) {
    console.warn("[video/ffmpeg] opening fallback empty; trying capped linear sample (90s max)");
    const capSec = Math.min(90, durationSec);
    const linear = { ...input, jobSuffix, durationSec: capSec, sampleIntervalS: interval };
    const linearOut = await sampleFramesFromUrl(linear);
    return linearOut;
  }

  return { samples, workDir, framesDir, jobSuffix };
}

/** Remove an entire Pass 2 job directory (frames + staging). */
export async function cleanupJobDir(workDir: string): Promise<void> {
  const trimmed = workDir?.trim();
  if (!trimmed) return;
  const root = path.resolve(videoDataRoot());
  const target = path.resolve(trimmed);
  if (target !== root && !target.startsWith(root + path.sep)) {
    console.warn("[video/ffmpeg] cleanupJobDir refused path outside video root:", workDir);
    return;
  }
  await rm(target, { recursive: true, force: true }).catch(() => {});
}

/** Stable hash for tests / cache keys — not used for security. */
export function mediaUrlFingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}
