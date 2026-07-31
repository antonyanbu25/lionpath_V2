/**
 * Turn provider citations into verified, displayable sources.
 *
 * Gemini's grounding chunks give us a `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
 * URL and a hostname-as-title. Both need work before they are useful in a brief:
 * the redirect has to be followed to get a real publisher URL, and the hostname is
 * the only "title" we get. Confirmed against a live gemini-3.6-flash response —
 * see worker/testdata/grounding/gemini-3.6-flash-grounded.json.
 */

import type { Citation } from "../providers/types";

/** Gemini returns no confidenceScores, so grounded sources get a fixed confidence. */
export const GROUNDED_CONFIDENCE = 70;
/** Company pages we fetched ourselves — we know the URL is real. */
export const DIRECT_FETCH_CONFIDENCE = 80;

const REDIRECT_HOST_RE = /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i;
/**
 * High enough to cover a full research round — a single round produced 57 citations in
 * testing, and anything left unresolved is stored as a short-lived redirect that will
 * be a dead link by the time a cached bundle is re-read.
 */
const DEFAULT_RESOLVE_MAX = 128;
/** Parallel HEAD requests. All go to one Google host, so keep it civil. */
const DEFAULT_RESOLVE_CONCURRENCY = 8;
const DEFAULT_RESOLVE_TIMEOUT_MS = 2000;

export interface VerifiedCitation {
  /** Canonical click/display URL — the resolved publisher URL when we have one. */
  uri: string;
  domain: string;
  title: string;
  snippet?: string;
  confidence: number;
}

/** True when a citation URI is a grounding redirect rather than a publisher URL. */
export function isGroundingRedirect(uri: string): boolean {
  return REDIRECT_HOST_RE.test(String(uri || ""));
}

export function citationDomain(uri: string, fallbackTitle?: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    // Gemini's title is already a hostname, so it is a good fallback.
    const t = String(fallbackTitle || "").trim();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t) ? t.replace(/^www\./, "") : "";
  }
}

/** Shape provider citations for use as sources. Does not hit the network. */
export function normalizeCitations(raw: Citation[] | undefined): VerifiedCitation[] {
  if (!raw?.length) return [];
  const out: VerifiedCitation[] = [];
  for (const c of raw) {
    const uri = String(c?.uri || "").trim();
    if (!uri) continue;
    const best = c.resolvedUrl?.trim() || uri;
    out.push({
      uri: best,
      // A redirect URL's hostname is Google's, so prefer the provider title there.
      domain: citationDomain(isGroundingRedirect(best) ? "" : best, c.title),
      title: String(c.title || "").trim() || citationDomain(best) || "Web source",
      ...(c.snippet ? { snippet: c.snippet } : {}),
      confidence: GROUNDED_CONFIDENCE,
    });
  }
  return out;
}

/**
 * Collapse citations that point at the same page. Keeps the first occurrence but
 * prefers a resolved (non-redirect) URI and the longest snippet, so dedupe never
 * loses the better copy of a source.
 */
export function dedupeCitations(cites: VerifiedCitation[]): VerifiedCitation[] {
  const byKey = new Map<string, VerifiedCitation>();
  for (const c of cites) {
    const key = dedupeKey(c);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    const merged: VerifiedCitation = { ...prev };
    if (isGroundingRedirect(prev.uri) && !isGroundingRedirect(c.uri)) {
      merged.uri = c.uri;
      merged.domain = c.domain || prev.domain;
    }
    if ((c.snippet?.length || 0) > (merged.snippet?.length || 0)) merged.snippet = c.snippet;
    if (!merged.domain) merged.domain = c.domain;
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

function dedupeKey(c: VerifiedCitation): string {
  // Unresolved redirects are opaque, so they can only be deduped by exact URI.
  if (isGroundingRedirect(c.uri)) return `redirect:${c.uri}`;
  try {
    const u = new URL(c.uri);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return c.uri.toLowerCase();
  }
}

/**
 * Follow grounding redirects to publisher URLs. Best-effort and bounded: any failure
 * leaves that citation untouched rather than dropping it.
 *
 * Worth doing eagerly — the redirect links are short-lived, so a cached research
 * bundle that stored only redirects would render dead links later.
 */
export async function resolveRedirectUrls(
  cites: VerifiedCitation[],
  opts: { max?: number; timeoutMs?: number; concurrency?: number } = {},
): Promise<VerifiedCitation[]> {
  const max = opts.max ?? DEFAULT_RESOLVE_MAX;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_RESOLVE_CONCURRENCY);

  const targets = cites
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => isGroundingRedirect(c.uri))
    .slice(0, max);
  if (!targets.length) return cites;

  // Cache the in-flight promise, not the result — concurrent workers start before the
  // first resolves, so caching only completed values would refetch the same URI N times.
  const inFlight = new Map<string, Promise<string | null>>();
  const out = [...cites];
  let next = 0;

  const worker = async () => {
    while (next < targets.length) {
      const { c, i } = targets[next++];
      let pending = inFlight.get(c.uri);
      if (!pending) {
        pending = followRedirect(c.uri, timeoutMs);
        inFlight.set(c.uri, pending);
      }
      const resolved = await pending;
      if (!resolved) continue;
      out[i] = { ...c, uri: resolved, domain: citationDomain(resolved, c.title) || c.domain };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
  );
  return out;
}

async function followRedirect(uri: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(uri, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    const location = res.headers.get("location");
    if (location && /^https?:\/\//i.test(location)) return location;
    // Some runtimes follow redirects regardless of redirect:"manual".
    if (res.url && res.url !== uri && !isGroundingRedirect(res.url)) return res.url;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
