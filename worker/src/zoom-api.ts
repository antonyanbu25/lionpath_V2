// Zoom cloud recording fetch via Server-to-Server OAuth.
//
// Why this exists: `zoomShare.ts` scrapes the public share link, but accounts with
// "require passcode + recaptcha" (Freshworks) answer `needRecaptcha: true` on the first
// share-info call, before any passcode attempt. No passcode can unlock that path. The
// account-level API has no such gate.
//
// Media: returns signed download URLs plus the Authorization header Pass 2 must send.
// Nothing is downloaded here — Workers cannot hold multi-hundred-MB recordings.

import { zoomApiConfigured, type ZoomEnv } from "./zoom";
import type { ZoomMediaStreamKind, ZoomShareMedia, ZoomShareResult } from "./zoomShare";

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const TOKEN_URL = "https://zoom.us/oauth/token";
/** Meetings started within this many ms of the share link's startTime are the same call. */
const START_TIME_TOLERANCE_MS = 5 * 60 * 1000;
const SEARCH_WINDOW_DAYS = 1;
/**
 * No call into the Zoom API had a timeout before this (astra-audit F-027/E-099)
 * -- a hung socket meant the whole /api/postcall/resolve request hung with it.
 * Matches the order of magnitude already used for the sibling Kaia fetch
 * (worker/src/kaia/fetchShareContent.ts: FETCH_TIMEOUT_MS = 25_000).
 */
const ZOOM_API_HTTP_TIMEOUT_MS = 20_000;

/** fetchImpl wrapped with a hard timeout -- every Zoom API call goes through this now. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {},
  timeoutMs: number = ZOOM_API_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw apiError(`Zoom API request timed out after ${timeoutMs / 1000}s.`, { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface ZoomApiError extends Error {
  status?: number;
  /** Set when the caller should fall back to the share-link scrape. */
  fallback?: boolean;
  /**
   * Set when a TRANSCRIPT/CC file exists on the matched recording but Zoom has
   * not finished processing it yet -- a transient state, not "this recording
   * will never have a transcript" (astra-audit F-026/E-107). `fallback` is
   * deliberately left unset here too: a real API answer, even a pending one,
   * must not silently fall through to the share-link scrape.
   */
  pending?: boolean;
  /** Zoom's own recorded start time for the matched meeting, when known. */
  meetingStartTime?: string;
}

function apiError(
  message: string,
  opts: { status?: number; fallback?: boolean; pending?: boolean; meetingStartTime?: string } = {},
) {
  return Object.assign(new Error(message), opts) as ZoomApiError;
}

let cachedToken: { token: string; expiresAtMs: number; key: string } | null = null;
let refreshPromise: Promise<string> | null = null;

function basicAuth(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  if (typeof btoa === "function") return btoa(raw);
  return Buffer.from(raw, "utf8").toString("base64");
}

