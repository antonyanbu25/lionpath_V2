// Fetch VTT transcript (+ media stream URLs) from a Zoom cloud recording share/play
// link + passcode. Uses Zoom NWS APIs (validate-meeting-passwd) — no OAuth app required.
//
// Media: resolves signed mp4 URLs from the same play/info payload as the VTT.
// Does NOT download video — Workers cannot hold multi-hundred-MB recordings.
// Pass 2 (frame sampling) must stream those URLs from a runtime with ffmpeg.

const SHARE_URL_RE =
  /^https?:\/\/(?:(?<subdomain>[a-z][a-z0-9-]*)\.)?(?<host>zoom\.us|zoomgov\.com)\/rec(?:ording)?\/(?<type>share|play)\/(?<id>[\w.-]+)/i;

export const ZOOM_HTTP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const USER_AGENT = ZOOM_HTTP_USER_AGENT;

/** Prefer composite (camera+share) for Pass 2; fall back to camera, then share-only. */
export type ZoomMediaStreamKind = "view_with_share" | "view" | "share";

export interface ZoomMediaStream {
  kind: ZoomMediaStreamKind;
  url: string;
}

export interface ZoomShareMedia {
  durationSec?: number;
  /** Host policy flag from play/info — streaming URLs may still work when true. */
  disableDownload?: boolean;
  fileSizeMb?: number;
  /** Clip count when Zoom splits a long recording (Pass 2 may need per-clip resolve). */
  totalClips?: number;
  /** Referer required when fetching stream URLs from Zoom CDN. */
  referer: string;
  /** Authorization header for API-sourced download URLs (Server-to-Server OAuth). */
  authHeader?: string;
  /** Session cookies from passcode unlock — required for Freshworks Zoom CDN via ffmpeg. */
  cookieHeader?: string;
  streams: ZoomMediaStream[];
  /** Best stream for Pass 2 when present. */
  preferredKind?: ZoomMediaStreamKind;
}

export interface ZoomShareResult {
  transcript: string;
  topic?: string;
  source: "transcript" | "cc" | "chapter";
  /** Signed mp4 stream descriptors — absent when Zoom exposes no playable media. */
  media?: ZoomShareMedia;
}

interface ParsedShareUrl {
  baseUrl: string;
  origin: string;
  type: "share" | "play";
  /** Share/play id for NWS APIs — embedded passcode suffix stripped when present. */
  id: string;
  /** Full path id as it appeared in the URL (may include `.embedToken`). */
  rawId: string;
  /** Passcode from `?pwd=` or Zoom's embed-in-link suffix after the final `.`. */
  embeddedPasscode?: string;
  url: URL;
}

interface ShareInfoResult {
  componentName?: string;
  meetingId?: string;
  fileId?: string | null;
  redirectUrl?: string;
  hasValidToken?: boolean;
  needRecaptcha?: boolean;
  useWhichPasswd?: string;
  requestFrom?: string;
}

/** Subset of Zoom NWS play/info — transcript + media fields used by yt-dlp / web player. */
export interface PlayInfoResult {
  componentName?: string;
  meetingId?: string;
  transcriptUrl?: string;
  ccUrl?: string;
  chapterUrl?: string;
  hasTranscript?: boolean;
  meet?: { topic?: string };
  duration?: number;
  disableDownload?: boolean;
  totalClips?: number;
  numOfClipFile?: number;
  viewMp4Url?: string;
  shareMp4Url?: string;
  viewMp4WithshareUrl?: string;
  recording?: { fileSizeInMB?: string | number };
}

/**
 * Zoom "embed passcode in shareable link" appends a token after the final
 * `.` in `/rec/share/{id}.{token}`. That token must stay IN the share id path.
 * It is NOT the meeting email passcode — posting it to validate-meeting-passwd
 * often returns captcha_error on Freshworks Zoom.
 *
 * Explicit unlock secrets (use for validate / ?pwd=):
 * - `?pwd=` query param (API recording_play_passcode)
 * - `passcode: …` pasted on the same line
 * - Passcode form field (Zoom email passcode)
 */
export function extractZoomEmbeddedPasscode(
  shareId: string,
  url: URL,
): { id: string; rawId: string; queryPwd?: string; pathToken?: string } {
  const fromQuery = url.searchParams.get("pwd")?.trim() || undefined;
  const lastDot = shareId.lastIndexOf(".");
  let pathToken: string | undefined;
  let id = shareId;
  if (lastDot > 0) {
    const base = shareId.slice(0, lastDot);
    const suffix = shareId.slice(lastDot + 1);
    if (base.length >= 16 && /^[\w-]{6,128}$/.test(suffix)) {
      // Keep calling APIs with the FULL raw id; only note the path token.
      pathToken = suffix;
      id = shareId; // never strip for share-info — stripping causes SSO / not-found
    }
  }
  return { id, rawId: shareId, queryPwd: fromQuery, pathToken };
}

