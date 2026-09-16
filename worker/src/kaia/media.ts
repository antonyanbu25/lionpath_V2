/**
 * Kaia media probe — documents why Pass 2 cannot use Engage public share links.
 *
 * The sharable-links API returns summary/participants only (see fetchShareContent.ts).
 * Outreach delivers mp4 via authenticated UI download (email zip) or org daily export
 * to S3/SFTP/Azure — not via the public Engage share token.
 *
 * This module probes a small set of plausible public media paths and always returns
 * a structured "unavailable" result unless a future API appears.
 */

import { buildSharableLinkUrl, kaiaPublicApiBase } from "./fetchShareContent";
import { parseKaiaShareUrl, type KaiaShareRef } from "./shareLink";

export type KaiaMediaProbeReason =
  | "summary_api_only"
  | "no_public_mp4"
  | "auth_required"
  | "not_found"
  | "parse_error"
  | "network_error";

export interface KaiaMediaProbeResult {
  ok: false;
  unavailable: true;
  reason: KaiaMediaProbeReason;
  message: string;
  /** Endpoints probed (status) for debugging. */
  probed?: Array<{ path: string; status: number | "error" }>;
}

const PROBE_SUFFIXES = [
  "/media",
  "/recording",
  "/video",
  "/stream",
  "/download",
  "/mp4",
];

/**
 * Probe whether any public media sibling of the sharable-links API exists.
 * Safe: GET only, no credentials beyond the share password already in the URL.
 */
export async function probeKaiaMediaFromUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KaiaMediaProbeResult> {
  let ref: KaiaShareRef;
  try {
    ref = await parseKaiaShareUrl(url, { fetchImpl });
  } catch {
    return {
      ok: false,
      unavailable: true,
      reason: "parse_error",
      message: "Could not parse Kaia share URL for media probe.",
    };
  }
  return probeKaiaMediaForRef(ref, fetchImpl);
}

export async function probeKaiaMediaForRef(
  ref: KaiaShareRef,
  fetchImpl: typeof fetch = fetch,
): Promise<KaiaMediaProbeResult> {
  const base = kaiaPublicApiBase(ref);
  const root = `${base}/api/public/recordings/${encodeURIComponent(ref.instanceId)}/sharable-links/${encodeURIComponent(ref.linkId)}`;
  const probed: Array<{ path: string; status: number | "error" }> = [];

  // Confirm summary endpoint still works (expected 200) — proves token is valid.
  try {
    const summaryRes = await fetchImpl(buildSharableLinkUrl(ref), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    probed.push({ path: "sharable-links?password", status: summaryRes.status });
  } catch {
    probed.push({ path: "sharable-links?password", status: "error" });
  }

  for (const suffix of PROBE_SUFFIXES) {
    const path = `${root}${suffix}?password=${encodeURIComponent(ref.password)}`;
    try {
      const res = await fetchImpl(path, {
        method: "GET",
        headers: { Accept: "application/json, video/*, */*" },
        redirect: "manual",
      });
      probed.push({ path: `sharable-links${suffix}`, status: res.status });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (res.ok && (ct.includes("video") || ct.includes("mp4") || ct.includes("octet-stream"))) {
        // Unexpected win — still don't download here; surface for a future wire-up.
        return {
          ok: false,
          unavailable: true,
          reason: "no_public_mp4",
          message:
            `Unexpected media-like response at ${suffix} (${ct}). ` +
            "Wire manually after confirming ToS — not enabled by default.",
          probed,
        };
      }
    } catch {
      probed.push({ path: `sharable-links${suffix}`, status: "error" });
    }
  }

  return {
    ok: false,
    unavailable: true,
    reason: "summary_api_only",
    message:
      "Kaia Engage public share API returns summary text only — no mp4/stream URL. " +
      "Pass 2 needs Outreach OAuth, org S3/SFTP daily export, or a documented player media API.",
    probed,
  };
}
