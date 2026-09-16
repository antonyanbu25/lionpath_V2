/**
 * Fetch AI summary text from Kaia public sharable links (no OAuth).
 * API: GET https://{bento}.kaiafrontdoor.outreach.io/api/public/recordings/{instanceId}/sharable-links/{linkId}?password={p}
 *
 * Media / Pass 2: this API returns summary + participants only — no mp4 or stream URLs.
 * Unlike Zoom NWS play/info, Kaia Engage share links cannot feed video sampling.
 * Later: Outreach OAuth, org S3 daily export, or player-network spike — not this module.
 */

import { KAIA_FETCH_MAX_SUMMARY } from "../contact/enrich-limits";
import type { KaiaParticipantMeta, KaiaShareBundle } from "../prep/types";
import { sanitizeErrorMessage } from "./sanitize";
import {
  getCachedKaiaShare,
  kaiaShareCacheKey,
  setCachedKaiaShare,
} from "./shareCache";
import {
  DEFAULT_KAIA_BENTO,
  KAIA_USER_AGENT,
  KaiaShareUrlError,
  parseKaiaShareUrl,
  type KaiaShareRef,
} from "./shareLink";

const AZURE_CDN_PRODUCTION = "kaiafrontdoor.outreach.io";
const FETCH_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 500;

export type KaiaFetchFailureReason =
  | "invalid_url"
  | "parse_error"
  | "expired"
  | "redirect_failed"
  | "not_found"
  | "forbidden"
  | "link_expired"
  | "auth_required"
  | "empty_content"
  | "network_error";

export interface KaiaShareContentResult {
  ok: true;
  summary: string;
  title?: string;
  startTime?: string;
  participants?: KaiaParticipantMeta[];
  summaryJson?: string;
  transcriptExcerpt?: string;
  bundle: KaiaShareBundle;
}

export interface KaiaShareContentError {
  ok: false;
  reason: KaiaFetchFailureReason;
  message: string;
}

export type KaiaShareContentResponse = KaiaShareContentResult | KaiaShareContentError;

interface SharableLinkParticipant {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  derivedGuid?: string;
}

interface SharableLinkApiBody {
  data?: {
    id?: number;
    title?: string;
    meetingSummary?: string;
    meetingStartTime?: string;
    structuredSummary?: { summary?: string; keyPoints?: string[] };
    summaryJson?: string;
    participants?: SharableLinkParticipant[];
    host?: { derivedGuid?: string };
    errorInfo?: { reason?: string };
  };
  errorInfo?: { reason?: string };
}

function azureCdnHostForBento(_bento: string): string {
  if (process.env.KAIA_AZURE_CDN_HOST?.trim()) {
    return process.env.KAIA_AZURE_CDN_HOST.trim();
  }
  return AZURE_CDN_PRODUCTION;
}

export function kaiaPublicApiBase(ref: KaiaShareRef): string {
  const host = azureCdnHostForBento(ref.bento);
  return `https://${ref.bento}.${host}`;
}

export function buildSharableLinkUrl(ref: KaiaShareRef): string {
  const base = kaiaPublicApiBase(ref);
  const password = encodeURIComponent(ref.password);
  return `${base}/api/public/recordings/${encodeURIComponent(ref.instanceId)}/sharable-links/${encodeURIComponent(ref.linkId)}?password=${password}`;
}

type SummaryJsonBlock = {
  type?: string;
  name?: string;
  result?: {
    stringOutput?: string;
    listKeyPoints?: Array<{
      title?: string;
      points?: Array<{ text?: string }>;
    }>;
  };
};