/** Account-credentials grant. Token is cached in memory until 60s before expiry. */
export async function getZoomApiToken(
  env: ZoomEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!zoomApiConfigured(env)) {
    throw apiError("Zoom API is not configured on the server.", { fallback: true });
  }
  const key = `${env.ZOOM_ACCOUNT_ID}:${env.ZOOM_CLIENT_ID}`;
  const now = Date.now();
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAtMs > now) {
    return cachedToken.token;
  }
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const url = `${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_ACCOUNT_ID!)}`;
      const res = await fetchWithTimeout(fetchImpl, url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth(env.ZOOM_CLIENT_ID!, env.ZOOM_CLIENT_SECRET!)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const body = await res.text();
      if (!res.ok) {
        throw apiError(
          `Zoom OAuth token failed (${res.status}). Check ZOOM_ACCOUNT_ID / client credentials. ${body.slice(0, 200)}`,
          { status: 502 },
        );
      }
      let parsed: { access_token?: string; expires_in?: number };
      try {
        parsed = JSON.parse(body) as { access_token?: string; expires_in?: number };
      } catch {
        throw apiError("Zoom OAuth token response was not JSON.", { status: 502 });
      }
      if (!parsed.access_token) {
        throw apiError("Zoom OAuth token response had no access_token.", { status: 502 });
      }
      const ttlMs = Math.max(60, parsed.expires_in ?? 3600) * 1000;
      cachedToken = { token: parsed.access_token, expiresAtMs: Date.now() + ttlMs - 60_000, key };
      return parsed.access_token;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Test seam — clears the module-level token cache. */
export function resetZoomApiTokenCache(): void {
  cachedToken = null;
  refreshPromise = null;
}

export interface ZoomRecordingFile {
  id?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  recording_type?: string;
  download_url?: string;
  play_url?: string;
  status?: string;
}

export interface ZoomRecordingMeeting {
  uuid?: string;
  id?: number | string;
  topic?: string;
  start_time?: string;
  duration?: number;
  host_email?: string;
  recording_files?: ZoomRecordingFile[];
}

/**
 * Zoom share links carry the recording's start time as an epoch-ms query param.
 * It is the only field in a share URL that maps onto anything the API exposes.
 */
export function extractShareStartTimeMs(recordingUrl: string): number | undefined {
  let url: URL;
  try {
    url = new URL(recordingUrl);
  } catch {
    return undefined;
  }
  const raw = url.searchParams.get("startTime") || url.searchParams.get("startime");
  if (!raw) return undefined;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return ms;
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function zoomApiGet<T>(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchWithTimeout(fetchImpl, `${ZOOM_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " Add the cloud_recording read scopes to the Server-to-Server app and re-activate it."
        : "";
    throw apiError(`Zoom API ${res.status} on ${path}.${hint} ${body.slice(0, 200)}`, {
      status: 502,
    });
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw apiError(`Zoom API returned non-JSON on ${path}.`, { status: 502 });
  }
}

/**
 * Find the account recording whose start time matches the share link.
 * Searches a one-day window either side to absorb timezone/rounding drift.
 */
export async function findRecordingByStartTime(
  token: string,
  startTimeMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ZoomRecordingMeeting | undefined> {
  const windowMs = SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const from = utcDate(startTimeMs - windowMs);
  const to = utcDate(startTimeMs + windowMs);
  let nextPageToken = "";
  let best: { meeting: ZoomRecordingMeeting; deltaMs: number } | undefined;

  for (let page = 0; page < 10; page += 1) {
    const qs = new URLSearchParams({ from, to, page_size: "300" });
    if (nextPageToken) qs.set("next_page_token", nextPageToken);
    const data = await zoomApiGet<{
      meetings?: ZoomRecordingMeeting[];
      next_page_token?: string;
    }>(`/accounts/me/recordings?${qs}`, token, fetchImpl);

    for (const meeting of data.meetings || []) {
      if (!meeting.start_time) continue;
      const deltaMs = Math.abs(Date.parse(meeting.start_time) - startTimeMs);
      if (!Number.isFinite(deltaMs) || deltaMs > START_TIME_TOLERANCE_MS) continue;
      if (!best || deltaMs < best.deltaMs) best = { meeting, deltaMs };
    }

    nextPageToken = data.next_page_token || "";
    if (!nextPageToken) break;
  }

  return best?.meeting;
}

/** ±this many days around the anchor date when matching by topic instead of start_time. */
const TOPIC_MATCH_WINDOW_DAYS = 3;

/**
 * Fallback match when the share link carries no `?startTime=` (astra-audit F-026/E-104):
 * the share id itself is never sent to Zoom, so without a start time there was previously
 * no way to resolve the recording via the API at all, and the caller had to give up and
 * ask for a pasted transcript. Match on topic instead, anchored to the meeting date when
 * known (falls back to "now", since resolve almost always runs shortly after the call).
 * Topic is a weaker signal than start_time (recordings can legitimately share a topic
 * across calls with the same customer), so this only runs when extractShareStartTimeMs
 * found nothing -- an exact `?startTime=` match always takes priority.
 */
export async function findRecordingByTopic(
  token: string,
  topic: string,
  anchorMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ZoomRecordingMeeting | undefined> {
  const normalizedTopic = topic.trim().toLowerCase();
  if (!normalizedTopic) return undefined;
  const windowMs = TOPIC_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const from = utcDate(anchorMs - windowMs);
  const to = utcDate(anchorMs);
  let nextPageToken = "";
  let best: { meeting: ZoomRecordingMeeting; deltaMs: number } | undefined;

  for (let page = 0; page < 10; page += 1) {
    const qs = new URLSearchParams({ from, to, page_size: "300" });
    if (nextPageToken) qs.set("next_page_token", nextPageToken);
    const data = await zoomApiGet<{
      meetings?: ZoomRecordingMeeting[];
      next_page_token?: string;
    }>(`/accounts/me/recordings?${qs}`, token, fetchImpl);

    for (const meeting of data.meetings || []) {
      if ((meeting.topic || "").trim().toLowerCase() !== normalizedTopic) continue;
      const startMs = meeting.start_time ? Date.parse(meeting.start_time) : NaN;
      const deltaMs = Number.isFinite(startMs) ? Math.abs(startMs - anchorMs) : Number.MAX_SAFE_INTEGER;
      if (!best || deltaMs < best.deltaMs) best = { meeting, deltaMs };
    }

    nextPageToken = data.next_page_token || "";
    if (!nextPageToken) break;
  }

  return best?.meeting;
}

const MP4_KIND_BY_RECORDING_TYPE: Record<string, ZoomMediaStreamKind> = {
  shared_screen_with_speaker_view: "view_with_share",
  shared_screen_with_speaker_view_cc: "view_with_share",
  shared_screen_with_gallery_view: "view_with_share",
  active_speaker: "view",
  gallery_view: "view",
  speaker_view: "view",
  shared_screen: "share",
};

function completedFiles(meeting: ZoomRecordingMeeting): ZoomRecordingFile[] {
  return (meeting.recording_files || []).filter(
    (f) => !!f.download_url && (f.status ?? "completed") === "completed",
  );
}

/** Video streams for Pass 2, best composite first. */
export function mediaFromRecording(
  meeting: ZoomRecordingMeeting,
  token: string,
): ZoomShareMedia | undefined {
  const files = completedFiles(meeting);
  const streams: ZoomShareMedia["streams"] = [];
  let fileSizeMb: number | undefined;

  for (const file of files) {
    if ((file.file_type || "").toUpperCase() !== "MP4") continue;
    const kind = MP4_KIND_BY_RECORDING_TYPE[(file.recording_type || "").toLowerCase()] || "view";
    if (streams.some((s) => s.kind === kind)) continue;
    streams.push({ kind, url: file.download_url! });
    if (file.file_size && !fileSizeMb) fileSizeMb = Math.round(file.file_size / (1024 * 1024));
  }
  if (!streams.length) return undefined;

  const order: ZoomMediaStreamKind[] = ["view_with_share", "view", "share"];
  streams.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return {
    durationSec: meeting.duration ? meeting.duration * 60 : undefined,
    fileSizeMb,
    referer: "https://zoom.us/",
    streams,
    preferredKind: streams[0].kind,
    authHeader: `Bearer ${token}`,
  };
}

async function downloadText(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    30_000, // transcript download -- more headroom than a plain JSON API call
  );
  if (!res.ok) {
    throw apiError(`Could not download Zoom transcript (${res.status}).`, { status: 502 });
  }
  return res.text();
}

export interface ZoomApiFetchResult extends ZoomShareResult {
  startTime?: string;
  hostEmail?: string;
}

/**
 * Resolve a Zoom share/play link to transcript + media through the account API.
 *
 * Throws with `fallback: true` when the API cannot be used for this link — the caller
 * should then try the share-link scrape rather than failing the whole resolve.
 */
export interface FetchZoomRecordingViaApiOpts {
  /** Meeting/call title -- used only when the link carries no `?startTime=`. */
  meetingTitle?: string;
  /** Anchor date for the topic-match window (see findRecordingByTopic). Defaults to now. */
  meetingDateMs?: number;
}

export async function fetchZoomRecordingViaApi(
  env: ZoomEnv,
  recordingUrl: string,
  fetchImpl: typeof fetch = fetch,
  opts: FetchZoomRecordingViaApiOpts = {},
): Promise<ZoomApiFetchResult> {
  if (!zoomApiConfigured(env)) {
    throw apiError("Zoom API is not configured on the server.", { fallback: true });
  }
  const startTimeMs = extractShareStartTimeMs(recordingUrl);
  const topicFallbackAvailable = !startTimeMs && !!opts.meetingTitle?.trim();
  if (!startTimeMs && !topicFallbackAvailable) {
    throw apiError(
      "This Zoom link has no startTime, so it cannot be matched to a cloud recording. " +
        "Copy the link from the recording detail page in Zoom (it includes ?startTime=), " +
        "or paste the transcript.",
      { fallback: true },
    );
  }

  const token = await getZoomApiToken(env, fetchImpl);
  const meeting = startTimeMs
    ? await findRecordingByStartTime(token, startTimeMs, fetchImpl)
    : await findRecordingByTopic(token, opts.meetingTitle!, opts.meetingDateMs ?? Date.now(), fetchImpl);
  if (!meeting) {
    throw apiError(
      startTimeMs
        ? "No cloud recording on this Zoom account matches that link's start time. " +
          "The recording may belong to another account, or may have been deleted."
        : "No cloud recording on this Zoom account matches that meeting's topic. " +
          "The recording may belong to another account, may have been deleted, or the topic differs.",
      { status: 404, fallback: true },
    );
  }

  const files = completedFiles(meeting);
  const transcriptFile =
    files.find((f) => (f.file_type || "").toUpperCase() === "TRANSCRIPT") ||
    files.find((f) => (f.file_type || "").toUpperCase() === "CC");
  if (!transcriptFile?.download_url) {
    // A TRANSCRIPT/CC entry existing anywhere in the RAW (unfiltered) file list --
    // regardless of status -- means Zoom is still generating it, which is a
    // transient state, not "this recording will never have a transcript"
    // (astra-audit F-026/E-107, the most common failure this fixes). `fallback`
    // is deliberately left unset: a real API answer, even a pending one, must
    // not silently fall through to the share-link scrape.
    const stillProcessing = (meeting.recording_files || []).some((f) =>
      ["TRANSCRIPT", "CC"].includes((f.file_type || "").toUpperCase()),
    );
    if (stillProcessing) {
      throw apiError(
        "Zoom is still generating the transcript for this recording. This usually finishes " +
          "within a few minutes of the call ending.",
        { status: 202, pending: true, meetingStartTime: meeting.start_time },
      );
    }
    throw apiError(
      "That Zoom recording has no transcript. Turn on “Create audio transcript” in Zoom " +
        "cloud recording settings, or paste the transcript.",
      { status: 404 },
    );
  }

  const transcript = await downloadText(transcriptFile.download_url, token, fetchImpl);
  const media = mediaFromRecording(meeting, token);

  return {
    transcript,
    topic: meeting.topic,
    source: (transcriptFile.file_type || "").toUpperCase() === "CC" ? "cc" : "transcript",
    media,
    startTime: meeting.start_time,
    hostEmail: meeting.host_email,
  };
}