function parseShareUrl(input: string): ParsedShareUrl {
  const trimmed = input.trim().split(/\s/)[0];
  const m = trimmed.match(SHARE_URL_RE);
  if (!m?.groups?.id) {
    throw new Error(
      "Invalid Zoom recording link. Paste a share or play URL like https://zoom.us/rec/share/… or …/rec/play/…",
    );
  }
  const url = new URL(trimmed);
  const host = m.groups.host || "zoom.us";
  const subdomain = m.groups.subdomain;
  const origin = subdomain ? `https://${subdomain}.${host}` : `https://${host}`;
  const rawId = m.groups.id;
  const extracted = extractZoomEmbeddedPasscode(rawId, url);
  return {
    baseUrl: `${origin}/`,
    origin,
    type: (m.groups.type as "share" | "play") || "share",
    id: extracted.rawId,
    rawId: extracted.rawId,
    // Only ?pwd= is a real unlock secret from the URL. Path .token is not.
    embeddedPasscode: extracted.queryPwd,
    url,
  };
}

class ZoomSession {
  cookie = "";

  constructor(
    readonly baseUrl: string,
    readonly origin: string,
  ) {}

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Referer: this.baseUrl,
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/html,*/*",
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...extra,
    };
  }

  /**
   * Merge Set-Cookie into the session jar. Must keep `_zm_page_auth` (set after
   * passcode validate) — dropping it makes Freshworks Zoom bounce play pages to
   * Microsoft SSO.
   */
  mergeFromResponse(res: Response) {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const rawList =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie")].filter(Boolean) as string[];
    if (!rawList.length) return;

    const jar = new Map<string, string>();
    for (const part of this.cookie.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k && v.length) jar.set(k, v.join("="));
    }
    for (const raw of rawList) {
      const nv = String(raw).split(";")[0]?.trim();
      if (!nv) continue;
      const eq = nv.indexOf("=");
      if (eq <= 0) continue;
      const name = nv.slice(0, eq).trim();
      const value = nv.slice(eq + 1).trim();
      // Expired clears (empty value) — drop from jar.
      if (!value) {
        jar.delete(name);
        continue;
      }
      jar.set(name, value);
    }
    this.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async fetchText(url: string, init?: RequestInit): Promise<string> {
    const res = await fetch(url, { ...init, headers: this.headers(init?.headers as Record<string, string>) });
    this.mergeFromResponse(res);
    if (!res.ok) throw new Error(`Zoom returned ${res.status} for ${new URL(url).pathname}`);
    const body = await res.text();
    assertZoomNotSsoHtml(body, res.url);
    return body;
  }

  async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: this.headers({
        Accept: "application/json",
        ...(init?.headers as Record<string, string>),
      }),
    });
    this.mergeFromResponse(res);
    const body = await res.text();
    if (!res.ok) {
      assertZoomNotSsoHtml(body, res.url);
      throw new Error(`Zoom API ${res.status}: ${body.slice(0, 200)}`);
    }
    try {
      return JSON.parse(body) as T;
    } catch {
      assertZoomNotSsoHtml(body, res.url);
      throw new Error(`Zoom returned non-JSON: ${body.slice(0, 120)}`);
    }
  }
}

/** Freshworks Zoom sometimes 302s anonymous NWS calls into Microsoft SSO HTML. */
function assertZoomNotSsoHtml(body: string, finalUrl?: string): void {
  const html = String(body || "");
  const landedOnMs =
    /login\.microsoftonline\.com/i.test(String(finalUrl || "")) ||
    /Copyright \(C\) Microsoft Corporation/i.test(html) ||
    /<title>\s*Redirect/i.test(html) ||
    /AADSTS/i.test(html);
  if (!landedOnMs) return;
  throw new Error(
    "Zoom redirected to Microsoft sign-in after the passcode step. " +
      "Usually the unlock cookie was dropped — retry Analyze once. " +
      "If it keeps happening, confirm the Passcode is from the Zoom email (not the .token in the URL).",
  );
}

