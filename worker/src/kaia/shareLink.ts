/**
 * Parse Freshworks Engage / Outreach Kaia public share URLs.
 * Discovered from public Kaia SPA (2026-07): token = atob(segment) → decodeURIComponent → JSON { v: { p, m, i, e?, t? } }.
 */

export const KAIA_ENGAGE_HOST = "engage.freshworks.com";

const HTTPS_ENGAGE = /^https:\/\/engage\.freshworks\.com/i;
const SHORT_PATH = /^\/s\/([^/?#]+)/i;
const SHARE_PATH = /^\/kaia\/share\/([^/?#]+)/i;

export interface KaiaSharePayloadV {
  /** Share password / link key (query param to public API). */
  p: string;
  /** Meeting instance id (may include `:secret` suffix). */
  m: string;
  /** Sharable link id. */
  i: string;
  /** Optional expiry (seconds). */
  e?: number;
  /** Optional meeting title. */
  t?: string;
}

export interface KaiaShareRef {
  password: string;
  instanceId: string;
  linkId: string;
  /** Outreach bento shard (e.g. app1f). */
  bento: string;
  title?: string;
  expiresAtMs?: number;
}

export class KaiaShareUrlError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_url" | "parse_error" | "expired" | "redirect_failed",
  ) {
    super(message);
    this.name = "KaiaShareUrlError";
  }
}

export function assertKaiaEngageUrl(input: string): URL {
  const trimmed = input.trim().split(/\s/)[0];
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new KaiaShareUrlError(
      "Invalid Kaia link. Use https://engage.freshworks.com/s/… or …/kaia/share/…",
      "invalid_url",
    );
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== KAIA_ENGAGE_HOST) {
    throw new KaiaShareUrlError(
      "Kaia links must be on https://engage.freshworks.com (public share links only).",
      "invalid_url",
    );
  }
  return url;
}

/** Decode share token from /kaia/share/{token} path segment (browser-compatible). */
export function decodeKaiaShareToken(tokenSegment: string): KaiaSharePayloadV {
  const token = tokenSegment.trim();
  if (!token) {
    throw new KaiaShareUrlError("Missing Kaia share token.", "parse_error");
  }
  try {
    const inner = decodeURIComponent(atob(token));
    const parsed = JSON.parse(inner) as { v?: KaiaSharePayloadV };
    const v = parsed?.v;
    if (!v?.p || !v?.m || !v?.i) {
      throw new Error("missing v.p, v.m, or v.i");
    }
    if (typeof v.p !== "string" || typeof v.m !== "string" || typeof v.i !== "string") {
      throw new Error("invalid field types");
    }
    if (v.e != null) {
      const expiresAtMs = Number(v.e) * 1000;
      if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
        throw new KaiaShareUrlError("This Kaia share link has expired.", "expired");
      }
    }
    return v;
  } catch (err) {
    if (err instanceof KaiaShareUrlError) throw err;
    throw new KaiaShareUrlError("Could not decode Kaia share link token.", "parse_error");
  }
}

export function kaiaShareRefFromPayload(v: KaiaSharePayloadV, bento: string): KaiaShareRef {
  return {
    password: v.p,
    instanceId: v.m,
    linkId: v.i,
    bento,
    title: v.t,
    expiresAtMs: v.e != null ? Number(v.e) * 1000 : undefined,
  };
}

export function extractShareTokenFromUrl(url: URL): string {
  const share = url.pathname.match(SHARE_PATH);
  if (share?.[1]) return share[1];
  const short = url.pathname.match(SHORT_PATH);
  if (short?.[1]) return `short:${short[1]}`;
  throw new KaiaShareUrlError(
    "Unrecognized Kaia URL path. Expected /s/{id} or /kaia/share/{token}.",
    "invalid_url",
  );
}

const BENTO_RE = /OUTREACH_BENTO\s*=\s*["']([a-z0-9]+)["']/i;

/** Resolve short /s/… links to a share token; returns final /kaia/share/ token segment. */
export async function resolveKaiaShareTokenSegment(
  url: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<{ tokenSegment: string; bento?: string }> {
  const direct = url.pathname.match(SHARE_PATH);
  if (direct?.[1]) {
    return { tokenSegment: direct[1] };
  }

  const short = url.pathname.match(SHORT_PATH);
  if (!short?.[1]) {
    throw new KaiaShareUrlError(
      "Unrecognized Kaia URL path. Expected /s/{id} or /kaia/share/{token}.",
      "invalid_url",
    );
  }

  const res = await fetchImpl(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "text/html", "User-Agent": KAIA_USER_AGENT },
  });

  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const next = new URL(location, url.origin);
    assertKaiaEngageUrl(next.toString());
    const token = next.pathname.match(SHARE_PATH)?.[1];
    if (!token) {
      throw new KaiaShareUrlError("Kaia short link did not redirect to a share page.", "redirect_failed");
    }
    return { tokenSegment: token };
  }

  if (res.ok) {
    const html = await res.text();
    const bento = html.match(BENTO_RE)?.[1];
    const token = url.pathname.match(SHARE_PATH)?.[1];
    if (token) return { tokenSegment: token, bento };
  }

  throw new KaiaShareUrlError("Could not resolve Kaia short link.", "redirect_failed");
}

export const KAIA_USER_AGENT =
  "Mozilla/5.0 (compatible; LionpathPrep/1.0; +https://freshworks.com)";

export const DEFAULT_KAIA_BENTO = "app1f";

export function parseBentoFromEngageHtml(html: string): string | undefined {
  return html.match(BENTO_RE)?.[1];
}

async function fetchBentoForSharePage(url: URL, fetchImpl: typeof fetch): Promise<string | undefined> {
  if (!SHARE_PATH.test(url.pathname)) return undefined;
  try {
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "text/html", "User-Agent": KAIA_USER_AGENT },
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    return parseBentoFromEngageHtml(html);
  } catch {
    return undefined;
  }
}

/** Full parse: allowlisted URL → share ref (follows short-link redirect). */
export async function parseKaiaShareUrl(
  input: string,
  options?: { fetchImpl?: typeof fetch; bento?: string },
): Promise<KaiaShareRef> {
  const url = assertKaiaEngageUrl(input);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const { tokenSegment, bento: bentoFromRedirect } = await resolveKaiaShareTokenSegment(url, fetchImpl);
  const v = decodeKaiaShareToken(tokenSegment);
  let bento = options?.bento || bentoFromRedirect;
  if (!bento) {
    bento = await fetchBentoForSharePage(url, fetchImpl);
  }
  if (!bento) {
    bento = DEFAULT_KAIA_BENTO;
  }
  return kaiaShareRefFromPayload(v, bento);
}

/** True if string looks like an allowlisted Engage Kaia URL (no network). */
export function isKaiaEngageShareUrl(input: string): boolean {
  try {
    assertKaiaEngageUrl(input);
    const url = new URL(input.trim().split(/\s/)[0]);
    return SHORT_PATH.test(url.pathname) || SHARE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}
