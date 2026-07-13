// Fetch VTT transcript from a Zoom cloud recording share/play link + passcode.
// Uses Zoom NWS APIs (validate-meeting-passwd) — no OAuth app required.

const SHARE_URL_RE =
  /^https?:\/\/(?:(?<subdomain>[a-z][a-z0-9-]*)\.)?(?<host>zoom\.us|zoomgov\.com)\/rec(?:ording)?\/(?<type>share|play)\/(?<id>[\w.-]+)/i;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface ZoomShareResult {
  transcript: string;
  topic?: string;
  source: "transcript" | "cc" | "chapter";
}

interface ParsedShareUrl {
  baseUrl: string;
  origin: string;
  type: "share" | "play";
  id: string;
  url: URL;
}

interface ShareInfoResult {
  componentName?: string;
  meetingId?: string;
  fileId?: string | null;
  redirectUrl?: string;
  hasValidToken?: boolean;
}

interface PlayInfoResult {
  componentName?: string;
  meetingId?: string;
  transcriptUrl?: string;
  ccUrl?: string;
  chapterUrl?: string;
  hasTranscript?: boolean;
  meet?: { topic?: string };
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
  return {
    baseUrl: `${origin}/`,
    origin,
    type: (m.groups.type as "share" | "play") || "share",
    id: m.groups.id,
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

  merge(setCookie: string | null) {
    if (!setCookie) return;
    const found = setCookie.match(/(_zm_ssid|cred|_zm_ctaid|_zm_chtaid)=[^;]+/g) || [];
    if (!found.length) return;
    const jar = new Map<string, string>();
    for (const part of `${this.cookie}; ${found.join("; ")}`.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k && v.length) jar.set(k.trim(), v.join("=").trim());
    }
    this.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async fetchText(url: string, init?: RequestInit): Promise<string> {
    const res = await fetch(url, { ...init, headers: this.headers(init?.headers as Record<string, string>) });
    this.merge(res.headers.get("set-cookie"));
    if (!res.ok) throw new Error(`Zoom returned ${res.status} for ${new URL(url).pathname}`);
    return res.text();
  }

  async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, headers: this.headers(init?.headers as Record<string, string>) });
    this.merge(res.headers.get("set-cookie"));
    const body = await res.text();
    if (!res.ok) throw new Error(`Zoom API ${res.status}: ${body.slice(0, 200)}`);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`Zoom returned non-JSON: ${body.slice(0, 120)}`);
    }
  }
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
      const result = await session.fetchJson<{ status?: boolean; errorMessage?: string }>(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          id: meetingId,
          passwd: passcode,
          action: "viewdetailpage",
        }),
      });
      if (result.status) return;
      lastError = result.errorMessage || lastError;
    } catch (e) {
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
  let info = await getShareInfo(session, parsed.id);

  if (info.componentName === "need-password") {
    if (!passcode) throw new Error("This recording is passcode-protected. Paste the passcode from the Zoom email.");
    if (!info.meetingId) throw new Error("Could not resolve meeting ID for passcode validation.");
    await validatePasscode(session, info.meetingId, passcode);
    info = await getShareInfo(
      session,
      info.meetingId,
      `?originDomain=${encodeURIComponent(session.origin)}&accessLevel=meeting`,
    );
  }

  if (!info.redirectUrl) throw new Error("Zoom did not return a play URL for this recording.");

  const playUrlObj = new URL(info.redirectUrl, session.baseUrl);
  if (passcode && !playUrlObj.searchParams.has("pwd")) {
    playUrlObj.searchParams.set("pwd", passcode);
  }
  playUrlObj.searchParams.set("continueMode", "true");
  const playUrl = playUrlObj.toString();

  let html = await session.fetchText(playUrl);
  if (needsPassword(html) && passcode) {
    const meetingId =
      extractField(html, "meeting_id") || extractField(html, "meetingId") || info.meetingId || "";
    if (meetingId) {
      await validatePasscode(session, meetingId, passcode);
      html = await session.fetchText(playUrl);
    }
  } else if (needsPassword(html)) {
    throw new Error("This recording is passcode-protected. Paste the passcode from the Zoom email.");
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
  return { url: text, passcode };
}

export async function fetchTranscriptFromShareLink(
  recordingUrl: string,
  passcode?: string,
): Promise<ZoomShareResult> {
  const parsed = parseRecordingPaste(recordingUrl);
  const pwd = passcode?.trim() || parsed.passcode;
  const shareParsed = parseShareUrl(parsed.url);
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

  return {
    transcript,
    topic: playData.meet?.topic,
    source: picked.source,
  };
}

export function isZoomRecordingUrl(input: string): boolean {
  return SHARE_URL_RE.test(input.trim());
}