function extractField(html: string, field: string): string {
  const patterns = [
    new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`),
    new RegExp(`'${field}'\\s*:\\s*'([^']+)'`),
    new RegExp(`${field}\\s*:\\s*"([^"]+)"`),
    new RegExp(`${field}\\s*:\\s*'([^']+)'`),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return "";
}

function needsPassword(html: string, data?: ShareInfoResult | PlayInfoResult): boolean {
  return (
    data?.componentName === "need-password" ||
    /id=["']password_form["']/i.test(html) ||
    /type=["']password["']/i.test(html) ||
    /Enter the passcode/i.test(html)
  );
}

async function validatePasscode(
  session: ZoomSession,
  meetingId: string,
  passcode: string,
): Promise<void> {
  const endpoints = [
    `${session.baseUrl}nws/recording/1.0/validate-meeting-passwd`,
    `${session.baseUrl}nws/recording/1.0/validate-passwd-passwd`,
  ];
  let lastError = "Wrong recording passcode.";

  for (const endpoint of endpoints) {
    try {
      const result = await session.fetchJson<{
        status?: boolean;
        errorMessage?: string;
        result?: unknown;
      }>(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          id: meetingId,
          passwd: passcode,
          action: "viewdetailpage",
        }),
      });
      // Zoom returns status:true with result:"captcha_error" when reCAPTCHA is required.
      // Treating that as success left us on /rec/component-page with no fileId.
      const captcha =
        result.result === "captcha_error" ||
        result.result === "recaptcha_error" ||
        /captcha/i.test(String(result.errorMessage || ""));
      if (captcha) {
        // Accounts with recaptcha enforced return this on the first attempt too, so a
        // correct passcode cannot get past it. Only the account API can read these.
        throw new Error(
          "Zoom requires a reCAPTCHA to unlock this share link, which a server cannot solve. " +
            "Configure Zoom Server-to-Server OAuth (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / " +
            "ZOOM_CLIENT_SECRET) to read this recording directly, or paste the transcript.",
        );
      }
      if (result.status) return;
      lastError = result.errorMessage || lastError;
    } catch (e) {
      if (e instanceof Error && /CAPTCHA|captcha/i.test(e.message)) throw e;
      lastError = e instanceof Error ? e.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function getShareInfo(session: ZoomSession, id: string, query = ""): Promise<ShareInfoResult> {
  const data = await session.fetchJson<{ result?: ShareInfoResult | null }>(
    `${session.baseUrl}nws/recording/1.0/play/share-info/${id}${query}`,
  );
  if (!data.result) throw new Error("Recording not found. Check the link or passcode.");
  return data.result;
}

async function getPlayInfo(session: ZoomSession, fileId: string, playUrl: string): Promise<PlayInfoResult> {
  const u = new URL(`nws/recording/1.0/play/info/${fileId}`, session.baseUrl);
  const play = new URL(playUrl, session.baseUrl);
  const pwd = play.searchParams.get("pwd");
  if (pwd) u.searchParams.set("pwd", pwd);
  u.searchParams.set("canPlayFromShare", "true");
  u.searchParams.set("from", "share_recording_detail");
  u.searchParams.set("continueMode", "true");
  u.searchParams.set("componentName", "rec-play");
  u.searchParams.set("originDomain", session.origin);
  u.searchParams.set("originRequestUrl", playUrl);

  const data = await session.fetchJson<{ result?: PlayInfoResult }>(u.toString());
  if (!data.result) throw new Error("Zoom returned no recording metadata.");
  return data.result;
}

async function resolvePlayContext(
  parsed: ParsedShareUrl,
  passcode: string | undefined,
  session: ZoomSession,
): Promise<{ playUrl: string; fileId: string; html: string }> {
  // Meeting unlock secret: ONLY an explicit passcode (form / `passcode:` / `?pwd=`).
  // Never the `.token` path suffix — that triggers Freshworks Zoom captcha_error.
  const meetingPwd = passcode?.trim() || parsed.embeddedPasscode;

  // Always use the full share path id (including `.token` when present).
  let info = await getShareInfo(session, parsed.rawId || parsed.id);

  if (info.componentName === "need-password") {
    if (!meetingPwd) {
      throw new Error(
        "This recording is passcode-protected. Paste the passcode from the Zoom email " +
          "(Passcode field), or: <link> passcode: YOUR_CODE",
      );
    }
    const meetingId = info.meetingId;
    if (!meetingId) throw new Error("Could not resolve meeting ID for passcode validation.");
    await validatePasscode(session, meetingId, meetingPwd);
    // Prefer the share id again with unlock cookies; meetingId+accessLevel is the fallback.
    try {
      info = await getShareInfo(session, parsed.rawId || parsed.id);
    } catch {
      info = await getShareInfo(
        session,
        meetingId,
        `?originDomain=${encodeURIComponent(session.origin)}&accessLevel=meeting`,
      );
    }
    if (info.componentName === "need-password") {
      info = await getShareInfo(
        session,
        info.meetingId || "",
        `?originDomain=${encodeURIComponent(session.origin)}&accessLevel=meeting`,
      );
    }
  }

  if (!info.redirectUrl) throw new Error("Zoom did not return a play URL for this recording.");

  const playUrlObj = new URL(info.redirectUrl, session.baseUrl);
  if (meetingPwd && !playUrlObj.searchParams.has("pwd")) {
    playUrlObj.searchParams.set("pwd", meetingPwd);
  }
  playUrlObj.searchParams.set("continueMode", "true");
  const playUrl = playUrlObj.toString();

  let html = await session.fetchText(playUrl);
  if (needsPassword(html) && meetingPwd) {
    const meetingId =
      extractField(html, "meeting_id") || extractField(html, "meetingId") || info.meetingId || "";
    if (meetingId) {
      await validatePasscode(session, meetingId, meetingPwd);
      html = await session.fetchText(playUrl);
    }
  } else if (needsPassword(html)) {
    throw new Error(
      "This recording is passcode-protected. Paste the passcode from the Zoom email.",
    );
  }

  const fileId = extractField(html, "fileId") || info.fileId || "";
  if (!fileId) {
    throw new Error("Could not access this recording. Check the link and passcode.");
  }
  return { playUrl, fileId, html };
}

function pickTranscriptPath(data: PlayInfoResult): { path: string; source: ZoomShareResult["source"] } | null {
  if (data.transcriptUrl) return { path: data.transcriptUrl, source: "transcript" };
  if (data.ccUrl) return { path: data.ccUrl, source: "cc" };
  return null;
}

function absoluteZoomUrl(path: string, baseUrl: string): string {
  return path.startsWith("http") ? path : new URL(path, baseUrl).toString();
}

/**
 * Extract signed mp4 stream URLs from play/info (same payload as transcriptUrl).
 * Pure — safe to unit-test without hitting Zoom.
 */
export function pickMediaStreams(
  data: PlayInfoResult,
  referer: string,
  cookieHeader?: string,
): ZoomShareMedia | undefined {
  const streams: ZoomMediaStream[] = [];
  if (data.viewMp4WithshareUrl?.trim()) {
    streams.push({
      kind: "view_with_share",
      url: absoluteZoomUrl(data.viewMp4WithshareUrl.trim(), referer),
    });
  }
  if (data.viewMp4Url?.trim()) {
    streams.push({
      kind: "view",
      url: absoluteZoomUrl(data.viewMp4Url.trim(), referer),
    });
  }
  if (data.shareMp4Url?.trim()) {
    streams.push({
      kind: "share",
      url: absoluteZoomUrl(data.shareMp4Url.trim(), referer),
    });
  }
  if (!streams.length) return undefined;

  const preferredKind: ZoomMediaStreamKind | undefined =
    streams.find((s) => s.kind === "view_with_share")?.kind ??
    streams.find((s) => s.kind === "view")?.kind ??
    streams.find((s) => s.kind === "share")?.kind;

  const rawSize = data.recording?.fileSizeInMB;
  const fileSizeMb =
    rawSize == null || rawSize === ""
      ? undefined
      : Number(rawSize);
  const totalClips =
    typeof data.totalClips === "number"
      ? data.totalClips
      : typeof data.numOfClipFile === "number"
        ? data.numOfClipFile
        : undefined;

  return {
    durationSec: typeof data.duration === "number" ? data.duration : undefined,
    disableDownload: typeof data.disableDownload === "boolean" ? data.disableDownload : undefined,
    fileSizeMb: fileSizeMb != null && Number.isFinite(fileSizeMb) ? fileSizeMb : undefined,
    totalClips,
    referer,
    cookieHeader: cookieHeader?.trim() || undefined,
    streams,
    preferredKind,
  };
}

/** Prefer composite → camera → share for Pass 2 consumers. */
export function preferredMediaStream(media: ZoomShareMedia | undefined): ZoomMediaStream | undefined {
  if (!media?.streams.length) return undefined;
  const kind = media.preferredKind;
  if (kind) {
    const hit = media.streams.find((s) => s.kind === kind);
    if (hit) return hit;
  }
  return media.streams[0];
}

/** Chapter VTT only has "Recording/Sharing Started/Stopped" — not speech. */
function isChapterOnlyVtt(vtt: string): boolean {
  const lines = vtt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("WEBVTT") && !l.includes("-->") && !/^chapter-\d+$/i.test(l));
  if (!lines.length) return true;
  const chapterish = lines.every((l) =>
    /^(recording|sharing)\s+(started|stopped)$/i.test(l.replace(/\s+/g, " ")),
  );
  return chapterish;
}

export function parseRecordingPaste(input: string): { url: string; passcode?: string } {
  let text = input.trim();
  let passcode: string | undefined;
  const passMatch = text.match(/\s+passcode\s*:\s*(.+)$/i);
  if (passMatch) {
    passcode = passMatch[1].trim();
    text = text.slice(0, passMatch.index).trim();
  }
  // Only ?pwd= from the URL is an unlock secret — not the `.token` path suffix.
  try {
    const u = new URL(text.trim().split(/\s/)[0]);
    const q = u.searchParams.get("pwd")?.trim();
    if (!passcode && q) passcode = q;
  } catch {
    // not a URL
  }
  return { url: text, passcode };
}

export async function fetchTranscriptFromShareLink(
  recordingUrl: string,
  passcode?: string,
): Promise<ZoomShareResult> {
  const parsed = parseRecordingPaste(recordingUrl);
  const shareParsed = parseShareUrl(parsed.url);
  const pwd = passcode?.trim() || parsed.passcode || shareParsed.embeddedPasscode;
  const session = new ZoomSession(shareParsed.baseUrl, shareParsed.origin);

  const { playUrl, fileId, html } = await resolvePlayContext(shareParsed, pwd, session);

  let playData = await getPlayInfo(session, fileId, playUrl);

  if (playData.componentName === "need-password" || (!playData.transcriptUrl && !playData.ccUrl)) {
    const meetingId = playData.meetingId || extractField(html, "meetingId") || extractField(html, "meeting_id");
    if (meetingId && pwd) {
      await validatePasscode(session, meetingId, pwd);
      playData = await getPlayInfo(session, fileId, playUrl);
    }
  }

  const picked = pickTranscriptPath(playData);
  if (!picked) {
    if (playData.hasTranscript === false) {
      throw new Error(
        "Zoom did not expose a speech transcript for this recording — only chapter markers " +
          "(e.g. \"Recording Started\", \"Sharing Started\"). This is not usable for post-call analysis.\n\n" +
          "Fix in Zoom: enable **Audio transcript** under cloud recording settings, turn on " +
          "**Viewers can see transcript** on the share link, then re-process the recording. " +
          "Or download the Audio transcript (.vtt) from Zoom while logged in as host and ask your admin to allow transcript on shared links.",
      );
    }
    throw new Error(
      "No transcript file found on this recording. Ensure audio transcript is enabled and visible on shared links.",
    );
  }

  const vttUrl = picked.path.startsWith("http")
    ? picked.path
    : new URL(picked.path, session.baseUrl).toString();
  let transcript = await session.fetchText(vttUrl);
  if (!transcript.trim()) throw new Error("Downloaded transcript file was empty.");

  // Reject chapter-only VTT (no speaker dialogue)
  if (picked.source === "chapter" || isChapterOnlyVtt(transcript)) {
    throw new Error(
      "Zoom returned chapter markers only (\"Recording Started\", \"Sharing Started\") — not speech text. " +
        "Enable **Audio transcript** in Zoom cloud recording settings and **Viewers can see transcript** on the share link.",
    );
  }

  // Media URLs share the passcode session; soft-fail — transcript remains usable alone.
  // Use the play page as Referer and forward unlock cookies — Freshworks Zoom CDN rejects
  // ffmpeg requests that only send baseUrl Referer without _zm_page_auth cookies.
  const media = pickMediaStreams(playData, playUrl, session.cookie || undefined);

  return {
    transcript,
    topic: playData.meet?.topic,
    source: picked.source,
    media,
  };
}

/**
 * Same as fetchTranscriptFromShareLink — clearer name for Pass 0 (resolve recording).
 * Returns transcript + signed media stream URLs; does not download mp4 bytes.
 */
export async function fetchRecordingFromShareLink(
  recordingUrl: string,
  passcode?: string,
): Promise<ZoomShareResult> {
  return fetchTranscriptFromShareLink(recordingUrl, passcode);
}

export function isZoomRecordingUrl(input: string): boolean {
  return SHARE_URL_RE.test(input.trim());
}
