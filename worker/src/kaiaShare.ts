// Fetch Kaia meeting summary from a public share link (engage.freshworks.com/kaia/share/…).
// Uses Outreach public recordings API — no OAuth required for "anyone" links.

const SHARE_URL_RE = /^https?:\/\/[^/]+\/kaia\/share\/([^/?#]+)/i;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_BENTO = "app1f";

export interface KaiaShareResult {
  summary: string;
  title?: string;
  source: "summaryJson" | "meetingSummary" | "structuredSummary";
}

export interface KaiaShareParsed {
  bento: string;
  meetingId: string;
  linkId: string;
  orgPassword: string;
  shareToken: string;
  shareUrl: string;
}

interface KaiaShareApiResponse {
  data?: {
    id?: number;
    title?: string;
    name?: string;
    meetingSummary?: string;
    structuredSummary?: { summary?: string; keyPoints?: string[] };
    summaryJson?: string;
    accessType?: string;
    status?: string;
    participants?: Array<{ displayName?: string; isHost?: boolean }>;
  };
  errorInfo?: { reason?: string; message?: string };
}

interface SummaryJsonItem {
  type?: string;
  name?: string;
  result?: {
    stringOutput?: string;
    listKeyPoints?: Array<{
      title?: string;
      points?: Array<{ text?: string; sources?: Array<{ speaker?: { name?: string } }> }>;
    }>;
  };
}

function decodeShareToken(token: string): { p: string; m: string; i: string } {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? padded + "=".repeat(4 - (padded.length % 4)) : padded;
  const raw = Buffer.from(pad, "base64").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    parsed = JSON.parse(raw);
  }
  const v = (parsed as { v?: { p?: string; m?: string; i?: string } })?.v;
  if (!v?.m || !v?.i || !v?.p) {
    throw new Error("Invalid Kaia share token — could not read meeting id, link id, or org password.");
  }
  return { p: v.p, m: v.m, i: v.i };
}

export function parseKaiaShareUrl(input: string): KaiaShareParsed {
  const trimmed = input.trim().split(/\s/)[0];
  const m = trimmed.match(SHARE_URL_RE);
  if (!m?.[1]) {
    throw new Error(
      "Invalid Kaia share link. Paste a URL like https://engage.freshworks.com/kaia/share/…",
    );
  }
  const shareToken = m[1];
  const decoded = decodeShareToken(shareToken);
  const host = new URL(trimmed).hostname.toLowerCase();
  const bento = host.includes("freshworks.com") ? DEFAULT_BENTO : DEFAULT_BENTO;
  return {
    bento,
    meetingId: decoded.m,
    linkId: decoded.i,
    orgPassword: decoded.p,
    shareToken,
    shareUrl: trimmed,
  };
}

export function isKaiaShareUrl(input: string): boolean {
  return SHARE_URL_RE.test(input.trim());
}

async function resolveBento(shareUrl: string, fallback: string): Promise<string> {
  try {
    const res = await fetch(shareUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    const html = await res.text();
    const bentMatch = html.match(/OUTREACH_BENTO\s*=\s*["']([^"']+)["']/);
    if (bentMatch?.[1]) return bentMatch[1];
  } catch {
    /* use fallback */
  }
  return fallback;
}

function frontdoorBase(bento: string): string {
  return `https://${bento}.kaiafrontdoor.outreach.io`;
}

function mapApiError(reason?: string, message?: string): string {
  switch (reason) {
    case "link_not_found":
      return "Kaia share link not found. Check the URL.";
    case "forbidden":
      return "This Kaia link requires email verification — open it in a browser first, then try again.";
    case "link_expired":
      return "This Kaia share link has expired.";
    default:
      return message || reason || "Kaia returned an error for this share link.";
  }
}

export function formatSummaryJson(jsonStr: string): string {
  let items: SummaryJsonItem[];
  try {
    items = JSON.parse(jsonStr) as SummaryJsonItem[];
  } catch {
    return jsonStr.trim();
  }
  if (!Array.isArray(items)) return jsonStr.trim();

  const parts: string[] = [];
  for (const item of items) {
    const name = item.name?.trim() || "Summary";
    if (item.result?.stringOutput?.trim()) {
      parts.push(`## ${name}\n${item.result.stringOutput.trim()}`);
    }
    if (item.result?.listKeyPoints?.length) {
      parts.push(`## ${name}`);
      for (const section of item.result.listKeyPoints) {
        if (section.title) parts.push(`### ${section.title}`);
        for (const pt of section.points || []) {
          if (!pt.text?.trim()) continue;
          const speaker = pt.sources?.[0]?.speaker?.name?.trim();
          parts.push(speaker ? `- ${pt.text.trim()} (${speaker})` : `- ${pt.text.trim()}`);
        }
      }
    }
  }
  return parts.join("\n\n").trim();
}

function buildSummaryText(data: NonNullable<KaiaShareApiResponse["data"]>): {
  text: string;
  source: KaiaShareResult["source"];
} {
  if (data.summaryJson?.trim()) {
    const formatted = formatSummaryJson(data.summaryJson);
    if (formatted) return { text: formatted, source: "summaryJson" };
  }
  if (data.meetingSummary?.trim()) {
    return { text: data.meetingSummary.trim(), source: "meetingSummary" };
  }
  const structured = data.structuredSummary;
  if (structured?.summary?.trim() || structured?.keyPoints?.length) {
    const parts = [];
    if (structured.summary?.trim()) parts.push(structured.summary.trim());
    if (structured.keyPoints?.length) {
      parts.push("Key points:");
      for (const kp of structured.keyPoints) {
        if (kp?.trim()) parts.push(`- ${kp.trim()}`);
      }
    }
    const text = parts.join("\n\n").trim();
    if (text) return { text, source: "structuredSummary" };
  }
  throw new Error("Kaia returned no meeting summary for this link.");
}

export async function fetchKaiaSummaryFromShareLink(shareUrl: string): Promise<KaiaShareResult> {
  const parsed = parseKaiaShareUrl(shareUrl);
  const bento = await resolveBento(parsed.shareUrl, parsed.bento);
  const base = frontdoorBase(bento);
  const apiUrl =
    `${base}/api/public/recordings/${encodeURIComponent(parsed.meetingId)}` +
    `/sharable-links/${encodeURIComponent(parsed.linkId)}?password=${encodeURIComponent(parsed.orgPassword)}`;

  const res = await fetch(apiUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as KaiaShareApiResponse;

  if (!res.ok || !body.data?.id) {
    const reason = body.errorInfo?.reason;
    throw new Error(mapApiError(reason, body.errorInfo?.message));
  }

  const { text, source } = buildSummaryText(body.data);
  const title = body.data.title?.trim() || body.data.name?.trim() || undefined;

  const participantLines = (body.data.participants || [])
    .filter((p) => p.displayName?.trim())
    .map((p) => (p.isHost ? `${p.displayName} (host)` : p.displayName!));
  const header = [
    title ? `Meeting: ${title}` : "",
    participantLines.length ? `Participants: ${participantLines.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: header ? `${header}\n\n${text}` : text,
    title,
    source,
  };
}
