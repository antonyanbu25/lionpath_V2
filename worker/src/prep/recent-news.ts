import type { RecentNewsItem } from "../schema";
import type { ResearchFact, SourceRef } from "./types";

const UNKNOWN = "unknown";

/** Tech-stack phrasing must never appear as company news. */
const SIGNAL_LIKE_KEY =
  /incumbent|integration|widget|help\s*center|support\s*portal|chat|zendesk|intercom|freshdesk|hiring\s*support|crm|tech\s*stack|ai\s*in/i;

function isUnknown(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s === UNKNOWN || s === "-";
}

/**
 * The SE's own notes are not news, however confidently we hold them.
 *
 * The confidence gate below was written to reject *unsourced* claims, and SE_SOURCE carries
 * confidence 88 with a non-empty url ("se-context") — so it sailed straight through and the panel
 * read the SE's typed context back to them as "Recent news" under an INPUT badge. Provenance, not
 * confidence, is the right test here.
 */
function isSeSourced(fact: ResearchFact, src: SourceRef | undefined): boolean {
  if (String(fact.sourceLabel || "").trim().toUpperCase() === "SE") return true;
  if (String(fact.sourceUrl || "").trim().toLowerCase() === "se-context") return true;
  return String(src?.url || "").trim().toLowerCase() === "se-context";
}

function isLowConfidenceSource(src: SourceRef | undefined): boolean {
  if (!src) return true;
  const url = String(src.url || "").trim().toLowerCase();
  if (!url || url === UNKNOWN) return true;
  return (Number(src.confidence) || 0) < 55;
}

function trimWords(s: string, max: number): string {
  const parts = String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= max) return parts.join(" ");
  return `${parts.slice(0, max).join(" ")}…`;
}

/**
 * Build Recent news from research facts already classified `news`.
 *
 * Fallback path only. The primary source is generateCompanyNews (prep/company-news.ts), a
 * dedicated grounded search whose items are verified against the citations Gemini returned.
 */
export function buildRecentNews(
  facts: ResearchFact[],
  sources: SourceRef[],
  maxItems = 4,
): RecentNewsItem[] {
  const srcByLabel = new Map(sources.map((s) => [s.label, s]));
  const seen = new Set<string>();
  const out: RecentNewsItem[] = [];

  for (const f of facts) {
    if (f.category !== "news") continue;
    if (isUnknown(f.value)) continue;
    if (SIGNAL_LIKE_KEY.test(String(f.key || ""))) continue;

    const src = srcByLabel.get(f.sourceLabel);
    if (isSeSourced(f, src)) continue;
    if (isLowConfidenceSource(src)) continue;

    const headline = trimWords(String(f.key || "News"), 8);
    const detail = trimWords(String(f.value || ""), 18);
    const dedupeKey = `${headline.toLowerCase()}|${detail.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      headline,
      detail,
      sourceLabel: f.sourceLabel,
    });
    if (out.length >= maxItems) break;
  }

  return out;
}