export function extractTextFromSummaryJson(summaryJson: string | undefined): string {
  if (!summaryJson?.trim()) return "";
  let blocks: SummaryJsonBlock[];
  try {
    blocks = JSON.parse(summaryJson) as SummaryJsonBlock[];
  } catch {
    return "";
  }
  if (!Array.isArray(blocks)) return "";

  const parts: string[] = [];
  for (const block of blocks) {
    const name = block.name || block.type || "";
    const out = block.result?.stringOutput?.trim();
    if (out) {
      parts.push(name ? `${name}:\n${out}` : out);
      continue;
    }
    const lists = block.result?.listKeyPoints;
    if (lists?.length) {
      const lines: string[] = [];
      if (name) lines.push(`${name}:`);
      for (const section of lists) {
        if (section.title) lines.push(section.title);
        for (const pt of section.points || []) {
          if (pt.text?.trim()) lines.push(`- ${pt.text.trim()}`);
        }
      }
      if (lines.length) parts.push(lines.join("\n"));
    }
  }
  return parts.join("\n\n").trim();
}

export function buildKaiaSummaryText(data: NonNullable<SharableLinkApiBody["data"]>): string {
  const parts: string[] = [];
  const title = data.title?.trim();
  if (title) parts.push(`Meeting: ${title}`);

  const meetingSummary = data.meetingSummary?.trim();
  if (meetingSummary) parts.push(meetingSummary);

  const structured = data.structuredSummary;
  if (structured?.summary?.trim()) parts.push(structured.summary.trim());
  if (structured?.keyPoints?.length) {
    parts.push("Key points:\n" + structured.keyPoints.map((k) => `- ${k}`).join("\n"));
  }

  if (parts.length <= (title ? 1 : 0)) {
    const fromJson = extractTextFromSummaryJson(data.summaryJson);
    if (fromJson) parts.push(fromJson);
  }

  return parts.join("\n\n").trim().slice(0, KAIA_FETCH_MAX_SUMMARY);
}

