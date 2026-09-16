/**
 * Backward-compatible facade for 2.0.4 Kaia share API.
 * Implementation lives in worker/src/kaia/* — do not duplicate fetch/parse logic here.
 */

import { fetchKaiaShareContent } from "./kaia/fetchShareContent";
import { formatSummaryJson } from "./kaia/summaryJsonFormat";
import {
  assertKaiaEngageUrl,
  decodeKaiaShareToken,
  DEFAULT_KAIA_BENTO,
  isKaiaEngageShareUrl,
  KaiaShareUrlError,
} from "./kaia/shareLink";

export { formatSummaryJson };

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

const SHARE_PATH = /^\/kaia\/share\/([^/?#]+)/i;

/** Sync parse for long /kaia/share/{token} URLs only (legacy 2.0.4 contract). */
export function parseKaiaShareUrl(input: string): KaiaShareParsed {
  const trimmed = input.trim().split(/\s/)[0];
  let url;
  try {
    url = assertKaiaEngageUrl(trimmed);
  } catch (err) {
    const msg =
      err instanceof KaiaShareUrlError
        ? err.message
        : "Invalid Kaia share link. Paste a URL like https://engage.freshworks.com/kaia/share/…";
    throw new Error(msg);
  }
  const m = url.pathname.match(SHARE_PATH);
  if (!m?.[1]) {
    throw new Error(
      "Invalid Kaia share link. Paste a URL like https://engage.freshworks.com/kaia/share/…",
    );
  }
  const shareToken = m[1];
  const decoded = decodeKaiaShareToken(shareToken);
  return {
    bento: DEFAULT_KAIA_BENTO,
    meetingId: decoded.m,
    linkId: decoded.i,
    orgPassword: decoded.p,
    shareToken,
    shareUrl: trimmed,
  };
}

export function isKaiaShareUrl(input: string): boolean {
  return isKaiaEngageShareUrl(input);
}

function inferSource(bundle?: {
  summaryJson?: string;
  summary?: string;
}): KaiaShareResult["source"] {
  if (bundle?.summaryJson?.trim()) return "summaryJson";
  return "meetingSummary";
}

function failureMessage(reason: string, message?: string): string {
  switch (reason) {
    case "not_found":
      return "Kaia share link not found. Check the URL.";
    case "link_expired":
      return "This Kaia share link has expired.";
    case "forbidden":
    case "auth_required":
      return "This Kaia link requires email verification — open it in a browser first, then try again.";
    default:
      return message || "Kaia returned an error for this share link.";
  }
}

export async function fetchKaiaSummaryFromShareLink(shareUrl: string): Promise<KaiaShareResult> {
  const result = await fetchKaiaShareContent(shareUrl.trim());
  if (!result.ok) {
    throw new Error(failureMessage(result.reason, result.message));
  }
  const summary = result.summary?.trim();
  if (!summary) {
    throw new Error("Kaia returned no meeting summary for this link.");
  }
  return {
    summary,
    title: result.title,
    source: inferSource(result.bundle),
  };
}
