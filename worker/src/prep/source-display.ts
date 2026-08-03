/**
 * How a source is named in the UI, and how two sources are recognised as the same.
 *
 * Source labels ("S1", "S28") are join keys, not names — an SE reading "S28" has to
 * scroll to a table to learn anything. Now that grounding gives us verified publisher
 * URLs, the chip can show the domain instead and be self-explanatory.
 *
 * MIRROR: web/prep-source-display.js must stay behaviourally identical. The shared
 * fixture at worker/testdata/source-canon/cases.json is what keeps them honest —
 * the worker cannot import from web/ and web/ has no bundler.
 */

import { citationDomain } from "./citations";

/**
 * Labels that carry meaning to regex consumers and must never be renumbered.
 * `web/precall-render.js` tests /kaia/i and /linkedin/i against the label, and
 * `isSeNotesSource` compares against "SE" exactly.
 */
/**
 * Labels that keep their literal text and consume no citation number.
 *
 * "Orchestrator" is deliberately NOT here: it is web/LinkedIn research, i.e. exactly the
 * AI-researched provenance the brief's legend documents as `S#`. Leaving it reserved put the
 * literal string "Orchestrator" on screen where a citation number belonged. The rest are
 * non-web provenance — the SE's own notes, a meeting recording, an uploaded PDF — which have no
 * citation to number and read better by name.
 */
export const RESERVED_LABELS: readonly string[] = [
  "SE",
  "Kaia",
  "Zoom",
  "LinkedIn + Kaia",
  "LinkedIn PDF",
];

/** Label for a row whose provenance cannot be resolved. Renders as unverified. */
export const UNATTRIBUTED_LABEL = "?";

/** Non-http sentinel URLs used by sources that are not web pages. */
const SENTINEL_NAMES: Record<string, string> = {
  "se-context": "From your input",
  "company-web": "Company website",
  orchestrator: "Web research",
  "kaia-meeting": "Kaia",
  "zoom-transcript": "Zoom",
  "linkedin-kaia": "LinkedIn + Kaia",
  unknown: "",
};

const RESERVED_DISPLAY: Record<string, string> = {
  SE: "From your input",
  Kaia: "Kaia",
  Zoom: "Zoom",
  "LinkedIn + Kaia": "LinkedIn + Kaia",
  "LinkedIn PDF": "LinkedIn PDF",
  // Kept although "Orchestrator" is no longer a RESERVED_LABEL: it is now numbered S#, but the
  // sources table still needs a readable name for the row, and this is the fallback for a source
  // that reaches us without an explicit displayName.
  Orchestrator: "Web research",
};

const HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Chip text for a source: the publisher domain when there is one, else a plain word.
 * Never returns an empty string as long as any of label/title/url is set, so
 * historical sources that predate `displayName` still render.
 */
export function sourceDisplayName(src: {
  label?: string;
  title?: string;
  url?: string;
  displayName?: string;
}): string {
  if (src.displayName?.trim()) return src.displayName.trim();

  const label = String(src.label || "").trim();
  if (RESERVED_DISPLAY[label]) return RESERVED_DISPLAY[label];

  const url = String(src.url || "").trim();
  if (/^linkedin-pdf:/i.test(url)) return "LinkedIn PDF";
  if (SENTINEL_NAMES[url.toLowerCase()] !== undefined) {
    const name = SENTINEL_NAMES[url.toLowerCase()];
    if (name) return name;
  }
  if (/^https?:\/\//i.test(url)) {
    const domain = citationDomain(url);
    if (domain) return domain;
  }

  // Gemini puts a hostname in groundingChunks[].web.title, so a title often IS a domain.
  const title = String(src.title || "").trim();
  if (HOSTNAME_RE.test(title)) return title.replace(/^www\./, "");
  if (title) return title.split(/\s+/).slice(0, 3).join(" ");
  return label || "Source";
}

export type SourceKind = "context" | "linkedin" | "recording" | "web" | "none";

/**
 * What KIND of source this is, for the citation dot in the UI.
 *
 * Deliberately independent of confidence: the dot used to encode confidence tier, which
 * made every row shout. Confidence now lives only in the Sources & confidence list.
 */
export function sourceKind(src: { label?: string; url?: string }): SourceKind {
  const label = String(src?.label || "").trim();
  const url = String(src?.url || "").trim().toLowerCase();

  if (label === "SE" || url === "se-context") return "context";
  if (label === "LinkedIn PDF" || /^linkedin-pdf:/.test(url)) return "linkedin";
  if (label === "Kaia" || label === "Zoom" || label === "LinkedIn + Kaia") return "recording";
  if (url === "kaia-meeting" || url === "zoom-transcript" || url === "linkedin-kaia") return "recording";
  if (label === UNATTRIBUTED_LABEL || url === "unknown" || !url) return "none";
  return "web";
}

/** Web citations render as [1], [2]… from their S-number. Non-S labels have no number. */
export function citationNumber(label: string | undefined): number | null {
  const m = /^S(\d+)$/.exec(String(label || "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * Stable merge key. Two sources with the same key are the same source for display
 * purposes — which matters because chips now show domains, so two URLs on one domain
 * would render identically anyway.
 */
export function sourceDomainKey(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    const domain = citationDomain(raw);
    if (domain) return `domain:${domain.toLowerCase()}`;
  }
  // Sentinels and pseudo-URLs (se-context, linkedin-pdf:x.pdf) each stay distinct.
  return `raw:${raw.toLowerCase()}`;
}