function mapParticipants(data: NonNullable<SharableLinkApiBody["data"]>): KaiaParticipantMeta[] {
  const hostGuid = data.host?.derivedGuid;
  return (data.participants || [])
    .map((p) => {
      const displayName =
        p.displayName?.trim() ||
        [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
        "";
      if (!displayName) return null;
      return {
        displayName,
        isHost: hostGuid != null && p.derivedGuid === hostGuid,
      };
    })
    .filter(Boolean) as KaiaParticipantMeta[];
}

function mapApiError(reason: string | undefined): KaiaFetchFailureReason {
  switch (reason) {
    case "link_not_found":
      return "not_found";
    case "forbidden":
      return "forbidden";
    case "link_expired":
      return "link_expired";
    default:
      return "auth_required";
  }
}

function isRetryableHttp(status: number): boolean {
  return status >= 500 || status === 429;
}

async function fetchSharableLinkOnce(ref: KaiaShareRef, fetchImpl: typeof fetch): Promise<SharableLinkApiBody> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(buildSharableLinkUrl(ref), {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": KAIA_USER_AGENT },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: SharableLinkApiBody;
    try {
      body = JSON.parse(text) as SharableLinkApiBody;
    } catch {
      throw new Error("non_json");
    }
    if (!res.ok) {
      const reason = body.errorInfo?.reason || body.data?.errorInfo?.reason;
      const err = new Error(reason || `http_${res.status}`) as Error & {
        apiReason?: string;
        httpStatus?: number;
      };
      err.apiReason = reason;
      err.httpStatus = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSharableLink(ref: KaiaShareRef, fetchImpl: typeof fetch): Promise<SharableLinkApiBody> {
  try {
    return await fetchSharableLinkOnce(ref, fetchImpl);
  } catch (err) {
    const httpStatus = (err as Error & { httpStatus?: number }).httpStatus;
    if (err instanceof Error && err.message === "non_json") throw err;
    if (httpStatus != null && !isRetryableHttp(httpStatus)) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchSharableLinkOnce(ref, fetchImpl);
  }
}

function bodyToResult(body: SharableLinkApiBody): KaiaShareContentResponse {
  const data = body.data;
  if (!data?.id) {
    const reason = body.errorInfo?.reason || data?.errorInfo?.reason;
    return {
      ok: false,
      reason: mapApiError(reason),
      message: sanitizeErrorMessage(
        reason === "forbidden"
          ? "This Kaia link requires login; use a public share link or paste summary in Additional context."
          : "Could not load Kaia share content.",
      ),
    };
  }

  const summary = buildKaiaSummaryText(data);
  if (!summary) {
    return {
      ok: false,
      reason: "empty_content",
      message: "Kaia share link returned no summary text.",
    };
  }

  const participants = mapParticipants(data);
  const startTime = data.meetingStartTime?.trim() || undefined;
  const bundle: KaiaShareBundle = {
    summary,
    title: data.title?.trim() || undefined,
    startTime,
    participants: participants.length ? participants : undefined,
    summaryJson: data.summaryJson,
  };

  return {
    ok: true,
    summary,
    title: bundle.title,
    startTime,
    participants: bundle.participants,
    summaryJson: data.summaryJson,
    bundle,
  };
}

export async function fetchKaiaShareContentForRef(
  ref: KaiaShareRef,
  fetchImpl: typeof fetch = fetch,
): Promise<KaiaShareContentResponse> {
  const cacheKey = kaiaShareCacheKey(ref);
  const cached = getCachedKaiaShare(cacheKey);
  if (cached) return cached;

  try {
    const body = await fetchSharableLink(ref, fetchImpl);
    const result = bodyToResult(body);
    setCachedKaiaShare(cacheKey, result);
    return result;
  } catch (err) {
    if (err instanceof Error && err.message === "non_json") {
      return { ok: false, reason: "network_error", message: "Kaia API returned an unexpected response." };
    }
    const apiReason = (err as Error & { apiReason?: string }).apiReason;
    if (apiReason) {
      return {
        ok: false,
        reason: mapApiError(apiReason),
        message: sanitizeErrorMessage(
          apiReason === "forbidden"
            ? "This Kaia link requires login; use a public share link or paste summary in Additional context."
            : "Could not load Kaia share content.",
        ),
      };
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, reason: "network_error", message: "Kaia fetch timed out." };
    }
    return { ok: false, reason: "network_error", message: "Could not reach Kaia share API." };
  }
}

export async function fetchKaiaShareContent(
  url: string,
  options?: { fetchImpl?: typeof fetch; bento?: string },
): Promise<KaiaShareContentResponse> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const ref = await parseKaiaShareUrl(url, {
      fetchImpl,
      bento: options?.bento || DEFAULT_KAIA_BENTO,
    });
    return fetchKaiaShareContentForRef(ref, fetchImpl);
  } catch (err) {
    if (err instanceof KaiaShareUrlError) {
      return {
        ok: false,
        reason: err.code === "expired" ? "link_expired" : err.code === "invalid_url" ? "invalid_url" : "parse_error",
        message: sanitizeErrorMessage(err.message),
      };
    }
    return {
      ok: false,
      reason: "network_error",
      message: sanitizeErrorMessage((err as Error).message || "Kaia fetch failed."),
    };
  }
}

/** Used by contact enrich when only a URL is provided. */
export async function fetchKaiaSummary(
  url: string,
): Promise<{ ok: true; text: string; title?: string; bundle?: KaiaShareBundle } | { ok: false; reason: string }> {
  const result = await fetchKaiaShareContent(url);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true, text: result.summary, title: result.title, bundle: result.bundle };
}

export function formatKaiaMetadataHeader(bundle: KaiaShareBundle): string {
  const parts: string[] = [];
  if (bundle.title) parts.push(`Meeting: ${bundle.title}`);
  if (bundle.startTime) parts.push(`Date: ${bundle.startTime}`);
  if (bundle.participants?.length) {
    parts.push(`Participants: ${bundle.participants.map((p) => p.displayName).join(", ")}`);
  }
  return parts.join(" | ");
}
