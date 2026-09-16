/**
 * How a source is named in the UI, and how two sources are recognised as the same.
 *
 * MIRROR of worker/src/prep/source-display.ts — keep behaviourally identical. The
 * shared fixture at worker/testdata/source-canon/cases.json is checked by both
 * test-canonicalize-sources.ts and web/scripts/test-prep-source-canon.mjs so the two
 * cannot drift silently. (The worker can't import from web/, and web/ has no bundler.)
 */

/** Labels that carry meaning to regex consumers and must never be renumbered. */
/**
 * Mirror of RESERVED_LABELS in worker/src/prep/source-display.ts.
 *
 * "Orchestrator" is deliberately absent: it is web/LinkedIn research, i.e. the AI-researched
 * provenance the legend documents as `S#`, so it is numbered like any other citation. The rest
 * are non-web provenance with no citation to number.
 */
export const RESERVED_LABELS = [
  "SE",
  "Kaia",
  "Zoom",
  "LinkedIn + Kaia",
  "LinkedIn PDF",
];

/** Label for a row whose provenance cannot be resolved. Renders as unverified. */
export const UNATTRIBUTED_LABEL = "?";

const SENTINEL_NAMES = {
  "se-context": "From your input",
  "company-web": "Company website",
  orchestrator: "Web research",
  "kaia-meeting": "Kaia",
  "zoom-transcript": "Zoom",
  "linkedin-kaia": "LinkedIn + Kaia",
  unknown: "",
};

const RESERVED_DISPLAY = {
  SE: "From your input",
  Kaia: "Kaia",
  Zoom: "Zoom",
  "LinkedIn + Kaia": "LinkedIn + Kaia",
  "LinkedIn PDF": "LinkedIn PDF",
  Orchestrator: "Web research",
};

const HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Mirror of citationDomain in worker/src/prep/citations.ts. */
export function citationDomain(uri, fallbackTitle) {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    const t = String(fallbackTitle || "").trim();
    return HOSTNAME_RE.test(t) ? t.replace(/^www\./, "") : "";
  }
}

/**
 * Chip text for a source: the publisher domain when there is one, else a plain word.
 * Never empty as long as any of label/title/url is set, so sources persisted before
 * `displayName` existed still render.
 */
export function sourceDisplayName(src) {
  if (!src) return "Source";
  if (String(src.displayName || "").trim()) return String(src.displayName).trim();

  const label = String(src.label || "").trim();
  if (RESERVED_DISPLAY[label]) return RESERVED_DISPLAY[label];

  const url = String(src.url || "").trim();
  if (/^linkedin-pdf:/i.test(url)) return "LinkedIn PDF";
  const sentinel = SENTINEL_NAMES[url.toLowerCase()];
  if (sentinel) return sentinel;
  if (/^https?:\/\//i.test(url)) {
    const domain = citationDomain(url);
    if (domain) return domain;
  }

  const title = String(src.title || "").trim();
  if (HOSTNAME_RE.test(title)) return title.replace(/^www\./, "");
  if (title) return title.split(/\s+/).slice(0, 3).join(" ");
  return label || "Source";
}

/** Stable merge key: two sources with the same key are the same source for display. */
export function sourceDomainKey(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    const domain = citationDomain(raw);
    if (domain) return `domain:${domain.toLowerCase()}`;
  }
  return `raw:${raw.toLowerCase()}`;
}

/** True when a source url can be opened in a new tab. */
export function isLinkableSource(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

/**
 * What KIND of source this is, for the citation dot.
 *
 * Deliberately separate from confidence: the dot used to encode confidence tier
 * (green/amber/red) which made every row shout. Confidence now lives only in the
 * Sources & confidence list, where it already renders as a bar and a percentage.
 */
export function sourceKind(src) {
  const label = String(src?.label || "").trim();
  const url = String(src?.url || "").trim().toLowerCase();

  if (label === "SE" || url === "se-context") return "context";
  if (label === "LinkedIn PDF" || /^linkedin-pdf:/.test(url)) return "linkedin";
  if (label === "Kaia" || label === "Zoom" || label === "LinkedIn + Kaia") return "recording";
  if (url === "kaia-meeting" || url === "zoom-transcript" || url === "linkedin-kaia") return "recording";
  if (label === UNATTRIBUTED_LABEL || url === "unknown" || !url) return "none";
  if (/^https?:\/\//.test(url)) return "web";
  return "web";
}

/** SE-facing name for a source kind — used in tooltips, aria-labels and the legend. */
export const SOURCE_KIND_LABEL = {
  context: "From your input",
  linkedin: "LinkedIn PDF",
  recording: "Meeting recording",
  web: "Web research",
  none: "No source",
};

/** Web citations render as [1], [2]… from their S-number. Non-S labels have no number. */
export function citationNumber(label) {
  const m = /^S(\d+)$/.exec(String(label || "").trim());
  return m ? Number(m[1]) : null;
}
