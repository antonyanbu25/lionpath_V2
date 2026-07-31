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
 * Build Recent news from Gemini research facts (category "news" only).
 * Research snippets come from playbook queries like `"Acme" news OR funding`.
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
